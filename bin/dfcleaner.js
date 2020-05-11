#!/usr/bin/env node

const program = require('commander');
const color = require('console-log-colors').color;
const pkg = require('../package.json');
const { cleaner, utils, CONF_FILE_NAME } = require('../');

/**
 * 获取配置信息
 */
function getConfig() {
    const config = {
        /** 要清理的文件根目录 */
        baseDir: program.dir || process.cwd(),
        /** 最小文件大小。大于 0 时，小于该大小的文件将被清理 */
        fileMinSize: program.fileMinSize || 0,
        /** 是否对进行所有目录比较。为 false 则只对同目录下文件进行比较和清理 */
        compareAllDir: program.compareAllDir !== void 0,
        /** 是否清理子目录 */
        isClearSubDir: program.clearSubDir !== void 0,
        /** 是否删除空目录 */
        isDelEmptyDir: program.delEmptyDir !== void 0,
        /** 是否不输出清理过程相关的信息提示 */
        isSilent: !!program.silent,
        /** 文件排除规则。如设置，命中则不处理 */
        extend: null,
        /** 文件匹配规则。如设置，命中的文件才处理 */
        include: null,
        /** 配置文件路径。如存在，该文件中的优先级更高 */
        configPath: program.config,
        /** 开启调试模式 */
        debug: program.debug,
    };

    return config;
}

function start() {
    if (program.help) return;

    const conf = getConfig();
    const log = utils.getLog(conf);
    // log.debug(conf);
    const result = cleaner(conf);
    log.log('\n');
    log.sucess(`清理完成！共处理了 ${color.green(result.fileTotalCount)} 个文件/目录，删除了 ${color.red(result.fileDelCount)} 个文件/目录`);
}

program
    .version(pkg.version, '-v, --version')
    .description(pkg.description + ` [version ${pkg.version}]`)
    .option('-d, --dir [value]', '指定要清理的目录。默认为当前目录')
    .option('--file-min-size [value]', '最小文件大小。大于 0 时，小于该大小的文件将被清理', 0)
    .option('--compare-all-dir [value]', '是否对进行所有目录比较。为 false 则只对同目录下文件进行比较和清理。默认 true', true)
    .option('--clear-sub-dir [value]', '是否清理子目录。默认 true', true)
    .option('--del-empty-dir [value]', '是否删除空目录。默认 true', true)
    .option('-q, --silent [value]', '是否不输出清理过程相关的信息提示。默认 false', false)
    .option('-c, --config [filepath]', `配置文件 ${CONF_FILE_NAME} 的路径。默认为当前执行目录或 Home 目录下`, CONF_FILE_NAME)
    .option('--debug', `开启调试模式`, false)
    .parse(process.argv)

start();
