import fs from "node:fs";
import path from "node:path";
import { CleanerError } from "./error";
import { normalizeRules } from "./matcher";
import {
  KEEP_STRATEGIES,
  type CleanerConfig,
  type KeepStrategy,
  type ResolveConfigOptions,
  type RuleInput,
  type UserConfig,
} from "./types";
import { toBool, toPosix } from "./utils";

/** 默认配置文件名称 */
export const CONF_FILE_NAME = ".dfcleaner.config.js";

/** 自动探测的配置文件候选列表 */
export const CONF_FILE_CANDIDATES = [
  CONF_FILE_NAME,
  ".dfcleaner.config.cjs",
  ".dfcleaner.config.json",
  ".dfcleanerrc.json",
];

/** 默认排除规则（glob 字符串） */
export const DEFAULT_EXCLUDE = [
  ".git",
  "node_modules",
  ".svn",
  ".hg",
  ".DS_Store",
  "Thumbs.db",
  ".dfcleaner-trash",
  ".dfcleanerignore",
  ".dfcleaner.config.js",
  ".dfcleaner.config.cjs",
  ".dfcleaner.config.json",
];

/** 所有允许的配置键，用于未知字段告警 */
const KNOWN_KEYS = new Set([
  "baseDir",
  "configPath",
  "dryRun",
  "followSymlinks",
  "maxDepth",
  "minFileSize",
  "deleteMinSizeFiles",
  "compareAllDir",
  "isClearSubDir",
  "isDelEmptyDir",
  "include",
  "exclude",
  "ignoreFiles",
  "algorithm",
  "sampleSize",
  "concurrency",
  "keep",
  "keepStrategy",
  "preferDirs",
  "trashDir",
  "maxDeleteRatio",
  "silent",
  "debug",
  "reportFile",
  // 历史别名
  "isSilent",
  "fileMinSize",
]);

/** 默认配置（每次解析都会重新拷贝并归一化） */
export const DEFAULT_CONFIG: CleanerConfig = {
  /** 空字符串表示使用运行时 cwd，避免模块加载时固化目录 */
  baseDir: "",
  configPath: null,
  dryRun: true,
  followSymlinks: false,
  maxDepth: -1,
  minFileSize: 0,
  deleteMinSizeFiles: false,
  compareAllDir: true,
  isClearSubDir: true,
  isDelEmptyDir: true,
  include: [],
  exclude: normalizeRules(DEFAULT_EXCLUDE),
  ignoreFiles: [".dfcleanerignore"],
  algorithm: "sha256",
  sampleSize: 4096,
  concurrency: 8,
  keep: 1,
  keepStrategy: "first",
  preferDirs: [],
  trashDir: null,
  maxDeleteRatio: 0,
  silent: false,
  debug: false,
  reportFile: null,
};

