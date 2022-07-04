#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { program } from "commander";
import { color } from "console-log-colors";
import { cleaner, utils, CONF_FILE_NAME } from "./";

const pkg = require("../package.json");

/**
 * 获取配置信息
 */
function getConfig(options) {
  if (!options) options = program.opts();

  const config = {
    /** 要清理的文件根目录 */
    baseDir: options.dir || process.cwd(),
    /** 最小文件大小。大于 0 时，小于该大小的文件将被清理 */
    fileMinSize: +options.fileMinSize || 0,
    /** 是否对进行所有目录比较。为 false 则只对同目录下文件进行比较和清理 */
    compareAllDir: options.compareAllDir !== void 0,
    /** 是否清理子目录 */
    isClearSubDir: options.clearSubDir !== void 0,
    /** 是否删除空目录 */
    isDelEmptyDir: options.delEmptyDir !== void 0,
    /** 是否不输出清理过程相关的信息提示 */
    silent: !!options.silent,
    /** 文件排除规则。如设置，命中则不处理 */
    extend: null,
    /** 文件匹配规则。如设置，命中的文件才处理 */
    include: null,
    /** 配置文件路径。如存在，该文件中的优先级更高 */
    configPath: options.config,
    /** 开启调试模式 */
    debug: !!options.debug,
    dryRun: !!options.dryRun,
  };

  if (config.configPath) {
    config.configPath = path.resolve(config.configPath);
    if (fs.existsSync(config.configPath)) {
      Object.assign(config, require(config.configPath));
    }
  }

  if (typeof options.debug === "boolean") config.debug = options.debug;
  if (typeof options.silent === "boolean") config.silent = options.silent;

  return config;
}

program
  .version(pkg.version, "-v, --version")
  .description(color.yellowBright(pkg.description) + ` [version ${pkg.version}]`)
  .option("-c, --config [filepath]", `配置文件 ${CONF_FILE_NAME} 的路径。`, CONF_FILE_NAME)
  .option("-d, --dir [value]", "指定要清理的目录")
  // @ts-ignore
  .option("--file-min-size [value]", "最小文件大小(KB)。大于 0 时，小于该大小的文件将被清理", 0)
  .option("--compare-all-dir [value]", "是否对进行所有目录比较。为 false 则只对同目录下文件进行比较和清理。", true)
  .option("--clear-sub-dir [value]", "是否清理子目录。", true)
  .option("--del-empty-dir [value]", "是否删除空目录。", true)
  .option("--dry-run", "演示模式，不执行真正的文件清理")
  .option("-q, --silent", "静默模式")
  .option("--debug", `开启调试模式`)
  .action((options) => {
    if (!options.dir) {
      if (!options.config || !fs.existsSync(path.resolve(options.config))) {
        return program.help();
      }
    }

    const conf = getConfig(options);
    const log = utils.getLog(conf);
    // log.debug(conf);
    const result = cleaner(conf);
    log.log("\n");
    log.sucess(
      `清理完成！共处理了 ${color.green(result.fileTotalCount)} 个文件与目录，删除了 ${color.red(result.fileDelCount)} 个文件与目录`
    );
  })
  .parse(process.argv);
