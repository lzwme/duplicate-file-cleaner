/**
 * 核心领域模型与公共契约。
 * 该文件只包含类型定义与常量，不产生任何 I/O 副作用。
 */

/** 文件匹配规则：glob 字符串或正则表达式 */
export type Rule = string | RegExp;
/** 用户传入的规则集合 */
export type RuleInput = Rule | Rule[] | null | undefined;

/** 保留策略 */
export type KeepStrategy =
  | "first"
  | "last"
  | "newest"
  | "oldest"
  | "shortest-path"
  | "longest-path";

export const KEEP_STRATEGIES: readonly KeepStrategy[] = [
  "first",
  "last",
  "newest",
  "oldest",
  "shortest-path",
  "longest-path",
];

/** 检测模式：精确去重 / 重复目录 / 两者 */
export type DetectMode = "exact" | "dir" | "both";

export const DETECT_MODES: readonly DetectMode[] = ["exact", "dir", "both"];

/** 进度信息 */
export interface ProgressInfo {
  phase: "scan" | "hash" | "dir" | "similar" | "delete";
  /** 已处理条目数 */
  processed: number;
  /** 总条目数（未知时为空） */
  total?: number;
  /** 已处理字节数 */
  bytes: number;
  /** 总字节数（未知时为空） */
  bytesTotal?: number;
  elapsedMs: number;
  /** 字节/秒 */
  speed?: number;
}

/** 扫描到的文件元信息 */
export interface FileInfo {
  /** 绝对路径 */
  path: string;
  /** 相对 baseDir 的 posix 路径 */
  relPath: string;
  /** 文件名 */
  name: string;
  /** 字节数 */
  size: number;
  /** 最后修改时间戳（毫秒） */
  mtimeMs: number;
  /** inode */
  ino: number;
  /** 设备号 */
  dev: number;
  /** 是否为软链接（followSymlinks 开启时可能出现） */
  isSymlink: boolean;
}

/** 单个错误记录 */
export interface ScanError {
  path: string;
  message: string;
}

/** 扫描统计 */
export interface ScanStats {
  files: number;
  dirs: number;
  bytes: number;
  skippedSmallFiles: number;
  skippedSymlinks: number;
  skippedUnreadable: number;
  errors: ScanError[];
}

/** 归一化之后的完整配置 */
export interface CleanerConfig {
  /** 要清理的根目录（绝对路径） */
  baseDir: string;
  /** 实际加载的配置文件路径，未加载为 null */
  configPath: string | null;
  /** 是否为预览模式（不做任何修改） */
  dryRun: boolean;
  /** 是否跟随软链接 */
  followSymlinks: boolean;
  /** 最大递归深度，-1 表示不限制 */
  maxDepth: number;
  /** 小于该字节数的文件不参与去重 */
  minFileSize: number;
  /** 是否额外删除小于 minFileSize 的文件（默认关闭，危险能力） */
  deleteMinSizeFiles: boolean;
  /** 是否跨目录比较，false 时仅同目录内去重 */
  compareAllDir: boolean;
  /** 是否递归子目录 */
  isClearSubDir: boolean;
  /** 是否删除空目录（不会删除 baseDir 自身） */
  isDelEmptyDir: boolean;
  /** 参与处理的文件白名单规则，空数组表示不限制 */
  include: RegExp[];
  /** 排除规则 */
  exclude: RegExp[];
  /** 额外忽略文件（.dfcleanerignore 等） */
  ignoreFiles: string[];
  /** 哈希算法 */
  algorithm: string;
  /** 预哈希采样字节数，0 表示关闭采样 */
  sampleSize: number;
  /** 哈希并发数 */
  concurrency: number;
  /** 每个重复组保留份数 */
  keep: number;
  /** 保留策略 */
  keepStrategy: KeepStrategy;
  /** 优先保留的目录（绝对路径） */
  preferDirs: string[];
  /** 回收站目录，设置后删除改为移动 */
  trashDir: string | null;
  /** 允许删除的文件比例上限，0 表示不限制 */
  maxDeleteRatio: number;
  /** 哈希缓存文件，null 表示不启用 */
  cacheFile: string | null;
  /** 检测模式 */
  detect: DetectMode;
  /** 是否检测相似图片 */
  similarImages: boolean;
  /** 相似图片汉明距离阈值 */
  similarThreshold: number;
  /** 是否删除相似图片（默认仅报告） */
  deleteSimilarImages: boolean;
  /** 是否输出进度 */
  progress: boolean;
  /** 是否静默 */
  silent: boolean;
  /** 是否调试 */
  debug: boolean;
  /** 报告输出文件（JSON） */
  reportFile: string | null;
}

