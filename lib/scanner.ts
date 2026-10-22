import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "./error";
import { createMatcher, Ignorer } from "./matcher";
import type { CleanerConfig, FileInfo, Reporter, ScanStats } from "./types";
import { toPosix } from "./utils";

export interface ScanResult {
  files: FileInfo[];
  /** 小于 minFileSize 而被排除在去重之外的文件 */
  smallFiles: FileInfo[];
  /** 所有被遍历的子目录（绝对路径），用于空目录清理 */
  dirs: string[];
  stats: ScanStats;
}

const createStats = (): ScanStats => ({
  files: 0,
  dirs: 0,
  bytes: 0,
  skippedSmallFiles: 0,
  skippedSymlinks: 0,
  skippedUnreadable: 0,
  errors: [],
});

/** 为多根目录生成不冲突的可读标签（用作 relPath 前缀） */
export const buildRootLabels = (roots: string[]): string[] => {
  const used = new Map<string, number>();

  return roots.map((root, index) => {
    const raw = path.basename(root) || `root${index + 1}`;
    const base = raw.replace(/[\\/:*?"<>|]/g, "_");
    const key = base.toLowerCase();
    const count = used.get(key) || 0;
    used.set(key, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
};

/**
 * 扫描一个或多个根目录，产出稳定排序的文件列表。
 * - lstat 判定类型，软链接默认跳过，开启 followSymlinks 时做 realpath 越界与环路校验
 * - 单个条目出错只记录错误，不中断整体扫描
 * - 多根目录时 relPath 会带上根目录标签前缀，保证跨根唯一且可读
 */
export const scanFiles = async (
  config: CleanerConfig,
  reporter?: Reporter,
  signal?: AbortSignal
): Promise<ScanResult> => {
  const stats = createStats();
  const files: FileInfo[] = [];
  const smallFiles: FileInfo[] = [];
  const dirs: string[] = [];

  const roots = config.baseDirs?.length ? config.baseDirs : [config.baseDir];
  const labels = buildRootLabels(roots);
  const multiRoot = roots.length > 1;

  const progressStarted = Date.now();
  let lastProgressAt = 0;
  const reportProgress = () => {
    if (!reporter?.onProgress) return;
    const now = Date.now();
    if (now - lastProgressAt < 200) return;
    lastProgressAt = now;
    const elapsedMs = now - progressStarted;
    reporter.onProgress({
      phase: "scan",
      processed: stats.files + stats.dirs,
      bytes: stats.bytes,
      elapsedMs,
      speed: elapsedMs > 0 ? Math.round((stats.bytes * 1000) / elapsedMs) : undefined,
    });
  };

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
    const root = roots[rootIndex];
    const label = multiRoot ? labels[rootIndex] : "";
    const matcher = createMatcher(config.include, config.exclude);
    const ignorer = new Ignorer();

    for (const ignoreFile of config.ignoreFiles) {
      const target = path.isAbsolute(ignoreFile) ? ignoreFile : path.join(root, ignoreFile);
      if (fs.existsSync(target)) ignorer.addFile(target);
    }

    reporter?.onScanStart?.(root);

    let rootRealPath = root;
    try {
      rootRealPath = await fs.promises.realpath(root);
    } catch {
      // realpath 失败时退回原始路径，后续遍历仍会给出明确错误
    }

    const visitedRealPaths = new Set([rootRealPath]);
    const prefix = (relPath: string) => (label ? `${label}/${relPath}` : relPath);

    const walk = async (dir: string, relDir: string, depth: number): Promise<void> => {
      signal?.throwIfAborted();

      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (err) {
        stats.errors.push({ path: dir, message: errorMessage(err) });
        return;
      }

      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

      for (const entry of entries) {
        signal?.throwIfAborted();
        reportProgress();

        const localRelPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        const relPath = prefix(localRelPath);
        const fullPath = path.join(dir, entry.name);

        if (matcher.excludes(relPath) || ignorer.ignores(relPath)) continue;

        let isDirectory = entry.isDirectory();
        let isFile = entry.isFile();
        let isSymlink = entry.isSymbolicLink();

        if (isSymlink) {
          if (!config.followSymlinks) {
            stats.skippedSymlinks++;
            continue;
          }
          try {
            const realPath = await fs.promises.realpath(fullPath);
            const inside =
              realPath === rootRealPath || realPath.startsWith(rootRealPath + path.sep);
            if (!inside) {
              stats.errors.push({ path: fullPath, message: "软链接指向清理目录之外，已跳过" });
              continue;
            }
            if (visitedRealPaths.has(realPath)) {
              stats.errors.push({ path: fullPath, message: "检测到软链接环路，已跳过" });
              continue;
            }
            const stat = await fs.promises.stat(fullPath);
            isDirectory = stat.isDirectory();
            isFile = stat.isFile();
            if (isDirectory) visitedRealPaths.add(realPath);
          } catch (err) {
            stats.errors.push({ path: fullPath, message: errorMessage(err) });
            continue;
          }
        }

        if (isDirectory) {
          if (!config.isClearSubDir) continue;
          if (config.maxDepth >= 0 && depth + 1 > config.maxDepth) continue;

          stats.dirs++;
          dirs.push(fullPath);
          await walk(fullPath, localRelPath, depth + 1);
          continue;
        }

        if (!isFile) continue;
        if (!matcher.matches(relPath)) continue;

        try {
          const stat = isSymlink
            ? await fs.promises.stat(fullPath)
            : await fs.promises.lstat(fullPath);

          const info: FileInfo = {
            path: path.resolve(fullPath),
            relPath: toPosix(relPath),
            root,
            name: entry.name,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            ino: Number(stat.ino),
            dev: Number(stat.dev),
            isSymlink,
          };

          if (stat.size < config.minFileSize) {
            stats.skippedSmallFiles++;
            smallFiles.push(info);
            continue;
          }

          files.push(info);
          stats.files++;
          stats.bytes += stat.size;
          reporter?.onScanFile?.(info);
        } catch (err) {
          stats.skippedUnreadable++;
          stats.errors.push({ path: fullPath, message: errorMessage(err) });
        }
      }
    };

    await walk(root, "", 0);
  }

  if (reporter?.onProgress) {
    const elapsedMs = Date.now() - progressStarted;
    reporter.onProgress({
      phase: "scan",
      processed: stats.files + stats.dirs,
      bytes: stats.bytes,
      elapsedMs,
      speed: elapsedMs > 0 ? Math.round((stats.bytes * 1000) / elapsedMs) : undefined,
    });
  }

  // 排序保证跨平台、跨文件系统的确定性
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  smallFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
  dirs.sort((a, b) => a.localeCompare(b));

  return { files, smallFiles, dirs, stats };
};
