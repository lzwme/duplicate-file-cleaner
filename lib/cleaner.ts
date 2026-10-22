import fs from "node:fs";
import path from "node:path";
import { resolveConfig } from "./config";
import { CleanerError, errorMessage } from "./error";
import { deleteFiles, removeEmptyDirs } from "./executor";
import { hashFiles } from "./hasher";
import { selectKeep } from "./policy";
import { silentReporter } from "./reporter";
import { scanFiles } from "./scanner";
import type {
  CleanOptions,
  CleanResult,
  CleanStats,
  CleanerConfig,
  DuplicateGroup,
  FileInfo,
  Reporter,
  ScanError,
  UserConfig,
} from "./types";

/** 校验 baseDir 是否存在且安全 */
const assertBaseDir = (baseDir: string): void => {
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
};

const groupByHash = async (
  files: FileInfo[],
  config: CleanerConfig,
  errors: ScanError[],
  signal: AbortSignal | undefined,
  sampleSize: number
): Promise<Map<string, FileInfo[]>> => {
  const results = await hashFiles(
    files,
    { algorithm: config.algorithm, concurrency: config.concurrency, sampleSize },
    errors,
    signal
  );

  const groups = new Map<string, FileInfo[]>();
  for (const result of results) {
    if (!result.hash) continue;
    const list = groups.get(result.hash);
    if (list) list.push(result.file);
    else groups.set(result.hash, [result.file]);
  }
  return groups;
};

/**
 * 分层去重：
 * 1. 按 size（跨目录比较关闭时再加目录前缀）粗分桶
 * 2. 仅对同尺寸候选做头部采样哈希
 * 3. 仅对采样相同的候选做全量哈希
 */
export const detectDuplicates = async (
  files: FileInfo[],
  config: CleanerConfig,
  errors: ScanError[],
  reporter?: Reporter,
  signal?: AbortSignal
): Promise<DuplicateGroup[]> => {
  const buckets = new Map<string, FileInfo[]>();
  for (const file of files) {
    const key = `${config.compareAllDir ? "" : path.dirname(file.path)}\u0000${file.size}`;
    const list = buckets.get(key);
    if (list) list.push(file);
    else buckets.set(key, [file]);
  }

  const refined: FileInfo[][] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    // 采样长度不小于文件本身时，采样哈希等价于全量哈希，直接进入下一阶段
    if (config.sampleSize > 0 && config.sampleSize < bucket[0].size) {
      const groups = await groupByHash(bucket, config, errors, signal, config.sampleSize);
      for (const list of groups.values()) {
        if (list.length > 1) refined.push(list);
      }
    } else {
      refined.push(bucket);
    }
  }

  const result: DuplicateGroup[] = [];

  for (const bucket of refined) {
    const groups = await groupByHash(bucket, config, errors, signal, 0);

    for (const [hash, list] of groups) {
      if (list.length < 2) continue;

      const decision = selectKeep(list, {
        keep: config.keep,
        keepStrategy: config.keepStrategy,
        preferDirs: config.preferDirs,
      });

      if (!decision.remove.length) continue;

      const group: DuplicateGroup = {
        hash,
        size: list[0].size,
        files: list,
        keep: decision.keep,
        remove: decision.remove,
        savedBytes: decision.remove.reduce((total, file) => total + file.size, 0),
      };

      result.push(group);
      reporter?.onGroup?.(group);
    }
  }

  result.sort((a, b) => b.size - a.size || a.hash.localeCompare(b.hash));
  return result;
};

const buildStats = (
  scan: CleanResult["scan"],
  groups: DuplicateGroup[],
  smallFiles: FileInfo[],
  deleted: CleanResult["deleted"],
  removedEmptyDirs: CleanResult["removedEmptyDirs"]
): CleanStats => {
  const removableFiles =
    groups.reduce((total, group) => total + group.remove.length, 0) + smallFiles.length;
  const removableBytes =
    groups.reduce((total, group) => total + group.savedBytes, 0) +
    smallFiles.reduce((total, file) => total + file.size, 0);
  const succeeded = deleted.filter((record) => record.status === "deleted" || record.status === "trashed");

  return {
    totalFiles: scan.files + smallFiles.length,
    totalDirs: scan.dirs,
    totalBytes: scan.bytes + smallFiles.reduce((total, file) => total + file.size, 0),
    duplicateGroups: groups.length,
    duplicateFiles: groups.reduce((total, group) => total + group.files.length, 0),
    removableFiles,
    removableBytes,
    deletedFiles: succeeded.length,
    deletedBytes: succeeded.reduce((total, record) => total + record.size, 0),
    failedFiles: deleted.filter((record) => record.status === "failed").length,
    emptyDirsRemoved: removedEmptyDirs.filter((record) => record.status !== "failed").length,
    skippedSmallFiles: scan.skippedSmallFiles,
    skippedSymlinks: scan.skippedSymlinks,
    errors: scan.errors,
  };
};

/** 生成可序列化的报告内容 */
const createReport = (result: CleanResult) => ({
  baseDir: result.baseDir,
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
    savedBytes: group.savedBytes,
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
 * 默认 dryRun=true（与 DEFAULT_CONFIG 一致），只有显式关闭才会修改磁盘。
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

  assertBaseDir(config.baseDir);

  const scan = await scanFiles(config, reporter, options.signal);
  const groups = await detectDuplicates(scan.files, config, scan.stats.errors, reporter, options.signal);

  const smallFiles = config.deleteMinSizeFiles ? scan.smallFiles : [];
  const totalCandidates = scan.stats.files + smallFiles.length;
  const removableFiles =
    groups.reduce((total, group) => total + group.remove.length, 0) + smallFiles.length;

  if (
    !config.dryRun &&
    config.maxDeleteRatio > 0 &&
    totalCandidates > 0 &&
    removableFiles / totalCandidates > config.maxDeleteRatio
  ) {
    throw new CleanerError(
      `本次将删除 ${removableFiles} / ${totalCandidates} 个文件，超过比例上限 ${(
        config.maxDeleteRatio * 100
      ).toFixed(0)}%。已中止，请检查配置或调高 maxDeleteRatio`,
      "DELETE_RATIO_EXCEEDED"
    );
  }

  const targets = [
    ...groups.flatMap((group) => group.remove.map((file) => ({ file, hash: group.hash }))),
    ...smallFiles.map((file) => ({ file, hash: undefined })),
  ];

  const executeOptions = {
    dryRun: config.dryRun,
    trashDir: config.trashDir,
    baseDir: config.baseDir,
  };

  const deleted = await deleteFiles(targets, executeOptions, reporter);

  const deletedPaths = new Set(
    deleted.filter((record) => record.status !== "failed").map((record) => record.path)
  );
  const removedEmptyDirs = config.isDelEmptyDir
    ? await removeEmptyDirs(scan.dirs, executeOptions, deletedPaths, reporter)
    : [];

  const result: CleanResult = {
    baseDir: config.baseDir,
    dryRun: config.dryRun,
    config,
    scan: scan.stats,
    groups,
    deleted,
    removedEmptyDirs,
    stats: buildStats(scan.stats, groups, smallFiles, deleted, removedEmptyDirs),
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
