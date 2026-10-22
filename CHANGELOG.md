# Changelog

## 2.2.0

### 新增

- **多根目录**：新增 `baseDirs` 配置与可重复的 `-d/--dir`，支持跨根目录精确去重、重复目录检测、空目录清理与 watch 监听。
- 多根目录下 `relPath` 自动带上唯一的根目录标签前缀，`FileInfo` 新增 `root` 字段。
- `CleanResult` 新增 `roots`，报告 JSON 同步输出。
- 空目录清理会跳过所有根目录自身（此前仅保护首个根目录）。
- 新增 `commonAncestor()` 工具，回收站清单按根目录公共祖先记录相对路径。
- 新增多根目录测试（跨根去重、标签、目录检测、空目录、CLI、单根兼容）。

## 2.1.0

### 新增

- **重复目录检测**：`detect: 'dir' | 'both'`、`--detect <mode>`，按「文件名 + 内容哈希 + 子目录签名」自底向上计算目录树指纹，可整目录去重。
- **相似图片检测**：dHash 感知哈希 + 汉明距离聚类，`--similar-images` / `--similar-threshold` / `--delete-similar`。默认仅报告，`jimp` 为可选 peer 依赖。
- **哈希缓存**：`--cache [file]` / `cacheFile`，按 `path + size + mtime` 校验，二次运行近乎增量。
- **回收站还原**：`--trash <dir>` 时写入 manifest，新增 `--restore <dir>` 与 `restoreFromTrash()`，支持预览与回滚。
- **watch 模式**：`--watch` 监听目录变化并防抖重跑。
- **进度与 ETA**：扫描/哈希/目录指纹/相似图片阶段实时进度（TTY）。
- **硬链接感知**：同一 `dev:ino` 的多个链接不再被删除，也不计入可释放空间。
- 新增 CLI 选项：`--detect`、`--cache`、`--similar-images`、`--similar-threshold`、`--delete-similar`、`--restore`、`--watch`、`--no-progress`。
- 新增 `PeerDependencies`：`jimp`（可选）。
- 新增 GitHub Actions CI 与 MIT LICENSE。

### 变更

- `duplicateGroups` 统计口径调整为「存在可删除副本的组」；新增 `duplicateDirs`、`similarGroups`、`hardlinksSkipped`、`cacheHits` 统计。
- 报告 JSON 增加 `dirGroups`、`similarGroups`、`hardlinks` 字段。

## 2.0.0

### 重构

- 分层重构为 `config / matcher / scanner / hasher / policy / detector / executor / reporter / cleaner / cli`。
- 移除模块级可变单例，`cleaner()` 改为异步 `clean()`。
- 单一配置实现，修复 `getConfig({...})` 首参被当作缓存开关的缺陷；支持配置校验与未知字段告警。
- 字符串规则统一按 glob 归一化，修复字符串 `exclude` 导致的 `reg.test is not a function` 崩溃。
- 修正布尔开关（`--no-compare-all-dir` 等），新增 `--no-clear-sub-dir`、`--no-del-empty-dir`。

### 安全

- 默认预览模式，`--yes` 才执行删除；`baseDir` 自身不再被删除。
- 软链接默认跳过，跟随模式增加越界与环路检测。
- 单文件异常隔离；新增 `--max-delete-ratio` 删除比例熔断。
- `--trash` 回收站与 JSON 报告。

### 破坏性变更

- `cleaner()` 返回 `Promise`。
- 默认不删除文件（预览）。
- `fileMinSize` → `minFileSize`（字节，仅跳过）；删除小文件需 `deleteMinSizeFiles: true`。
- `isSilent` → `silent`。

## 1.2.0

- 历史版本：精确重复文件清理、最小文件删除、空目录清理。
