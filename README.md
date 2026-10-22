# DUPLICATE-FILE-CLEANER

[![NPM version][npm-image]][npm-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/@lzwme/duplicate-file-cleaner.svg?style=flat-square
[npm-url]: https://npmjs.org/package/@lzwme/duplicate-file-cleaner
[download-image]: https://img.shields.io/npm/dm/@lzwme/duplicate-file-cleaner.svg?style=flat-square
[download-url]: https://npmjs.org/package/@lzwme/duplicate-file-cleaner

一个基于 `nodejs` 的重复文件清理工具，同时提供 CLI 与可编程 API。

## 特性

- 默认 **预览模式**：不加 `--yes` 不会修改任何文件
- 分层哈希（size → 头部采样 → 全量）：避免大文件全量读入内存
- 三种检测模式：精确去重（`exact`）、重复目录（`dir`）、两者（`both`）
- **相似图片检测**（dHash + 汉明距离，可选依赖 `jimp`，默认只报告）
- **哈希缓存**：`--cache` 复用上次结果，二次运行近乎增量
- 可配置保留策略：`first` / `last` / `newest` / `oldest` / `shortest-path` / `longest-path`
- `--prefer <dir>` 优先保留指定目录，`--keep <n>` 每组保留多份
- 回收站 `--trash <dir>` + `--restore <dir>` 一键还原
- `--watch` 监听目录变化自动重复清理
- 进度与 ETA 显示、`--report <file>` JSON 报告、`--json` 结构化输出
- glob 规则（`--include` / `--exclude` / `.dfcleanerignore`），兼容字符串与正则
- 硬链接感知、软链接防越界与环路检测、单文件错误隔离、删除比例上限保护
- 全异步实现，哈希并发可控

## 安装

```bash
npm i -g @lzwme/duplicate-file-cleaner
dfcleaner --help
```

## 命令行用法

```bash
# 预览（默认，不做任何修改）
dfcleaner -d ./photos

# 确认删除
dfcleaner -d ./photos --yes

# 删除前先移动到回收站，便于恢复
dfcleaner -d ./photos --yes --trash ./dfcleaner-trash

# 按修改时间保留最新的一份，并优先保留 ./photos/keep 目录
dfcleaner -d ./photos --yes --keep-strategy newest --prefer ./photos/keep

# 只在相同目录内比较重复文件
dfcleaner -d ./photos --yes --no-compare-all-dir

# 重复目录整目录去重（保留 keep 目录）
dfcleaner -d ./backup --detect dir --yes --prefer ./backup/keep

# 相似图片检测（需先安装可选依赖：pnpm add jimp）
dfcleaner -d ./photos --similar-images --similar-threshold 5

# 使用哈希缓存加速二次扫描
dfcleaner -d ./photos --cache ./.dfcleaner-cache.json

# 从回收站还原（先预览，再加 --yes）
dfcleaner --restore ./dfcleaner-trash
dfcleaner --restore ./dfcleaner-trash --yes

# 监听目录变化，持续清理（默认预览，加 --yes 才会真正删除）
dfcleaner -d ./downloads --watch

# 输出 JSON，便于脚本处理
dfcleaner -d ./photos --yes --json
```

### 选项

| 选项 | 说明 |
| --- | --- |
| `-d, --dir <path>` | 要清理的目录，默认当前目录 |
| `-c, --config <file>` | 配置文件路径；不指定时在当前目录自动查找 |
| `-y, --yes` | 确认执行删除；未指定时为预览模式 |
| `--dry-run` | 强制预览（与 `--yes` 同时使用时以预览为准） |
| `--detect <mode>` | 检测模式：`exact`（默认）/ `dir`（重复目录）/ `both` |
| `--no-compare-all-dir` | 仅在相同目录内比较 |
| `--no-clear-sub-dir` | 不处理子目录 |
| `--no-del-empty-dir` | 不删除空目录 |
| `--min-file-size <size>` | 小于该尺寸的文件不参与去重，支持 `1kb` / `10mb` |
| `--delete-min-size-files` | 额外删除小于 `--min-file-size` 的文件（危险，默认关闭） |
| `--keep <number>` | 每个重复组保留份数，默认 `1` |
| `--keep-strategy <strategy>` | 保留策略，默认 `first` |
| `--prefer <dir>` | 优先保留该目录下的文件，可重复指定 |
| `--include <patterns>` | 只处理命中的文件，glob，逗号分隔 |
| `--exclude <patterns>` | 排除命中的文件/目录，glob，逗号分隔 |
| `--follow-symlinks` | 跟随软链接（默认跳过） |
| `--max-depth <number>` | 最大递归深度，`-1` 为不限制 |
| `--algorithm <name>` | `md5` / `sha1` / `sha256` / `sha512`，默认 `sha256` |
| `--concurrency <number>` | 哈希并发数，默认 `8` |
| `--cache [file]` | 启用哈希缓存，默认 `.dfcleaner-cache.json` |
| `--similar-images` | 检测相似图片（需可选依赖 `jimp`） |
| `--similar-threshold <n>` | 相似图片汉明距离阈值 0-64，默认 `5` |
| `--delete-similar` | 删除相似图片（默认仅报告） |
| `--max-delete-ratio <ratio>` | 允许删除比例上限（0-1），超限中止 |
| `--trash <dir>` | 回收站目录，设置后删除改为移动 |
| `--restore <dir>` | 从回收站还原（默认预览，`--yes` 执行） |
| `--watch` | 监听目录变化并自动重复清理 |
| `--report <file>` | 输出 JSON 报告 |
| `--json` | 以 JSON 输出完整结果 |
| `--no-progress` | 关闭进度条 |
| `-q, --silent` | 静默模式 |
| `--debug` | 调试输出 |

退出码：`0` 成功，`1` 参数/运行错误，`2` 存在删除失败的文件，`130` 被中断。

## API 用法

```js
const { clean } = require('@lzwme/duplicate-file-cleaner');

const result = await clean({
  baseDir: process.cwd(),
  dryRun: true, // 或不传，默认即预览
});

console.log(`扫描 ${result.stats.totalFiles} 个文件`);
console.log(`发现 ${result.stats.duplicateGroups} 组重复，可释放 ${result.stats.removableBytes} 字节`);

// 真实删除：dryRun: false
// const confirmed = await clean({ baseDir: dir, dryRun: false, keepStrategy: 'newest' });
```

检测重复目录、相似图片与启用缓存：

```js
const { clean, restoreFromTrash } = require('@lzwme/duplicate-file-cleaner');

const result = await clean({
  baseDir: './backup',
  detect: 'both',        // exact | dir | both
  cacheFile: './.dfcleaner-cache.json',
  similarImages: true,   // 需要可选依赖 jimp
  similarThreshold: 5,
  dryRun: true,
});

console.log(result.dirGroups, result.similarGroups);

// 从回收站还原（默认预览）
await restoreFromTrash('./dfcleaner-trash', { dryRun: false });
```

自定义报告器（进度、结构化输出、接入日志系统）：

```js
const { clean, ConsoleReporter } = require('@lzwme/duplicate-file-cleaner');

const result = await clean(
  { baseDir: './data' },
  {
    reporter: (config) => new ConsoleReporter(config),
    // 也可传入实现了 Reporter 接口的对象：
    // { onGroup(group) {}, onDelete(record) {}, summary(result) {} }
  }
);
```

主要导出：`clean` / `cleaner`（兼容别名）、`resolveConfig`、`getConfig`、`scanFiles`、`detectExactDuplicates` / `detectDuplicates`、`detectDuplicateDirs`、`detectSimilarImages`、`hashFile`、`HashCache`、`imageHash`、`hammingDistance`、`selectKeep`、`deleteFiles`、`removeEmptyDirs`、`writeTrashManifest`、`restoreFromTrash`、`ConsoleReporter`、`JsonReporter` 以及全部类型定义。

## 配置

配置文件自动在当前目录查找：`.dfcleaner.config.js`、`.dfcleaner.config.cjs`、`.dfcleaner.config.json`、`.dfcleanerrc.json`。

优先级：**默认值 < 配置文件 < 显式传入（CLI 参数 / API 参数）**。

> 若项目为 ESM（`package.json` 中 `"type": "module"`），请使用 `.dfcleaner.config.cjs`。

```js
module.exports = {
  /** 是否预览模式，默认 true */
  dryRun: true,
  /** 最小文件大小（字节）。小于该值不参与去重 */
  minFileSize: 0,
  /** 是否额外删除小于 minFileSize 的文件（默认 false） */
  deleteMinSizeFiles: false,
  /** 是否跨目录比较 */
  compareAllDir: true,
  /** 是否递归子目录 */
  isClearSubDir: true,
  /** 是否删除空目录（不会删除 baseDir 自身） */
  isDelEmptyDir: true,
  /** 每组的保留份数 */
  keep: 1,
  /** 保留策略 */
  keepStrategy: 'first',
  /** 优先保留的目录 */
  preferDirs: [],
  /** glob 或正则；null 表示不使用任何排除规则 */
  include: [],
  exclude: ['.git', 'node_modules', '*.tmp'],
  /** 额外忽略文件 */
  ignoreFiles: ['.dfcleanerignore'],
  /** 检测模式：exact | dir | both */
  detect: 'exact',
  /** 哈希算法与采样大小（字节，0 表示关闭采样） */
  algorithm: 'sha256',
  sampleSize: 4096,
  concurrency: 8,
  /** 哈希缓存文件，null 表示关闭 */
  cacheFile: null,
  /** 是否检测相似图片（需要可选依赖 jimp） */
  similarImages: false,
  /** 相似图片汉明距离阈值 0-64 */
  similarThreshold: 5,
  /** 是否删除相似图片（默认仅报告） */
  deleteSimilarImages: false,
  /** 允许删除的比例上限，0 表示不限制 */
  maxDeleteRatio: 0,
  /** 回收站目录 */
  trashDir: null,
  /** 是否显示进度（TTY 下生效） */
  progress: true,
  /** JSON 报告输出路径 */
  reportFile: null,
  silent: false,
  debug: false,
};
```

`.dfcleanerignore` 语法与 `.gitignore` 类似：支持注释、空行、`*` / `**` / `?`，以及 `!` 取反。

### v1 → v2 迁移

| v1 | v2 |
| --- | --- |
| `cleaner()` 同步返回结果 | `clean()` / `cleaner()` 返回 `Promise` |
| 默认直接删除 | 默认预览，需显式 `--yes` / `dryRun: false` |
| `--compare-all-dir false`（实际无效） | `--no-compare-all-dir` |
| `--clear-sub-dir` / `--del-empty-dir` | `--no-clear-sub-dir` / `--no-del-empty-dir` |
| `isSilent` | `silent`（旧字段仍兼容并告警） |
| `fileMinSize`（KB，会删除唯一小文件） | `minFileSize`（字节，仅跳过）；删除小文件需 `deleteMinSizeFiles: true` |
| `getConfig(cfg)`（首参被当作缓存开关） | `getConfig(cfg)` 正常生效 |

## 架构

```
lib/
  types.ts       领域模型与契约（FileInfo / DuplicateGroup / CleanResult / Reporter）
  error.ts       错误类型与错误码
  config.ts      默认值 + 配置加载 + 校验（无全局状态）
  matcher.ts     glob/正则规则与 .dfcleanerignore
  scanner.ts     遍历（lstat、软链接防护、稳定排序、错误隔离、进度）
  hasher.ts      采样/全量流式哈希、并发控制、缓存接入
  cache.ts       文件哈希缓存（path + size + mtime 校验）
  image-hash.ts  dHash 感知哈希与汉明距离（可选依赖 jimp）
  policy.ts      保留策略
  detector.ts    检测器：精确去重 / 重复目录 / 相似图片
  executor.ts    删除执行（预览 / unlink / 回收站 / 空目录）
  trash.ts       回收站清单与还原
  reporter.ts    控制台（含进度/ETA）与 JSON 报告
  cleaner.ts     编排：scan → detect → policy → execute → report
  cli.ts         命令行入口（含 --restore / --watch）
```

## 可选依赖

相似图片检测依赖图片解码器 `jimp`，为保持核心包轻量，它被声明为可选 peer 依赖，不随默认安装引入：

```bash
pnpm add jimp
```

未安装时使用 `--similar-images` 会得到明确提示，其余功能不受影响。

## 开发与测试

```bash
pnpm install
pnpm build      # 编译到 dist
pnpm test       # 构建后运行 node:test 用例（含 CLI 端到端）
```

> 本项目使用 pnpm 管理依赖与锁文件，请勿使用 npm/yarn 安装，以免破坏 workspace 链接。

## License

`duplicate-file-cleaner` is released under the MIT license.

该插件由[志文工作室](https://lzw.me)开发和维护。
