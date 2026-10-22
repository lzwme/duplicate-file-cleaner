#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Option, program } from "commander";
import { color } from "console-log-colors";
import { CONF_FILE_CANDIDATES, CONF_FILE_NAME } from "./config";
import { clean } from "./cleaner";
import { isCleanerError } from "./error";
import { ConsoleReporter } from "./reporter";
import { KEEP_STRATEGIES, type UserConfig } from "./types";
import { parseSize } from "./utils";

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

program
  .name("dfcleaner")
  .version(pkg.version, "-v, --version", "输出版本号")
  .description(`${pkg.description} [version ${pkg.version}]`)
  .option("-d, --dir <path>", "要清理的目录，默认当前目录")
  .option("-c, --config <file>", `配置文件路径，默认在当前目录查找 ${CONF_FILE_NAME} 等`)
  .option("-y, --yes", "确认执行删除。未指定时仅预览，不修改任何文件")
  .option("--dry-run", "强制预览模式（与 --yes 同时使用时以预览为准）")
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
  .option("--max-delete-ratio <ratio>", "允许删除的文件比例上限（0-1），0 表示不限制", "0")
  .option("--trash <dir>", "回收站目录。设置后删除改为移动到该目录，可人工恢复")
  .option("--report <file>", "将 JSON 报告写入指定文件")
  .option("--json", "以 JSON 输出完整结果")
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

  const userConfig: UserConfig = {
    baseDir: options.dir,
    configPath: options.config === undefined ? undefined : options.config,
    dryRun: Boolean(options.dryRun) || !options.yes,
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
    maxDeleteRatio: Number(options.maxDeleteRatio),
    trashDir: options.trash,
    reportFile: options.report,
    silent: Boolean(options.silent),
    debug: Boolean(options.debug),
  };

  return userConfig;
};

const main = async (): Promise<void> => {
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

  const userConfig = buildUserConfig();
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);

  try {
    const result = await clean(userConfig, {
      cwd: process.cwd(),
      signal: controller.signal,
      reporter: options.json
        ? undefined
        : (config) => new ConsoleReporter(config),
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, jsonReplacer, 2)}\n`);
    }

    if (result.stats.failedFiles > 0) process.exitCode = 2;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
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
