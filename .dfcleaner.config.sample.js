/**
 * dfcleaner 重复文件清理工具配置文件示例
 */

module.exports = {
    /** 开启调试模式 */
    debug: false,
    /** 最小文件大小(KB)。大于 0 时，小于该大小的文件将被清理 */
    fileMinSize: 0,
    /** 要清理的文件根目录 */
    baseDir: process.cwd(),
    /** 是否对进行所有目录比较。为 false 则只对同目录下文件进行比较和清理 */
    compareAllDir: true,
    /** 是否清理子目录 */
    isClearSubDir: true,
    /** 是否删除空目录 */
    isDelEmptyDir: true,
    /** 是否不输出清理过程相关的信息提示 */
    isSilent: false,
    /** 文件排除规则。字符串、正则表达式或正则表达式数组。如设置，命中则不处理 */
    exclude: null,
    /** 文件匹配规则。字符串、正则表达式或正则表达式数组。如设置，命中的文件才处理 */
    include: null,
};
