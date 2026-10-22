import fs from "node:fs";
import path from "node:path";
import { HashCache } from "./cache";
import { resolveConfig } from "./config";
import {
  detectDuplicateDirs,
  detectExactDuplicates,
  detectSimilarImages,
} from "./detector";
import { CleanerError, errorMessage } from "./error";
import { deleteFiles, removeEmptyDirs } from "./executor";
import { silentReporter } from "./reporter";
import { scanFiles } from "./scanner";
import { writeTrashManifest } from "./trash";
import type {
  CleanOptions,
  CleanResult,
  CleanStats,
  CleanerConfig,
  DeleteRecord,
  DuplicateDirGroup,
  DuplicateGroup,
  FileInfo,
  Reporter,
  SimilarGroup,
  UserConfig,
} from "./types";
import { commonAncestor, isInside } from "./utils";

/** 校验所有根目录是否存在且安全 */
const assertBaseDirs = (baseDirs: string[]): void => {
  for (const baseDir of baseDirs) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(baseDir);
    } catch {
      throw new CleanerError(`指定的目录不存在：${baseDir}`, "BASE_DIR_NOT_FOUND");
    }

    if (!stat.isDirectory()) {
      throw new CleanerError(`指定的路径不是目录：${baseDir}`, "BASE_DIR_NOT_DIRECTORY");
    }

    const root = path.parse(baseDir).root;
    if (path.resolve(baseDir) === path.resolve(root)) {
      throw new CleanerError(`拒绝以文件系统根目录（${root}）作为清理目录`, "UNSAFE_BASE_DIR");
    }
  }
};

interface DetectOutcome {
  groups: DuplicateGroup[];
  dirGroups: DuplicateDirGroup[];
  similarGroups: SimilarGroup[];
}

const runDetectors = async (
  files: FileInfo[],
  dirs: string[],
  config: CleanerConfig,
  errors: CleanResult["scan"]["errors"],
  reporter: Reporter,
  signal: AbortSignal | undefined,
  cache: HashCache | null
): Promise<DetectOutcome> => {
  const groups =
    config.detect === "dir"
      ? []
      : await detectExactDuplicates(files, config, errors, reporter, signal, cache);

  const dirGroups =
    config.detect === "exact"
      ? []
      : await detectDuplicateDirs(files, config, dirs, errors, reporter, signal, cache);

  const similarGroups = config.similarImages
    ? await detectSimilarImages(files, config, errors, reporter, signal)
    : [];

  return { groups, dirGroups, similarGroups };
};

/** 将各类检测结果展开为待删除文件清单（按路径去重） */
const collectTargets = (
  outcome: DetectOutcome,
  files: FileInfo[],
  smallFiles: FileInfo[],
  config: CleanerConfig
): Array<{ file: FileInfo; hash?: string }> => {
  const targets = new Map<string, { file: FileInfo; hash?: string }>();

  for (const group of outcome.groups) {
    for (const file of group.remove) targets.set(file.path, { file, hash: group.hash });
  }

  for (const dirGroup of outcome.dirGroups) {
    for (const dir of dirGroup.remove) {
      for (const file of files) {
        if (isInside(dir, file.path)) targets.set(file.path, { file, hash: dirGroup.hash });
      }
    }
  }

  if (config.deleteSimilarImages) {
    for (const group of outcome.similarGroups) {
      for (const file of group.remove) targets.set(file.path, { file, hash: group.hash });
    }
  }

  for (const file of smallFiles) targets.set(file.path, { file });

  return [...targets.values()];
};

const buildStats = (params: {
  scan: CleanResult["scan"];
  outcome: DetectOutcome;
  smallFiles: FileInfo[];
  targets: Array<{ file: FileInfo }>;
  deleted: DeleteRecord[];
  removedEmptyDirs: DeleteRecord[];
  cache: HashCache | null;
  hardlinksSkipped: number;
}): CleanStats => {
  const { scan, outcome, smallFiles, targets, deleted, removedEmptyDirs, cache, hardlinksSkipped } =
    params;
  const succeeded = deleted.filter(
    (record) => record.status === "deleted" || record.status === "trashed"
  );

  return {
    totalFiles: scan.files + smallFiles.length,
    totalDirs: scan.dirs,
    totalBytes:
      scan.bytes + smallFiles.reduce((total, file) => total + file.size, 0),
    duplicateGroups: outcome.groups.length,
    duplicateFiles: outcome.groups.reduce((total, group) => total + group.files.length, 0),
    removableFiles: targets.length,
    removableBytes: targets.reduce((total, target) => total + target.file.size, 0),
    deletedFiles: succeeded.length,
    deletedBytes: succeeded.reduce((total, record) => total + record.size, 0),
    failedFiles: deleted.filter((record) => record.status === "failed").length,
    emptyDirsRemoved: removedEmptyDirs.filter((record) => record.status !== "failed").length,
    skippedSmallFiles: scan.skippedSmallFiles,
    skippedSymlinks: scan.skippedSymlinks,
    hardlinksSkipped,
    duplicateDirs: outcome.dirGroups.length,
    similarGroups: outcome.similarGroups.length,
    cacheHits: cache?.hits || 0,
    errors: scan.errors,
  };
};

