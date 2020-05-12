import path from 'path';

/** 配置文件路径 */
export const CONF_FILE_NAME = '.dfcleaner.config.js';

export const getConfig = (cfg?) => {
  const config = {
    /** 开启调试模式 */
    debug: false,
    /** 最小文件大小。大于 0 时，小于该大小的文件将被清理 */
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
    exclude: [/(\/|\\)(.git|node_modules)(\/|\\)?/],
    /** 文件匹配规则。字符串、正则表达式或正则表达式数组。如设置，命中的文件才处理 */
    include: null,
    /** 配置文件路径 */
    configPath: CONF_FILE_NAME,
  };

  if (cfg) {
    Object.keys(cfg).forEach(key => {
      if (cfg[key] !== null) config[key] = cfg[key];
    });
  }

  config.include = formatRegRule(config.include);
  config.exclude = formatRegRule(config.exclude);
  if (config.configPath) config.configPath = path.resolve(config.configPath);

  return config;
};

function formatRegRule(rule: string | RegExp | RegExp[]) {
  if (!rule) rule = [];
  if (typeof rule === 'string') {
    rule = rule.split(',').map(str => new RegExp(str));
  }
  if (!Array.isArray(rule)) rule = [rule];

  rule.forEach((val, index) => {
    if (!(val instanceof RegExp)) {
      rule[index] = new RegExp(val);
    }
  });

  return rule;
}
