import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "./error";
import type { FileInfo } from "./types";

interface HashCacheEntry {
  size: number;
  mtimeMs: number;
  hash: string;
}

interface CachePayload {
  version: number;
  algorithm: string;
  entries: Record<string, HashCacheEntry>;
}

const CACHE_VERSION = 1;

/**
 * 文件哈希缓存。
 * 以「绝对路径 + size + mtime」作为有效性判定，算法变化时整体失效。
 * 缓存读写失败不会中断清理流程，只会退化为无缓存运行。
 */
export class HashCache {
  readonly filePath: string;
  readonly algorithm: string;
  hits = 0;

  private entries = new Map<string, HashCacheEntry>();
  private dirty = false;

  constructor(filePath: string, algorithm: string) {
    this.filePath = path.resolve(filePath);
    this.algorithm = algorithm;
  }

  static load(filePath: string, algorithm: string, warn?: (message: string) => void): HashCache {
    const cache = new HashCache(filePath, algorithm);

    if (!fs.existsSync(cache.filePath)) return cache;

    try {
      const payload = JSON.parse(fs.readFileSync(cache.filePath, "utf8")) as CachePayload;

      if (payload.version !== CACHE_VERSION || payload.algorithm !== algorithm) {
        warn?.(`哈希缓存版本或算法不匹配，已忽略：${cache.filePath}`);
        return cache;
      }

      for (const [key, entry] of Object.entries(payload.entries || {})) {
        if (
          entry &&
          typeof entry.hash === "string" &&
          typeof entry.size === "number" &&
          typeof entry.mtimeMs === "number"
        ) {
          cache.entries.set(key, entry);
        }
      }
    } catch (err) {
      warn?.(`读取哈希缓存失败，已忽略：${errorMessage(err)}`);
    }

    return cache;
  }

  get size(): number {
    return this.entries.size;
  }

  /** 命中则返回哈希，并用 size + mtime 校验有效性 */
  get(file: FileInfo): string | undefined {
    const entry = this.entries.get(file.path);
    if (!entry) return undefined;
    if (entry.size !== file.size || entry.mtimeMs !== file.mtimeMs) return undefined;

    this.hits++;
    return entry.hash;
  }

  set(file: FileInfo, hash: string): void {
    this.entries.set(file.path, { size: file.size, mtimeMs: file.mtimeMs, hash });
    this.dirty = true;
  }

  /** 仅保留本次出现的路径，避免缓存无限膨胀 */
  prune(alivePaths: Set<string>): void {
    for (const key of this.entries.keys()) {
      if (!alivePaths.has(key)) {
        this.entries.delete(key);
        this.dirty = true;
      }
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;

    const payload: CachePayload = {
      version: CACHE_VERSION,
      algorithm: this.algorithm,
      entries: Object.fromEntries(this.entries),
    };

    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(payload), "utf8");
    await fs.promises.rename(tempPath, this.filePath);
    this.dirty = false;
  }
}
