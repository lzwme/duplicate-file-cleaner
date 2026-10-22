#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Option, program } from "commander";
import { color } from "console-log-colors";
import { clean } from "./cleaner";
import { CONF_FILE_CANDIDATES, CONF_FILE_NAME, resolveConfig } from "./config";
import { isCleanerError } from "./error";
import { ConsoleReporter } from "./reporter";
import { restoreFromTrash, type RestoreResult } from "./trash";
import { DETECT_MODES, KEEP_STRATEGIES, type UserConfig } from "./types";
import { formatBytes, parseSize } from "./utils";

const pkg = require("../package.json");

const collectList = (value: string, previous: string[] = []): string[] =>
  previous.concat(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );

const collectMany = (value: string, previous: string[] = []): string[] => previous.concat(value);

const jsonReplacer = (_key: string, value: unknown): unknown =>
  value instanceof RegExp ? value.toString() : value;

const DEFAULT_CACHE_FILE = ".dfcleaner-cache.json";

program
  .name("dfcleaner")
  .version(pkg.version, "-v, --version", "输出版本号")
  .description(`${pkg.description} [version ${pkg.version}]`)
  .option("-d, --dir <path>", "要清理的目录，默认当前目录")
  .option("-c, --config <file>", `配置文件路径，默认在当前目录查找 ${CONF_FILE_NAME} 等`)
  .option("-y, --yes", "确认执行删除。未指定时仅预览，不修改任何文件")
  .option("--dry-run", "强制预览模式（与 --yes 同时使用时以预览为准）")
  .addOption(
    new Option("--detect <mode>", "检测模式：exact 精确去重 / dir 重复目录 / both")
      .choices(DETECT_MODES as unknown as string[])
      .default("exact")
  )
  .option("--no-compare-all-dir", "仅在相同目录内比较重复文件")
  .option("--no-clear-sub-dir", "不处理子目录")
  .option("--no-del-empty-dir", "不删除空目录")
  .option("--min-file-size <size>", "小于该尺寸的文件不参与去重，支持 1kb / 10mb 等写法", "0")
  .option("--delete-min-size-files", "删除小于 min-file-size 的文件（危险，默认关闭）")
  .addOption(
    new Option("--keep <number>", "每个重复组保留的份数").default(1).argParser((value) => Number(value))
  )
  .addOption(
    new Option("--keep-strategy <strategy>", "保留策略")
      .choices(KEEP_STRATEGIES as unknown as string[])
      .default("first")
  )
  .option("--prefer <dir>", "优先保留该目录下的文件，可重复指定", collectMany, [])
  .option("--include <patterns>", "只处理命中的文件，支持 glob，逗号分隔", collectList, [])
  .option("--exclude <patterns>", "排除命中的文件/目录，支持 glob，逗号分隔", collectList, [])
  .option("--follow-symlinks", "跟随软链接（默认跳过）")
  .option("--max-depth <number>", "最大递归深度，-1 表示不限制", "-1")
  .option("--algorithm <name>", "哈希算法：md5 / sha1 / sha256 / sha512", "sha256")
  .option("--concurrency <number>", "哈希并发数", "8")
  .option("--cache [file]", `启用哈希缓存，默认 ${DEFAULT_CACHE_FILE}`)
  .option("--similar-images", "检测相似图片（需要可选依赖 jimp）")
  .option("--similar-threshold <number>", "相似图片汉明距离阈值（0-64，越大越宽松）", "5")
  .option("--delete-similar", "删除相似图片（默认仅报告，需与 --yes 一起使用）")
  .option("--max-delete-ratio <ratio>", "允许删除的文件比例上限（0-1），0 表示不限制", "0")
  .option("--trash <dir>", "回收站目录。设置后删除改为移动到该目录，可人工恢复")
  .option("--restore <dir>", "从回收站还原文件（默认预览，加 --yes 执行）")
  .option("--watch", "监听目录变化并自动重复清理（默认预览）")
  .option("--report <file>", "将 JSON 报告写入指定文件")
  .option("--json", "以 JSON 输出完整结果")
  .option("--no-progress", "不显示进度条")
  .option("-q, --silent", "静默模式，仅输出错误")
  .option("--debug", "输出调试信息")
  .addOption(new Option("--file-min-size <kb>", "已废弃，等价于 --min-file-size，单位 KB").hideHelp())
  .parse(process.argv);

const options = program.opts();

