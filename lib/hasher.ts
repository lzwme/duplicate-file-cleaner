import fs from "node:fs";
import crypto from "node:crypto";
import type { HashCache } from "./cache";
import { errorMessage } from "./error";
import type { FileInfo, ScanError } from "./types";

/**
 * 计算文件哈希。
 * sampleSize > 0 时只读取文件头部若干字节，用于低成本预判。
 */
export const hashFile = async (
  filePath: string,
  algorithm = "sha256",
  sampleSize = 0
): Promise<string> => {
  const hash = crypto.createHash(algorithm);

  if (sampleSize > 0) {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(sampleSize);
      const { bytesRead } = await handle.read(buffer, 0, sampleSize, 0);
      hash.update(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
    return hash.digest("hex");
  }

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });

  return hash.digest("hex");
};

/** 限制并发地执行异步任务 */
export const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (!items.length) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  const workers = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await handler(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

export interface HashTaskResult {
  file: FileInfo;
  hash: string | null;
  error?: string;
}

export interface HashFilesOptions {
  algorithm: string;
  concurrency: number;
  sampleSize?: number;
  /** 哈希缓存（可选） */
  cache?: HashCache | null;
  /** 每完成一个文件回调一次 */
  onProgress?: (processed: number, bytes: number, totalBytes: number) => void;
}

/**
 * 并发计算一组文件的哈希，单个文件失败不会中断整组。
 * 优先使用缓存（按 size + mtime 校验），失败项写入 errors。
 */
export const hashFiles = async (
  files: FileInfo[],
  options: HashFilesOptions,
  errors: ScanError[],
  signal?: AbortSignal
): Promise<HashTaskResult[]> => {
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  const sampleSize = options.sampleSize || 0;
  const cache = options.cache || null;
  let processed = 0;
  let hashedBytes = 0;

  return mapLimit(files, options.concurrency, async (file) => {
    signal?.throwIfAborted();

    const cached = cache?.get(file);

    if (cached) {
      processed++;
      hashedBytes += file.size;
      options.onProgress?.(processed, hashedBytes, totalBytes);
      return { file, hash: cached };
    }

    try {
      const hash = await hashFile(file.path, options.algorithm, sampleSize);
      cache?.set(file, hash);
      processed++;
      hashedBytes += file.size;
      options.onProgress?.(processed, hashedBytes, totalBytes);
      return { file, hash };
    } catch (err) {
      const message = errorMessage(err);
      errors.push({ path: file.path, message });
      processed++;
      hashedBytes += file.size;
      options.onProgress?.(processed, hashedBytes, totalBytes);
      return { file, hash: null, error: message };
    }
  });
};
