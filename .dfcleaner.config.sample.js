/**
 * dfcleaner 重复文件清理工具配置文件示例
 * 优先级：默认值 < 本文件 < 命令行/API 显式参数
 */
module.exports = {
  /** 是否预览模式，默认 true */
  dryRun: true,
  /** 开启调试模式 */
  debug: false,
  /** 最小文件大小（字节）。小于该值不参与去重 */
  minFileSize: 0,
  /** 是否额外删除小于 minFileSize 的文件（危险，默认关闭） */
  deleteMinSizeFiles: false,
  /** 要清理的文件根目录 */
  baseDir: process.cwd(),
  /** 是否对进行所有目录比较。为 false 则只对同目录下文件进行比较和清理 */
  compareAllDir: true,
  /** 是否清理子目录 */
  isClearSubDir: true,
  /** 是否删除空目录（不会删除 baseDir 自身） */
  isDelEmptyDir: true,
  /** 每个重复组保留的份数 */
  keep: 1,
  /** 保留策略：first | last | newest | oldest | shortest-path | longest-path */
  keepStrategy: 'first',
  /** 优先保留的目录 */
  preferDirs: [],
  /** 是否不输出清理过程相关的信息提示 */
  silent: false,
  /** 文件排除规则。glob 字符串、正则表达式或正则表达式数组。如设置，命中则不处理 */
  exclude: ['.git', 'node_modules'],
  /** 文件匹配规则。glob 字符串、正则表达式或正则表达式数组。如设置，命中的文件才处理 */
  include: [],
  /** 检测模式：exact | dir | both */
  detect: 'exact',
  /** 哈希算法与头部采样大小（字节） */
  algorithm: 'sha256',
  sampleSize: 4096,
  concurrency: 8,
  /** 哈希缓存文件，null 表示关闭 */
  cacheFile: null,
  /** 相似图片检测（需要可选依赖 jimp） */
  similarImages: false,
  similarThreshold: 5,
  deleteSimilarImages: false,
  /** 允许删除的文件比例上限，0 表示不限制 */
  maxDeleteRatio: 0,
  /** 回收站目录，设置后删除改为移动 */
  trashDir: null,
  /** JSON 报告输出路径 */
  reportFile: null,
};
