import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "./error";
import type { DeleteRecord, Reporter } from "./types";
import { toPosix } from "./utils";

const MANIFEST_PREFIX = ".dfcleaner-manifest-";
const MANIFEST_VERSION = 1;

interface TrashManifestEntry {
  from: string;
  to: string;
  size: number;
}

export interface TrashManifest {
  version: number;
  createdAt: string;
  baseDir: string;
  entries: TrashManifestEntry[];
}

export interface RestoreResult {
  trashDir: string;
  dryRun: boolean;
  manifests: string[];
  restored: DeleteRecord[];
  skipped: DeleteRecord[];
  failed: DeleteRecord[];
}

const manifestName = (date = new Date()): string =>
  `${MANIFEST_PREFIX}${date.toISOString().replace(/[:.]/g, "-")}.json`;

/** 记录本次移入回收站的文件，便于 restore 精确还原 */
export const writeTrashManifest = async (
  trashDir: string,
  baseDir: string,
  records: DeleteRecord[]
): Promise<string | null> => {
  const entries: TrashManifestEntry[] = records
    .filter((record) => record.status === "trashed" && record.trashedTo)
    .map((record) => ({ from: record.path, to: record.trashedTo as string, size: record.size }));

  if (!entries.length) return null;

  const manifest: TrashManifest = {
    version: MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    baseDir,
    entries,
  };

  await fs.promises.mkdir(trashDir, { recursive: true });
  const filePath = path.join(trashDir, manifestName());
  await fs.promises.writeFile(filePath, JSON.stringify(manifest, null, 2), "utf8");
  return filePath;
};

/** 列出回收站中的 manifest（新到旧） */
export const listTrashManifests = (trashDir: string): string[] => {
  if (!fs.existsSync(trashDir)) return [];

  return fs
    .readdirSync(trashDir)
    .filter((name) => name.startsWith(MANIFEST_PREFIX) && name.endsWith(".json"))
    .sort()
    .reverse()
    .map((name) => path.join(trashDir, name));
};

const readManifest = (filePath: string): TrashManifest | null => {
  try {
    const manifest = JSON.parse(fs.readFileSync(filePath, "utf8")) as TrashManifest;
    if (!Array.isArray(manifest.entries)) return null;
    return manifest;
  } catch {
    return null;
  }
};

const moveFile = async (from: string, to: string): Promise<void> => {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });

  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw err;
    await fs.promises.copyFile(from, to);
    await fs.promises.unlink(from);
  }
};

/**
 * 从回收站还原文件。
 * 默认 dryRun，只打印将还原的清单；目标已存在时跳过，不覆盖用户数据。
 */
export const restoreFromTrash = async (
  trashDir: string,
  options: { dryRun: boolean; signal?: AbortSignal } = { dryRun: true },
  reporter?: Reporter
): Promise<RestoreResult> => {
  const absoluteTrash = path.resolve(trashDir);
  const manifests = listTrashManifests(absoluteTrash);
  const result: RestoreResult = {
    trashDir: absoluteTrash,
    dryRun: options.dryRun,
    manifests,
    restored: [],
    skipped: [],
    failed: [],
  };

  for (const manifestPath of manifests) {
    options.signal?.throwIfAborted();

    const manifest = readManifest(manifestPath);
    if (!manifest) {
      reporter?.onWarning?.(`无法解析回收站清单：${manifestPath}`);
      continue;
    }

    for (const entry of manifest.entries) {
      options.signal?.throwIfAborted();

      const relPath = toPosix(path.relative(manifest.baseDir || absoluteTrash, entry.from));
      const record: DeleteRecord = {
        path: entry.from,
        relPath,
        size: entry.size,
        status: options.dryRun ? "planned" : "deleted",
      };

      if (!fs.existsSync(entry.to)) {
        record.status = "failed";
        record.error = "回收站中的文件已不存在";
        result.failed.push(record);
        reporter?.onWarning?.(`还原失败：${relPath}（回收站中不存在）`);
        continue;
      }

      if (fs.existsSync(entry.from)) {
        record.status = "failed";
        record.error = "目标路径已存在，未覆盖";
        result.failed.push(record);
        reporter?.onWarning?.(`跳过还原：${relPath}（目标已存在）`);
        continue;
      }

      if (options.dryRun) {
        result.restored.push(record);
        continue;
      }

      try {
        await moveFile(entry.to, entry.from);
        result.restored.push(record);
      } catch (err) {
        record.status = "failed";
        record.error = errorMessage(err);
        result.failed.push(record);
      }
    }
  }

  return result;
};

/* istanbul ignore next -- 供 CLI 展示 */
export const formatRestoreSummary = (result: RestoreResult): string => {
  const mode = result.dryRun ? "预览" : "完成";
  const bytes = result.restored.reduce((total, record) => total + record.size, 0);
  return `[还原${mode}] 清单 ${result.manifests.length} 个，还原 ${result.restored.length} 个文件（${bytes} 字节），失败 ${result.failed.length} 个`;
};
