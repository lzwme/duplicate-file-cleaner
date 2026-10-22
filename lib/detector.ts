import crypto from "node:crypto";
import path from "node:path";
import type { HashCache } from "./cache";
import { hashFiles, mapLimit } from "./hasher";
import { hammingDistance, isImageFile, safeImageHash } from "./image-hash";
import { selectKeep } from "./policy";
import type {
  CleanerConfig,
  DuplicateDirGroup,
  DuplicateGroup,
  FileInfo,
  Reporter,
  ScanError,
  SimilarGroup,
} from "./types";
import { isInside, toPosix } from "./utils";

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

const sumSize = (files: FileInfo[]): number => files.reduce((total, file) => total + file.size, 0);

/** 拆出指向同一 inode 的硬链接，避免把它们当作可释放空间 */
const splitHardlinks = (files: FileInfo[]): { unique: FileInfo[]; hardlinks: FileInfo[] } => {
  const seen = new Set<string>();
  const unique: FileInfo[] = [];
  const hardlinks: FileInfo[] = [];

  for (const file of files) {
    const inodeKey = file.ino > 0 ? `${file.dev}:${file.ino}` : "";

    if (inodeKey && seen.has(inodeKey)) {
      hardlinks.push(file);
      continue;
    }

    if (inodeKey) seen.add(inodeKey);
    unique.push(file);
  }

  return { unique, hardlinks };
};

const createProgressReporter = (
  phase: "hash" | "dir" | "similar",
  totalBytes: number,
  reporter: Reporter | undefined
) => {
  const started = Date.now();

  return (processed: number, bytes: number, total = totalBytes) => {
    if (!reporter?.onProgress) return;
    const elapsedMs = Date.now() - started;
    reporter.onProgress({
      phase,
      processed,
      bytes,
      bytesTotal: total,
      elapsedMs,
      speed: elapsedMs > 0 ? Math.round((bytes * 1000) / elapsedMs) : undefined,
    });
  };
};

/**
 * 精确去重：
 * 1. 按 size（关闭跨目录比较时附加目录前缀）粗分桶
 * 2. 同尺寸候选做头部采样哈希
 * 3. 采样相同的候选做全量哈希
 * 4. 拆分硬链接，再用保留策略决定去留
 */
