import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "./error";
import type { DeleteRecord, FileInfo, Reporter } from "./types";
import { toPosix } from "./utils";

export interface ExecuteOptions {
  dryRun: boolean;
  trashDir: string | null;
  baseDir: string;
}

const toRecord = (file: FileInfo, hash?: string): DeleteRecord => ({
  path: file.path,
  relPath: file.relPath,
  size: file.size,
  hash,
  status: "planned",
});

const ensureDir = async (dir: string): Promise<void> => {
  await fs.promises.mkdir(dir, { recursive: true });
};

/** 在回收站中挑选不冲突的目标路径 */
const pickTrashPath = (trashDir: string, relPath: string): string => {
  const base = path.join(trashDir, relPath);
  if (!fs.existsSync(base)) return base;

  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let index = 1;
  let candidate = `${stem}.${index}${ext}`;
  while (fs.existsSync(candidate)) {
    index++;
    candidate = `${stem}.${index}${ext}`;
  }
  return candidate;
};

const moveToTrash = async (file: FileInfo, trashDir: string): Promise<void> => {
  const target = pickTrashPath(trashDir, file.relPath);
  await ensureDir(path.dirname(target));

  try {
    await fs.promises.rename(file.path, target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw err;
    // 跨设备时退化为复制 + 删除
    await fs.promises.copyFile(file.path, target);
    await fs.promises.unlink(file.path);
  }
};

/**
 * 按清单删除文件。
 * dryRun 下只产出 planned 记录，不做任何文件系统修改。
 */
export const deleteFiles = async (
  targets: Array<{ file: FileInfo; hash?: string }>,
  options: ExecuteOptions,
  reporter?: Reporter
): Promise<DeleteRecord[]> => {
  const records: DeleteRecord[] = [];

  for (const target of targets) {
    const record = toRecord(target.file, target.hash);

    if (options.dryRun) {
      reporter?.onDelete?.(record);
      records.push(record);
      continue;
    }

    try {
      if (options.trashDir) {
        await moveToTrash(target.file, options.trashDir);
        record.status = "trashed";
      } else {
        await fs.promises.unlink(target.file.path);
        record.status = "deleted";
      }
    } catch (err) {
      record.status = "failed";
      record.error = errorMessage(err);
    }

    reporter?.onDelete?.(record);
    records.push(record);
  }

  return records;
};

const isDirEmpty = async (dir: string): Promise<boolean> => {
  try {
    const entries = await fs.promises.readdir(dir);
    return entries.length === 0;
  } catch {
    return false;
  }
};

const byDepthDesc = (a: string, b: string): number =>
  b.split(path.sep).length - a.split(path.sep).length || b.localeCompare(a);

/**
 * 删除空目录。
 * - 永远跳过 baseDir 自身
 * - 由深到浅处理，rmdir 天然只对空目录成功
 * - dryRun 下模拟「文件被删后目录是否变空」，输出真实可删除清单
 */
export const removeEmptyDirs = async (
  dirs: string[],
  options: ExecuteOptions,
  deletedPaths: Set<string>,
  reporter?: Reporter
): Promise<DeleteRecord[]> => {
  const records: DeleteRecord[] = [];
  const resolvedBase = path.resolve(options.baseDir);
  const pending = new Set(deletedPaths);

  for (const dir of [...new Set(dirs)].sort(byDepthDesc)) {
    const absolute = path.resolve(dir);
    if (absolute === resolvedBase) continue;

    const relPath = toPosix(path.relative(resolvedBase, absolute));

    if (options.dryRun) {
      let entries: string[];
      try {
        entries = await fs.promises.readdir(absolute);
      } catch {
        continue;
      }

      const willBeEmpty = entries.every((entry) => pending.has(path.join(absolute, entry)));
      if (!willBeEmpty) continue;

      pending.add(absolute);
      const record: DeleteRecord = { path: absolute, relPath, size: 0, status: "planned" };
      records.push(record);
      reporter?.onEmptyDir?.(record);
      continue;
    }

    if (!(await isDirEmpty(absolute))) continue;

    try {
      await fs.promises.rmdir(absolute);
      pending.add(absolute);
      const record: DeleteRecord = { path: absolute, relPath, size: 0, status: "deleted" };
      records.push(record);
      reporter?.onEmptyDir?.(record);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // 目录不再为空或已被删除，属于正常竞态，静默跳过
      if (code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOENT") continue;

      const record: DeleteRecord = {
        path: absolute,
        relPath,
        size: 0,
        status: "failed",
        error: errorMessage(err),
      };
      records.push(record);
      reporter?.onEmptyDir?.(record);
    }
  }

  return records;
};