/** 生成可序列化的报告内容 */
const createReport = (result: CleanResult) => ({
  baseDir: result.baseDir,
  roots: result.roots,
  dryRun: result.dryRun,
  generatedAt: new Date().toISOString(),
  config: {
    ...result.config,
    include: result.config.include.map((rule) => rule.toString()),
    exclude: result.config.exclude.map((rule) => rule.toString()),
  },
  stats: result.stats,
  groups: result.groups.map((group) => ({
    hash: group.hash,
    size: group.size,
    keep: group.keep.map((file) => file.relPath),
    remove: group.remove.map((file) => file.relPath),
    hardlinks: group.hardlinks.map((file) => file.relPath),
    savedBytes: group.savedBytes,
  })),
  dirGroups: result.dirGroups,
  similarGroups: result.similarGroups.map((group) => ({
    hash: group.hash,
    distance: group.distance,
    keep: group.keep.map((file) => file.relPath),
    remove: group.remove.map((file) => file.relPath),
  })),
  deleted: result.deleted,
  removedEmptyDirs: result.removedEmptyDirs,
});

const writeReport = async (filePath: string, result: CleanResult): Promise<void> => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(createReport(result), null, 2), "utf8");
};

/**
 * 执行一次重复文件清理。
 * 默认 dryRun=true，只有显式关闭才会修改磁盘。
 */
export const clean = async (
  input: UserConfig = {},
  options: CleanOptions = {}
): Promise<CleanResult> => {
  const warnings: string[] = [];
  const config = resolveConfig(input, {
    cwd: options.cwd,
    warn: (message) => warnings.push(message),
  });

  const reporter: Reporter =
    typeof options.reporter === "function"
      ? options.reporter(config)
      : options.reporter || silentReporter;

  for (const warning of warnings) reporter.onWarning?.(warning);

  assertBaseDirs(config.baseDirs);

  const cache = config.cacheFile
    ? HashCache.load(config.cacheFile, config.algorithm, (message) =>
        reporter.onWarning?.(message)
      )
    : null;

  const scan = await scanFiles(config, reporter, options.signal);
  const outcome = await runDetectors(
    scan.files,
    scan.dirs,
    config,
    scan.stats.errors,
    reporter,
    options.signal,
    cache
  );

  const smallFiles = config.deleteMinSizeFiles ? scan.smallFiles : [];
  const targets = collectTargets(outcome, scan.files, smallFiles, config);
  const totalCandidates = scan.stats.files + smallFiles.length;

  // 同一 inode 的多个硬链接不参与删除，也不计入可释放空间
  const inodeSeen = new Set<string>();
  let hardlinksSkipped = 0;
  for (const file of scan.files) {
    if (file.ino <= 0) continue;
    const inodeKey = `${file.dev}:${file.ino}`;
    if (inodeSeen.has(inodeKey)) hardlinksSkipped++;
    else inodeSeen.add(inodeKey);
  }

  if (
    !config.dryRun &&
    config.maxDeleteRatio > 0 &&
    totalCandidates > 0 &&
    targets.length / totalCandidates > config.maxDeleteRatio
  ) {
    throw new CleanerError(
      `本次将删除 ${targets.length} / ${totalCandidates} 个文件，超过比例上限 ${(
        config.maxDeleteRatio * 100
      ).toFixed(0)}%。已中止，请检查配置或调高 maxDeleteRatio`,
      "DELETE_RATIO_EXCEEDED"
    );
  }

  const executeOptions = {
    dryRun: config.dryRun,
    trashDir: config.trashDir,
    baseDirs: config.baseDirs,
  };

  const deleted = await deleteFiles(targets, executeOptions, reporter);

  const deletedPaths = new Set(
    deleted.filter((record) => record.status !== "failed").map((record) => record.path)
  );
  const removedEmptyDirs = config.isDelEmptyDir
    ? await removeEmptyDirs(scan.dirs, executeOptions, deletedPaths, reporter)
    : [];

  if (config.trashDir && !config.dryRun) {
    try {
      await writeTrashManifest(config.trashDir, commonAncestor(config.baseDirs), deleted);
    } catch (err) {
      reporter.onWarning?.(`写入回收站清单失败：${errorMessage(err)}`);
    }
  }

  if (cache) {
    cache.prune(new Set(scan.files.map((file) => file.path)));
    try {
      await cache.save();
    } catch (err) {
      reporter.onWarning?.(`保存哈希缓存失败：${errorMessage(err)}`);
    }
  }

  const result: CleanResult = {
    baseDir: config.baseDir,
    roots: config.baseDirs,
    dryRun: config.dryRun,
    config,
    scan: scan.stats,
    groups: outcome.groups,
    dirGroups: outcome.dirGroups,
    similarGroups: outcome.similarGroups,
    deleted,
    removedEmptyDirs,
    stats: buildStats({
      scan: scan.stats,
      outcome,
      smallFiles,
      targets,
      deleted,
      removedEmptyDirs,
      cache,
      hardlinksSkipped,
    }),
  };

  reporter.summary?.(result);

  if (config.reportFile) {
    try {
      await writeReport(config.reportFile, result);
    } catch (err) {
      reporter.onWarning?.(`写入报告失败：${errorMessage(err)}`);
    }
  }

  return result;
};

/** 兼容 v1 的入口名，注意：v2 起返回 Promise */
export const cleaner = clean;

/** 兼容旧导出：精确去重检测 */
export { detectExactDuplicates as detectDuplicates } from "./detector";