export const detectExactDuplicates = async (
  files: FileInfo[],
  config: CleanerConfig,
  errors: ScanError[],
  reporter?: Reporter,
  signal?: AbortSignal,
  cache?: HashCache | null
): Promise<DuplicateGroup[]> => {
  const buckets = new Map<string, FileInfo[]>();

  for (const file of files) {
    const key = `${config.compareAllDir ? "" : path.dirname(file.path)}\u0000${file.size}`;
    const list = buckets.get(key);
    if (list) list.push(file);
    else buckets.set(key, [file]);
  }

  const candidates = [...buckets.values()].filter((bucket) => bucket.length > 1);
  const candidateBytes = candidates.reduce((total, bucket) => total + sumSize(bucket), 0);
  const onProgress = createProgressReporter("hash", candidateBytes, reporter);

  const refined: FileInfo[][] = [];
  for (const bucket of candidates) {
    // 采样长度不小于文件本身时，采样哈希等价于全量哈希
    if (config.sampleSize > 0 && config.sampleSize < bucket[0].size) {
      const results = await hashFiles(
        bucket,
        {
          algorithm: config.algorithm,
          concurrency: config.concurrency,
          sampleSize: config.sampleSize,
          cache,
          onProgress,
        },
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
      for (const list of groups.values()) {
        if (list.length > 1) refined.push(list);
      }
    } else {
      refined.push(bucket);
    }
  }

  const result: DuplicateGroup[] = [];

  for (const bucket of refined) {
    const results = await hashFiles(
      bucket,
      { algorithm: config.algorithm, concurrency: config.concurrency, sampleSize: 0, cache, onProgress },
      errors,
      signal
    );

    const groups = new Map<string, FileInfo[]>();
    for (const item of results) {
      if (!item.hash) continue;
      const list = groups.get(item.hash);
      if (list) list.push(item.file);
      else groups.set(item.hash, [item.file]);
    }

    for (const [hash, list] of groups) {
      if (list.length < 2) continue;

      const { unique, hardlinks } = splitHardlinks(list);
      if (unique.length < 2) continue;

      const decision = selectKeep(unique, {
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
        hardlinks,
        savedBytes: sumSize(decision.remove),
      };

      result.push(group);
      reporter?.onGroup?.(group);
    }
  }

  result.sort((a, b) => b.size - a.size || a.hash.localeCompare(b.hash));
  return result;
};

interface DirAggregate {
  signature: string;
  fileCount: number;
  size: number;
  mtimeMs: number;
}

const createDirAggregates = (
  files: FileInfo[],
  hashes: Map<string, string>,
  baseDir: string,
  dirs: string[]
): Map<string, DirAggregate> => {
  const directFiles = new Map<string, FileInfo[]>();
  for (const file of files) {
    const dir = path.dirname(file.path);
    const list = directFiles.get(dir);
    if (list) list.push(file);
    else directFiles.set(dir, [file]);
  }

  const allDirs = [baseDir, ...dirs];
  const dirSet = new Set(allDirs);
  const childDirs = new Map<string, string[]>();

  for (const dir of allDirs) {
    const parent = path.dirname(dir);
    if (parent === dir || !dirSet.has(parent)) continue;
    const list = childDirs.get(parent);
    if (list) list.push(dir);
    else childDirs.set(parent, [dir]);
  }

  const depth = (dir: string) => dir.split(path.sep).length;
  const ordered = [...allDirs].sort((a, b) => depth(b) - depth(a));
  const aggregates = new Map<string, DirAggregate>();

  for (const dir of ordered) {
    const entries: string[] = [];
    let fileCount = 0;
    let size = 0;
    let mtimeMs = 0;

    for (const file of directFiles.get(dir) || []) {
      const hash = hashes.get(file.path);
      if (!hash) continue;
      entries.push(`f:${file.name}:${hash}`);
      fileCount++;
      size += file.size;
      mtimeMs = Math.max(mtimeMs, file.mtimeMs);
    }

    for (const child of childDirs.get(dir) || []) {
      const aggregate = aggregates.get(child);
      if (!aggregate) continue;
      entries.push(`d:${path.basename(child)}:${aggregate.signature}`);
      fileCount += aggregate.fileCount;
      size += aggregate.size;
      mtimeMs = Math.max(mtimeMs, aggregate.mtimeMs);
    }

    entries.sort();
    aggregates.set(dir, {
      signature: sha256(entries.join("\n")),
      fileCount,
      size,
      mtimeMs,
    });
  }

  return aggregates;
};

/**
 * 重复目录检测：自底向上聚合「文件名 + 内容哈希 + 子目录签名」，
 * 得到整棵目录树的指纹，再按指纹分组。
 */
export const detectDuplicateDirs = async (
  files: FileInfo[],
  config: CleanerConfig,
  dirs: string[],
  errors: ScanError[],
  reporter?: Reporter,
  signal?: AbortSignal,
  cache?: HashCache | null
): Promise<DuplicateDirGroup[]> => {
  if (!dirs.length || files.length < 2) return [];

  const totalBytes = sumSize(files);
  const onProgress = createProgressReporter("dir", totalBytes, reporter);

  const results = await hashFiles(
    files,
    { algorithm: config.algorithm, concurrency: config.concurrency, sampleSize: 0, cache, onProgress },
    errors,
    signal
  );

  const hashes = new Map<string, string>();
  for (const result of results) {
    if (result.hash) hashes.set(result.file.path, result.hash);
  }

  const roots = config.baseDirs?.length ? config.baseDirs : [config.baseDir];
  const aggregates = new Map<string, DirAggregate>();
  const rootOfDir = new Map<string, string>();

  for (const root of roots) {
    const rootFiles = files.filter((file) => isInside(root, file.path));
    const rootDirs = dirs.filter((dir) => isInside(root, dir));
    if (!rootFiles.length || !rootDirs.length) continue;

    const rootAggregates = createDirAggregates(rootFiles, hashes, root, rootDirs);
    for (const [dir, aggregate] of rootAggregates) {
      aggregates.set(dir, aggregate);
      rootOfDir.set(dir, root);
    }
  }

  const rootSet = new Set(roots);
  const buckets = new Map<string, string[]>();
  for (const [dir, aggregate] of aggregates) {
    if (rootSet.has(dir) || aggregate.fileCount === 0) continue;
    const key = `${aggregate.fileCount}\u0000${aggregate.signature}`;
    const list = buckets.get(key);
    if (list) list.push(dir);
    else buckets.set(key, [dir]);
  }

  const result: DuplicateDirGroup[] = [];

  for (const groupDirs of buckets.values()) {
    if (groupDirs.length < 2) continue;

    // 去掉嵌套在同一组其他目录之下的目录，避免整组重复计算
    const filtered = groupDirs.filter(
      (dir) => !groupDirs.some((other) => other !== dir && isInside(other, dir))
    );
    if (filtered.length < 2) continue;

    const pseudoFiles: FileInfo[] = filtered.map((dir) => {
      const aggregate = aggregates.get(dir) as DirAggregate;
      const ownerRoot = rootOfDir.get(dir) || config.baseDir;
      return {
        path: dir,
        relPath: toPosix(path.relative(ownerRoot, dir)),
        name: path.basename(dir),
        size: aggregate.size,
        mtimeMs: aggregate.mtimeMs,
        ino: 0,
        dev: 0,
        isSymlink: false,
      };
    });

    const decision = selectKeep(pseudoFiles, {
      keep: config.keep,
      keepStrategy: config.keepStrategy,
      preferDirs: config.preferDirs,
    });

    if (!decision.remove.length) continue;

    const aggregate = aggregates.get(filtered[0]) as DirAggregate;
    const group: DuplicateDirGroup = {
      hash: aggregate.signature,
      dirs: filtered,
      keep: decision.keep.map((item) => item.path),
      remove: decision.remove.map((item) => item.path),
      fileCount: aggregate.fileCount,
      size: aggregate.size,
    };

    result.push(group);
    reporter?.onDirGroup?.(group);
  }

  // 若某组的目录全部位于其他组的目录之下，说明它只是上层重复目录的一部分，去掉以免重复报告
  if (result.length > 1) {
    const covered = result.filter((group) =>
      group.dirs.every((dir) =>
        result.some(
          (other) =>
            other !== group &&
            other.dirs.some((otherDir) => otherDir !== dir && isInside(otherDir, dir))
        )
      )
    );
    const filtered = result.filter((group) => !covered.includes(group));
    result.length = 0;
    result.push(...filtered);
  }

  result.sort((a, b) => b.size - a.size || a.hash.localeCompare(b.hash));
  return result;
};

/**
 * 相似图片检测：dHash + 汉明距离，贪心聚类。
 * 默认只报告，不删除；需要显式开启 deleteSimilarImages。
 */
export const detectSimilarImages = async (
  files: FileInfo[],
  config: CleanerConfig,
  errors: ScanError[],
  reporter?: Reporter,
  signal?: AbortSignal
): Promise<SimilarGroup[]> => {
  const candidates = files.filter(isImageFile);
  if (candidates.length < 2) return [];

  const totalBytes = sumSize(candidates);
  const onProgress = createProgressReporter("similar", totalBytes, reporter);
  let processed = 0;
  let bytes = 0;

  const hashed = await mapLimit(candidates, config.concurrency, async (file) => {
    signal?.throwIfAborted();
    const result = await safeImageHash(file);
    processed++;
    bytes += file.size;
    onProgress(processed, bytes, totalBytes);

    if (!result.hash) {
      errors.push({ path: file.path, message: `图片解析失败：${result.error || "unknown"}` });
    }
    return result;
  });

  interface Cluster {
    hash: string;
    files: FileInfo[];
    distance: number;
  }

  const clusters: Cluster[] = [];

  for (const item of hashed) {
    if (!item.hash) continue;

    let matched: Cluster | null = null;
    let matchedDistance = Number.POSITIVE_INFINITY;

    for (const cluster of clusters) {
      const distance = hammingDistance(cluster.hash, item.hash);
      if (distance <= config.similarThreshold && distance < matchedDistance) {
        matched = cluster;
        matchedDistance = distance;
      }
    }

    if (matched) {
      matched.files.push(item.file);
      matched.distance = Math.max(matched.distance, matchedDistance);
    } else {
      clusters.push({ hash: item.hash, files: [item.file], distance: 0 });
    }
  }

  const result: SimilarGroup[] = [];
  for (const cluster of clusters) {
    if (cluster.files.length < 2) continue;

    const decision = selectKeep(cluster.files, {
      keep: config.keep,
      keepStrategy: config.keepStrategy,
      preferDirs: config.preferDirs,
    });

    const group: SimilarGroup = {
      hash: cluster.hash,
      distance: cluster.distance,
      files: cluster.files,
      keep: decision.keep,
      remove: decision.remove,
    };

    result.push(group);
    reporter?.onSimilarGroup?.(group);
  }

  result.sort((a, b) => b.files.length - a.files.length || a.hash.localeCompare(b.hash));
  return result;
};
