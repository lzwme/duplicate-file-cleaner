import { color } from "console-log-colors";
import type {
  CleanerConfig,
  CleanResult,
  DeleteRecord,
  DuplicateGroup,
  FileInfo,
  Reporter,
} from "./types";
import { formatBytes } from "./utils";

/** 控制台报告器：面向 CLI 的可读输出 */
export class ConsoleReporter implements Reporter {
  private config: CleanerConfig;

  constructor(config: CleanerConfig) {
    this.config = config;
  }

  private get silent(): boolean {
    return Boolean(this.config.silent);
  }

  onScanStart(baseDir: string): void {
    if (this.silent) return;
    console.log(color.bgBlue("[INFO]"), "开始扫描：", baseDir);
  }

  onScanFile(file: FileInfo): void {
    if (!this.config.debug) return;
    console.log(color.bgYellow("[DEBUG]"), "扫描文件：", file.relPath);
  }

  onGroup(group: DuplicateGroup): void {
    if (this.silent) return;

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
  }

  onDelete(record: DeleteRecord): void {
    if (this.config.debug && !this.silent) {
      const detail = record.status === "planned" ? "计划删除" : record.status;
      console.log(color.bgYellow("[DEBUG]"), `${detail}：`, record.relPath);
    }

    // 静默模式下仍然输出失败信息，便于 CI 与脚本发现问题
    if (record.status === "failed") {
      console.log(color.bgRed("[ERROR]"), `删除失败：${record.relPath}`, record.error || "");
    }
  }

  onEmptyDir(record: DeleteRecord): void {
    if (record.status === "failed") {
      console.log(color.bgRed("[ERROR]"), `删除空目录失败：${record.relPath}`, record.error || "");
      return;
    }
    if (this.silent) return;
    const label = record.status === "planned" ? "待删除空目录" : "已删除空目录";
    console.log(`  ${color.gray(label)}  ${record.relPath || "."}`);
  }

  onWarning(message: string): void {
    if (this.silent) return;
    console.log(color.bgYellow("[WARN]"), message);
  }

  summary(result: CleanResult): void {
    if (this.silent) return;

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
    } else {
      console.log("  未发现重复文件");
    }

    if (result.dryRun) {
      console.log(
        `  可删除 ${stats.removableFiles} 个文件 / ${stats.emptyDirsRemoved} 个空目录（未做任何修改）`
      );
      console.log(color.yellow("  提示：当前为预览模式，确认无误后加 --yes 执行删除"));
    } else {
      const action = this.config.trashDir ? "已移入回收站" : "已删除";
      console.log(
        `  ${action} ${stats.deletedFiles} 个文件（${formatBytes(stats.deletedBytes)}），` +
          `${stats.emptyDirsRemoved} 个空目录，失败 ${stats.failedFiles} 个`
      );
    }

    if (stats.skippedSmallFiles > 0) {
      console.log(`  跳过 ${stats.skippedSmallFiles} 个小于 ${formatBytes(this.config.minFileSize)} 的文件`);
    }
    if (stats.skippedSymlinks > 0) {
      console.log(`  跳过 ${stats.skippedSymlinks} 个软链接`);
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
