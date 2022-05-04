
# DUPLICATE-FILE-CLEANER

[![NPM version][npm-image]][npm-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/@lzwme/duplicate-file-cleaner.svg?style=flat-square
[npm-url]: https://npmjs.org/package/@lzwme/duplicate-file-cleaner
[download-image]: https://img.shields.io/npm/dm/@lzwme/duplicate-file-cleaner.svg?style=flat-square
[download-url]: https://npmjs.org/package/@lzwme/duplicate-file-cleaner


一个基于 `nodejs` 的重复文件删除工具。

## duplicate-file-cleaner 简介

### 特色

- `支持命令行工具方式便捷使用`
- `支持 nodejs API 调用`
- more...

## 安装与使用

### 全局安装、命令行工具用法

```bash
npm i -g @lzwme/duplicate-file-cleaner
dfcleaner -h
```

将输出 `help` 帮助信息：

```bash
Usage: dfcleaner [options]

一个基于 `nodejs` 的重复文件删除工具。 [version 1.0.0]

Options:
  -v, --version              output the version number
  -d, --dir [value]          指定要清理的目录。默认为当前目录
  --file-min-size [value]    最小文件大小。大于 0 时，小于该大小的文件将被清理 (default: 0)
  --compare-all-dir [value]  是否对进行所有目录比较。为 false 则只对同目录下文件进行比较和清理。默认 true (default: true)
  --clear-sub-dir [value]    是否清理子目录。默认 true (default: true)
  --del-empty-dir [value]    是否删除空目录。默认 true (default: true)
  -q, --silent [value]       是否不输出清理过程相关的信息提示。默认 false (default: false)
  -c, --config [filepath]    配置文件 .dfcleaner.config.js 的路径。默认为当前执行目录或 Home 目录下 (default: ".dfcleaner.config.js")
  --debug                    开启调试模式 (default: false)
  -h, --help                 display help for command
```

### 用法示例

```bash
# 对 test-dir 目录及其子目录下的所有文件进行重复文件清理
dfcleaner -d test-dir
```

### API 调用用法示例

```js
const { cleaner, getConfig } = require('@lzwme/duplicate-file-cleaner');
const config = getConfig({
  // debug: true,
  baseDir: process.cwd(),
});
const result = cleaner(config);

console.log(`清理完成！共处理了 ${result.fileTotalCount} 个文件，删除了 ${result.fileDelCount} 个文件`);
```

### 配置文件参考

配置文件名称为 `.dfcleaner.config.js`，具体配置与内容参考：

```js
{
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
    exclude: null,
    /** 文件匹配规则。字符串、正则表达式或正则表达式数组。如设置，命中的文件才处理 */
    include: null,
  };
```


## 开发与测试

```bash
git clone https://github.com/lzwme/duplicate-file-cleaner.git
cd duplicate-file-cleaner
yarn && yarn start
```

## TODO

- 增加重复文件删除优先级配置
- 增加相似图片删除、目录归类功能
- More...

## 相关参考

- https://www.npmjs.com/package/jimp
- https://github.com/peterbraden/node-opencv
- https://docs.opencv.org/4.3.0/d5/d10/tutorial_js_root.html
- https://github.com/justadudewhohacks/face-api.js

## License

`duplicate-file-cleaner` is released under the MIT license.

该插件由[志文工作室](https://lzw.me)开发和维护。
