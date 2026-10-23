import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "./error";
import type {
  CleanerConfig,
  FileInfo,
  MoveRecord,
  OrganizeBy,
  OrganizeSummary,
  Reporter,
} from "./types";

const TYPE_BY_EXT: Record<string, string> = {
  // image
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", bmp: "image",
  tiff: "image", tif: "image", svg: "image", heic: "image", avif: "image", ico: "image",
  // video
  mp4: "video", mkv: "video", avi: "video", mov: "video", wmv: "video", flv: "video",
  webm: "video", m4v: "video",
  // audio
  mp3: "audio", wav: "audio", flac: "audio", aac: "audio", ogg: "audio", m4a: "audio",
  wma: "audio",
  // document
  pdf: "document", doc: "document", docx: "document", xls: "document", xlsx: "document",
  ppt: "document", pptx: "document", txt: "document", md: "document", rtf: "document",
  csv: "document", json: "document", xml: "document", yaml: "document", yml: "document",
  html: "document",
  // archive
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
  bz2: "archive", xz: "archive",
  // code
  js: "code", ts: "code", jsx: "code", tsx: "code", py: "code", java: "code", c: "code",
  cpp: "code", h: "code", go: "code", rs: "code", rb: "code", php: "code", sh: "code",
  css: "code", scss: "code", vue: "code",
};

const escapeCategory = (value: string): string => value.replace(/[\\/:*?"<>|]/g, "_") || "other";

/** 按维度计算归类目录名 */
export const categorize = (file: FileInfo, by: OrganizeBy): string => {
  const ext = path.extname(file.name).slice(1).toLowerCase();

  switch (by) {
    case "type":
      return TYPE_BY_EXT[ext] || "other";
    case "year": {
      const date = new Date(file.mtimeMs);
      return String(date.getFullYear());
    }
    case "month": {
      const date = new Date(file.mtimeMs);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }
    case "ext":
    default:
      return escapeCategory(ext || "noext");
  }
};

export interface OrganizePlan {
  moves: MoveRecord[];
  summary: OrganizeSummary;
}

/**
 * 预先计算所有移动目标，保证 dry-run 预览与真实执行完全一致。
 * 同名文件自动追加 `.1`、`.2` 后缀，不覆盖已有文件。
 */
export const planOrganize = (files: FileInfo[], config: CleanerConfig): OrganizePlan => {
  const targetRoot = config.organizeDir as string;
  const usedTargets = new Set<string>();
  const keyOf = (target: string) =>
    process.platform === "win32" ? target.toLowerCase() : target;

  const uniqueTarget = (dir: string, name: string): string => {
    const ext = path.extname(name);
    const stem = ext ? name.slice(0, name.length - ext.length) : name;
    let candidate = path.join(dir, name);
    let index = 1;

    while (fs.existsSync(candidate) || usedTargets.has(keyOf(candidate))) {
      candidate = path.join(dir, `${stem}.${index}${ext}`);
      index++;
    }

    usedTargets.add(keyOf(candidate));
    return candidate;
  };

  const moves: MoveRecord[] = [];
  const categories: OrganizeSummary["categories"] = {};

  for (const file of files) {
    const category = categorize(file, config.organizeBy);
    const to = uniqueTarget(path.join(targetRoot, category), file.name);

    moves.push({
      from: file.path,
      to,
      relPath: file.relPath,
      size: file.size,
      category,
      status: "planned",
    });

    const bucket = categories[category] || { files: 0, bytes: 0 };
    bucket.files++;
    bucket.bytes += file.size;
    categories[category] = bucket;
  }

  return {
    moves,
    summary: { by: config.organizeBy, target: targetRoot, categories },
  };
};

const moveFile = async (from: string, to: string): Promise<void> => {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw err;
    await fs.promises.copyFile(from, to);
    await fs.promises.unlink(from);
  }
};

/** 执行归类移动；dryRun 下只产出 planned 记录 */
export const organizeFiles = async (
  files: FileInfo[],
  config: CleanerConfig,
  reporter?: Reporter,
  signal?: AbortSignal
): Promise<OrganizePlan> => {
  const plan = planOrganize(files, config);

  for (const record of plan.moves) {
    signal?.throwIfAborted();

    if (config.dryRun) {
      reporter?.onMove?.(record);
      continue;
    }

    try {
      await fs.promises.mkdir(path.dirname(record.to), { recursive: true });
      await moveFile(record.from, record.to);
      record.status = "moved";
    } catch (err) {
      record.status = "failed";
      record.error = errorMessage(err);
    }

    reporter?.onMove?.(record);
  }

  return plan;
};
