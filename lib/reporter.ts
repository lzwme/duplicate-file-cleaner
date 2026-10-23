import { color } from "console-log-colors";
import type {
  CleanerConfig,
  CleanResult,
  DeleteRecord,
  DuplicateDirGroup,
  DuplicateGroup,
  FileInfo,
  ProgressInfo,
  Reporter,
  SimilarGroup,
} from "./types";
import { formatBytes } from "./utils";

const PHASE_LABELS: Record<ProgressInfo["phase"], string> = {
  scan: "扫描",
  hash: "计算哈希",
  dir: "目录指纹",
  similar: "分析图片",
  delete: "删除",
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${Math.round(seconds % 60)}s`;
};

/** 控制台报告器：面向 CLI 的可读输出与进度显示 */
export class ConsoleReporter implements Reporter {
  private config: CleanerConfig;
  private lastProgressAt = 0;
  private progressVisible = false;

  constructor(config: CleanerConfig) {
    this.config = config;
  }

  private get silent(): boolean {
    return Boolean(this.config.silent);
  }

  /** 进度行会占用当前行，输出正式内容前先清除 */
  private clearProgress(): void {
    if (!this.progressVisible) return;
    process.stdout.write("\x1b[2K\r");
    this.progressVisible = false;
  }

  onScanStart(baseDir: string): void {
    if (this.silent) return;
    console.log(color.bgBlue("[INFO]"), "开始扫描：", baseDir);
  }

  onScanFile(file: FileInfo): void {
    if (!this.config.debug) return;
    this.clearProgress();
    console.log(color.bgYellow("[DEBUG]"), "扫描文件：", file.relPath);
  }

  onProgress(info: ProgressInfo): void {
    if (!this.config.progress || this.silent) return;
    if (!process.stdout.isTTY) return;

    const now = Date.now();
    if (now - this.lastProgressAt < 120) return;
    this.lastProgressAt = now;

    const label = PHASE_LABELS[info.phase];
    const parts = [`${label} ${info.processed}`];

    if (info.total && info.total > 0) {
      parts.push(`${Math.min(100, Math.round((info.processed / info.total) * 100))}%`);
    }

    parts.push(formatBytes(info.bytes));

    if (info.speed && info.speed > 0) {
      parts.push(`${formatBytes(info.speed)}/s`);

      if (info.bytesTotal && info.bytesTotal > info.bytes) {
        parts.push(`剩余 ${formatDuration((info.bytesTotal - info.bytes) / info.speed)}`);
      }
    }

    process.stdout.write(`\x1b[2K\r${color.gray(`[${parts.join(" | ")}]`)}`);
    this.progressVisible = true;
  }

  onGroup(group: DuplicateGroup): void {
    if (this.silent) return;
    this.clearProgress();

    const label = this.config.dryRun ? "待删除" : this.config.trashDir ? "移入回收站" : "删除";
    console.log(
      `\n${color.magenta("[重复组]")} ${formatBytes(group.size)} × ${group.files.length}  ${color.gray(
        `(${this.config.algorithm}:${group.hash.slice(0, 12)})`
      )}`
    );

    for (const file of group.keep) {
      console.log(`  ${color.green("保留")}  ${file.relPath}`);
    }
    for (const file of group.remove) {
      console.log(`  ${color.red(label)}  ${file.relPath}`);
    }
    if (group.hardlinks.length) {
      console.log(`  ${color.gray(`跳过 ${group.hardlinks.length} 个硬链接`)}`);
    }
  }

  onDirGroup(group: DuplicateDirGroup): void {
    if (this.silent) return;
    this.clearProgress();

    const label = this.config.dryRun ? "待删除" : this.config.trashDir ? "移入回收站" : "删除";
    console.log(
      `\n${color.magenta("[重复目录]")} ${group.fileCount} 个文件 / ${formatBytes(group.size)} × ${group.dirs.length}`
    );

    for (const dir of group.keep) console.log(`  ${color.green("保留")}  ${dir}`);
    for (const dir of group.remove) console.log(`  ${color.red(label)}  ${dir}`);
  }

  onSimilarGroup(group: SimilarGroup): void {
    if (this.silent) return;
    this.clearProgress();

    console.log(
      `\n${color.magenta("[相似图片]")} ${group.files.length} 张  ${color.gray(
        `(dHash:${group.hash}, 距离≤${group.distance})`
      )}`
    );
    for (const file of group.keep) console.log(`  ${color.green("保留")}  ${file.relPath}`);
    for (const file of group.remove) {
      const label = this.config.deleteSimilarImages
        ? this.config.dryRun
          ? "待删除"
          : "删除"
        : "相似";
      console.log(`  ${color.red(label)}  ${file.relPath}`);
    }
    if (!this.config.deleteSimilarImages) {
      console.log(`  ${color.gray("提示：相似图片默认只报告，需 --delete-similar 才会删除")}`);
    }
  }

  onDelete(record: DeleteRecord): void {
    if (this.config.debug && !this.silent) {
      this.clearProgress();
      const detail = record.status === "planned" ? "计划删除" : record.status;
      console.log(color.bgYellow("[DEBUG]"), `${detail}：`, record.relPath);
    }

    // 静默模式下仍然输出失败信息，便于 CI 与脚本发现问题
    if (record.status === "failed") {
      this.clearProgress();
      console.log(color.bgRed("[ERROR]"), `删除失败：${record.relPath}`, record.error || "");
    }
  }

  onEmptyDir(record: DeleteRecord): void {
    if (record.status === "failed") {
      this.clearProgress();
      console.log(color.bgRed("[ERROR]"), `删除空目录失败：${record.relPath}`, record.error || "");
      return;
    }
    if (this.silent) return;
    this.clearProgress();
    const label = record.status === "planned" ? "待删除空目录" : "已删除空目录";
    console.log(`  ${color.gray(label)}  ${record.relPath || "."}`);
  }

  onWarning(message: string): void {
    if (this.silent) return;
    this.clearProgress();
    console.log(color.bgYellow("[WARN]"), message);
  }

  summary(result: CleanResult): void {
    if (this.silent) return;
    this.clearProgress();

    const { stats } = result;
    const mode = result.dryRun ? "预览" : "执行";

    console.log("");
    console.log(
      color.bgGreen(`[${mode}]`),
      `扫描 ${stats.totalFiles} 个文件 / ${stats.totalDirs} 个目录 / ${formatBytes(stats.totalBytes)}`
    );

    if (stats.duplicateGroups > 0) {
      console.log(
        `  重复组 ${stats.duplicateGroups} 个，重复文件 ${stats.duplicateFiles} 个，可释放 ${formatBytes(
          stats.removableBytes
        )}`
      );
    } else if (!stats.duplicateDirs && !stats.similarGroups) {
      console.log("  未发现重复文件");
    }

    if (stats.duplicateDirs > 0) {
      console.log(`  重复目录 ${stats.duplicateDirs} 组`);
    }
    if (stats.similarGroups > 0) {
      console.log(
        `  相似图片 ${stats.similarGroups} 组${result.config.deleteSimilarImages ? "" : "（仅报告）"}`
      );
    }
    if (stats.hardlinksSkipped > 0) {
      console.log(`  跳过 ${stats.hardlinksSkipped} 个硬链接（不额外释放空间）`);
    }

    if (result.dryRun) {
      console.log(
        `  可删除 ${stats.removableFiles} 个文件 / ${stats.emptyDirsRemoved} 个空目录（未做任何修改）`
      );
      console.log(color.yellow("  提示：当前为预览模式，确认无误后加 --yes 执行删除"));
    } else {
      const action = result.config.trashDir ? "已移入回收站" : "已删除";
      console.log(
        `  ${action} ${stats.deletedFiles} 个文件（${formatBytes(stats.deletedBytes)}），` +
          `${stats.emptyDirsRemoved} 个空目录，失败 ${stats.failedFiles} 个`
      );
    }

    if (result.organize) {
      const action = result.dryRun ? "待归类" : "已归类";
      console.log(
        `  ${action} ${stats.movedFiles} 个文件（${formatBytes(stats.movedBytes)}）` +
          ` → ${result.organize.target}（按 ${result.organize.by} 分 ${Object.keys(result.organize.categories).length} 类）`
      );
    }

    if (stats.skippedSmallFiles > 0) {
      console.log(
        `  跳过 ${stats.skippedSmallFiles} 个小于 ${formatBytes(result.config.minFileSize)} 的文件`
      );
    }
    if (stats.skippedSymlinks > 0) {
      console.log(`  跳过 ${stats.skippedSymlinks} 个软链接`);
    }
    if (stats.cacheHits > 0) {
      console.log(`  哈希缓存命中 ${stats.cacheHits} 次`);
    }
    if (stats.errors.length > 0) {
      console.log(color.yellow(`  ${stats.errors.length} 个条目处理失败（详见报告或 --debug 输出）`));
    }
  }
}

/** 收集结果、不打印任何内容，供 --json 或上层程序使用 */
export class JsonReporter implements Reporter {
  result: CleanResult | null = null;

  summary(result: CleanResult): void {
    this.result = result;
  }
}

export const silentReporter: Reporter = {};