/** 用户可传入的配置（含历史别名） */
export interface UserConfig extends Partial<Omit<CleanerConfig, "include" | "exclude">> {
  include?: RuleInput;
  exclude?: RuleInput;
  /** @deprecated 使用 silent */
  isSilent?: boolean;
  /** @deprecated 使用 minFileSize（旧单位 KB，且语义为删除小文件） */
  fileMinSize?: number;
}

/** 配置解析选项 */
export interface ResolveConfigOptions {
  cwd?: string;
  /** 警告回调（未知配置项、废弃字段等） */
  warn?: (message: string) => void;
}

/** 删除状态 */
export type DeleteStatus = "deleted" | "trashed" | "planned" | "failed";

/** 单条删除记录 */
export interface DeleteRecord {
  path: string;
  relPath: string;
  size: number;
  hash?: string;
  status: DeleteStatus;
  error?: string;
  /** 移入回收站后的目标路径 */
  trashedTo?: string;
}

/** 重复文件组 */
export interface DuplicateGroup {
  hash: string;
  size: number;
  files: FileInfo[];
  keep: FileInfo[];
  remove: FileInfo[];
  /** 指向同一 inode 的硬链接（不参与删除，也不计入可释放空间） */
  hardlinks: FileInfo[];
  /** 该组可释放的字节数 */
  savedBytes: number;
}

/** 重复目录组（目录内容树完全一致） */
export interface DuplicateDirGroup {
  hash: string;
  /** 组内所有目录（绝对路径） */
  dirs: string[];
  keep: string[];
  remove: string[];
  fileCount: number;
  size: number;
}

/** 相似图片组 */
export interface SimilarGroup {
  /** 首个文件的感知哈希 */
  hash: string;
  /** 组内最大汉明距离 */
  distance: number;
  files: FileInfo[];
  keep: FileInfo[];
  remove: FileInfo[];
}

/** 清理统计 */
export interface CleanStats {
  totalFiles: number;
  totalDirs: number;
  totalBytes: number;
  duplicateGroups: number;
  /** 属于重复组的文件总数 */
  duplicateFiles: number;
  /** 可删除（重复且超出保留份数）的文件数 */
  removableFiles: number;
  /** 可释放的字节数 */
  removableBytes: number;
  deletedFiles: number;
  deletedBytes: number;
  failedFiles: number;
  emptyDirsRemoved: number;
  skippedSmallFiles: number;
  skippedSymlinks: number;
  /** 因硬链接而未计入可释放空间/未删除的文件数 */
  hardlinksSkipped: number;
  /** 重复目录组数 */
  duplicateDirs: number;
  /** 相似图片组数 */
  similarGroups: number;
  /** 哈希缓存命中次数 */
  cacheHits: number;
  errors: ScanError[];
}

/** 一次清理的完整结果 */
export interface CleanResult {
  baseDir: string;
  dryRun: boolean;
  config: CleanerConfig;
  scan: ScanStats;
  groups: DuplicateGroup[];
  dirGroups: DuplicateDirGroup[];
  similarGroups: SimilarGroup[];
  deleted: DeleteRecord[];
  removedEmptyDirs: DeleteRecord[];
  stats: CleanStats;
}

/** 进度与结果回调，便于 CLI / 上层集成 */
export interface Reporter {
  onScanStart?(baseDir: string): void;
  onScanFile?(file: FileInfo): void;
  onGroup?(group: DuplicateGroup): void;
  onDirGroup?(group: DuplicateDirGroup): void;
  onSimilarGroup?(group: SimilarGroup): void;
  onDelete?(record: DeleteRecord): void;
  onEmptyDir?(record: DeleteRecord): void;
  onProgress?(info: ProgressInfo): void;
  onWarning?(message: string): void;
  summary?(result: CleanResult): void;
}

/** clean() 的运行选项 */
export interface CleanOptions {
  cwd?: string;
  /**  Reporter 实例或工厂函数（工厂可拿到最终配置） */
  reporter?: Reporter | ((config: CleanerConfig) => Reporter);
  signal?: AbortSignal;
}