const buildUserConfig = (): UserConfig => {
  const minFileSize =
    options.fileMinSize !== undefined
      ? Math.round(Number(options.fileMinSize) * 1024)
      : parseSize(options.minFileSize);

  const cacheFile =
    typeof options.cache === "string"
      ? options.cache
      : options.cache
        ? DEFAULT_CACHE_FILE
        : null;

  return {
    baseDir: options.dir,
    configPath: options.config === undefined ? undefined : options.config,
    dryRun: Boolean(options.dryRun) || !options.yes,
    detect: options.detect,
    compareAllDir: options.compareAllDir,
    isClearSubDir: options.clearSubDir,
    isDelEmptyDir: options.delEmptyDir,
    minFileSize,
    deleteMinSizeFiles: Boolean(options.deleteMinSizeFiles),
    keep: options.keep,
    keepStrategy: options.keepStrategy,
    preferDirs: options.prefer,
    include: options.include,
    exclude: options.exclude,
    followSymlinks: Boolean(options.followSymlinks),
    maxDepth: Number(options.maxDepth),
    algorithm: options.algorithm,
    concurrency: Number(options.concurrency),
    cacheFile,
    similarImages: Boolean(options.similarImages),
    similarThreshold: Number(options.similarThreshold),
    deleteSimilarImages: Boolean(options.deleteSimilar),
    maxDeleteRatio: Number(options.maxDeleteRatio),
    trashDir: options.trash,
    reportFile: options.report,
    progress: options.progress,
    silent: Boolean(options.silent),
    debug: Boolean(options.debug),
  };
};

const printRestore = (result: RestoreResult): void => {
  const bytes = result.restored.reduce((total, record) => total + record.size, 0);
  const mode = result.dryRun ? "预览" : "完成";

  if (!options.json && !options.silent) {
    for (const record of result.restored) {
      console.log(`  ${result.dryRun ? color.yellow("将还原") : color.green("已还原")}  ${record.relPath}`);
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, jsonReplacer, 2)}\n`);
    return;
  }

  if (options.silent) return;

  console.log(
    color.bgGreen(`[还原${mode}]`),
    `清单 ${result.manifests.length} 个，还原 ${result.restored.length} 个文件（${formatBytes(bytes)}），失败 ${result.failed.length} 个`
  );

  if (result.dryRun) {
    console.log(color.yellow("  提示：当前为预览模式，加 --yes 执行还原"));
  }
};

const runRestore = async (): Promise<void> => {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);

  try {
    const result = await restoreFromTrash(
      options.restore,
      { dryRun: !options.yes, signal: controller.signal },
      options.json || options.silent ? undefined : {}
    );

    printRestore(result);
    if (result.failed.length > 0) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
};

const runOnce = async (): Promise<void> => {
  const userConfig = buildUserConfig();
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);

  try {
    const result = await clean(userConfig, {
      cwd: process.cwd(),
      signal: controller.signal,
      reporter: options.json ? undefined : (config) => new ConsoleReporter(config),
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, jsonReplacer, 2)}\n`);
    }

    if (result.stats.failedFiles > 0) process.exitCode = 2;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
};

/** 监听目录变化并防抖重跑 */
const runWatch = async (): Promise<void> => {
  const config = resolveConfig(buildUserConfig(), { cwd: process.cwd() });
  let running = false;
  let pending = false;
  let timer: NodeJS.Timeout | null = null;

  const execute = async () => {
    if (running) {
      pending = true;
      return;
    }

    running = true;
    try {
      await runOnce();
    } catch (err) {
      if (!controllerAborted(err)) {
        console.error(color.bgRed("[ERROR]"), err instanceof Error ? err.message : String(err));
      }
    } finally {
      running = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(execute, 600);
  };

  await execute();

  if (!options.silent) {
    console.log(color.gray(`[WATCH] 监听中：${config.baseDir}（Ctrl+C 退出）`));
  }

  const watcher = fs.watch(config.baseDir, { recursive: true }, schedule);

  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      if (timer) clearTimeout(timer);
      watcher.close();
      resolve();
    });
  });
};

const main = async (): Promise<void> => {
  if (options.restore) {
    await runRestore();
    return;
  }

  // 没有任何有效输入时展示帮助（getOptionValueSource 在未设置默认值时为 undefined）
  const dirSource = program.getOptionValueSource("dir");
  const hasLocalConfig = CONF_FILE_CANDIDATES.some((name) => fs.existsSync(path.resolve(name)));

  if (!options.dir && !options.config && dirSource !== "cli" && !hasLocalConfig) {
    program.help();
    return;
  }

  if (options.fileMinSize !== undefined) {
    console.warn(color.bgYellow("[WARN]"), "--file-min-size 已废弃，请使用 --min-file-size（支持 1kb/10mb）");
    console.warn(color.bgYellow("[WARN]"), "注意：min-file-size 的语义是「小于该值不参与去重」，不会再删除小文件");
  }

  if (options.watch) {
    await runWatch();
    return;
  }

  await runOnce();
};

main().catch((err) => {
  if (controllerAborted(err)) {
    console.error(color.bgYellow("[ABORT]"), "已取消");
    process.exitCode = 130;
    return;
  }

  if (isCleanerError(err)) {
    console.error(color.bgRed("[ERROR]"), err.message);
    process.exitCode = 1;
    return;
  }

  console.error(color.bgRed("[ERROR]"), err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});

function controllerAborted(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof err === "object" && err !== null && (err as { code?: string }).code === "ABORT_ERR")
  );
}