/** 读取配置文件（支持 js/cjs/json） */
export const loadConfigFile = (filePath: string): UserConfig => {
  const absolute = path.resolve(filePath);

  if (!fs.existsSync(absolute)) {
    throw new CleanerError(`配置文件不存在：${absolute}`, "CONFIG_NOT_FOUND");
  }

  try {
    if (absolute.endsWith(".json")) {
      return JSON.parse(fs.readFileSync(absolute, "utf8")) as UserConfig;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(absolute);
    return (loaded && loaded.__esModule && loaded.default ? loaded.default : loaded) as UserConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CleanerError(
      `读取配置文件失败：${absolute}\n${message}\n若项目为 ESM（package.json 中 "type": "module"），请将配置改为 .dfcleaner.config.cjs`,
      "CONFIG_LOAD_FAILED"
    );
  }
};

/** 把历史配置字段映射为当前字段 */
const normalizeLegacy = (
  input: Record<string, unknown>,
  warn: (message: string) => void
): Record<string, unknown> => {
  const output = { ...input };

  if (output.isSilent !== undefined && output.silent === undefined) {
    output.silent = toBool(output.isSilent, false);
    warn("配置项 isSilent 已废弃，请改用 silent");
  }
  delete output.isSilent;

  if (output.fileMinSize !== undefined && output.minFileSize === undefined) {
    const legacy = Number(output.fileMinSize);
    output.minFileSize = Number.isFinite(legacy) ? Math.round(legacy * 1024) : 0;
    warn(
      "配置项 fileMinSize 已废弃：旧值单位为 KB 且会删除非重复的小文件。新字段 minFileSize 单位为字节，语义为「小于该值不参与去重」；如需删除小文件请显式设置 deleteMinSizeFiles: true"
    );
  }
  delete output.fileMinSize;

  return output;
};

const toNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toStringArray = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

/**
 * 解析并校验配置。
 * 优先级：默认值 < 配置文件 < 显式传入（CLI / API）。
 * 返回值是全新对象，不存在全局单例与状态泄漏。
 */
export const resolveConfig = (
  userConfig: UserConfig = {},
  options: ResolveConfigOptions = {}
): CleanerConfig => {
  const cwd = path.resolve(options.cwd || process.cwd());
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    if (options.warn) options.warn(message);
  };

  const userInput = normalizeLegacy(
    { ...(userConfig as Record<string, unknown>) },
    warn
  );

  // 1. 解析配置文件
  let configPath: string | null = null;
  let fileConfig: Record<string, unknown> = {};

  if (typeof userInput.configPath === "string" && userInput.configPath.trim()) {
    configPath = path.resolve(cwd, userInput.configPath.trim());
    fileConfig = normalizeLegacy(loadConfigFile(configPath) as Record<string, unknown>, warn);
  } else if (userInput.configPath !== null) {
    for (const candidate of CONF_FILE_CANDIDATES) {
      const candidatePath = path.resolve(cwd, candidate);
      if (fs.existsSync(candidatePath)) {
        configPath = candidatePath;
        fileConfig = normalizeLegacy(loadConfigFile(candidatePath) as Record<string, unknown>, warn);
        break;
      }
    }
  }
  delete userInput.configPath;

  // 2. 合并：默认值 < 配置文件 < 显式传入
  const merged: Record<string, unknown> = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...userInput,
  };

  // 3. 未知字段告警
  for (const key of Object.keys(merged)) {
    if (!KNOWN_KEYS.has(key)) warn(`未知配置项：${key}（已忽略）`);
  }

  // 4. 归一化
  const keepStrategy = String(merged.keepStrategy || "first") as KeepStrategy;
  if (!KEEP_STRATEGIES.includes(keepStrategy)) {
    throw new CleanerError(
      `非法的保留策略：${keepStrategy}，可选值：${KEEP_STRATEGIES.join(", ")}`,
      "INVALID_CONFIG"
    );
  }

  const config: CleanerConfig = {
    baseDir: path.resolve(cwd, String(merged.baseDir || cwd)),
    configPath,
    dryRun: toBool(merged.dryRun, DEFAULT_CONFIG.dryRun),
    followSymlinks: toBool(merged.followSymlinks, false),
    maxDepth: Math.round(toNumber(merged.maxDepth, -1)),
    minFileSize: Math.max(0, Math.round(toNumber(merged.minFileSize, 0))),
    deleteMinSizeFiles: toBool(merged.deleteMinSizeFiles, false),
    compareAllDir: toBool(merged.compareAllDir, true),
    isClearSubDir: toBool(merged.isClearSubDir, true),
    isDelEmptyDir: toBool(merged.isDelEmptyDir, true),
    include: normalizeRules(merged.include as RuleInput),
    exclude:
      merged.exclude === null ? [] : normalizeRules(merged.exclude as RuleInput),
    ignoreFiles: toStringArray(merged.ignoreFiles),
    algorithm: String(merged.algorithm || "sha256").toLowerCase(),
    sampleSize: Math.max(0, Math.round(toNumber(merged.sampleSize, 4096))),
    concurrency: Math.max(1, Math.round(toNumber(merged.concurrency, 8))),
    keep: Math.max(1, Math.round(toNumber(merged.keep, 1))),
    keepStrategy,
    preferDirs: toStringArray(merged.preferDirs).map((dir) => path.resolve(cwd, dir)),
    trashDir: merged.trashDir ? path.resolve(cwd, String(merged.trashDir)) : null,
    maxDeleteRatio: Math.min(1, Math.max(0, toNumber(merged.maxDeleteRatio, 0))),
    silent: toBool(merged.silent, false),
    debug: toBool(merged.debug, false),
    reportFile: merged.reportFile ? path.resolve(cwd, String(merged.reportFile)) : null,
  };

  if (config.maxDepth < -1) {
    throw new CleanerError(`maxDepth 必须 >= -1，当前为 ${config.maxDepth}`, "INVALID_CONFIG");
  }

  const allowedAlgorithms = ["md5", "sha1", "sha256", "sha512"];
  if (!allowedAlgorithms.includes(config.algorithm)) {
    throw new CleanerError(
      `不支持的哈希算法：${config.algorithm}，可选值：${allowedAlgorithms.join(", ")}`,
      "INVALID_CONFIG"
    );
  }

  if (config.trashDir && config.trashDir === config.baseDir) {
    throw new CleanerError("trashDir 不能与 baseDir 相同", "INVALID_CONFIG");
  }

  if (config.trashDir && toPosix(config.trashDir).startsWith(toPosix(config.baseDir) + "/")) {
    warn("trashDir 位于清理目录内，请确保已在 exclude 中排除，否则会被重复扫描");
  }

  return config;
};

/**
 * 兼容 v1 的入口。
 * 支持：
 *  - getConfig()                     -> 默认配置
 *  - getConfig({ baseDir })          -> 解析传入配置（修复 v1 首参被当作 useCache 的问题）
 *  - getConfig(false, { baseDir })   -> 兼容旧签名
 */
export function getConfig(cfg?: UserConfig | boolean, legacyCfg?: UserConfig): CleanerConfig {
  if (typeof cfg === "boolean") return resolveConfig(legacyCfg || {});
  return resolveConfig(cfg || {});
}
