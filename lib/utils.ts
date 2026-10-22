import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { color } from "console-log-colors";

/** 路径统一为正斜杠形式，保证跨平台匹配一致性 */
export const toPosix = (filePath: string): string => filePath.replace(/\\/g, "/");

/** child 是否位于 parent 之下（含相等） */
export const isInside = (parent: string, child: string): boolean => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (!rel) return true;
  // 注意 "..foo" 是合法目录名，只有 ".." 与 "../" 才是越界
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

/** 人类可读的字节数 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${index === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
};

/** 数组去重 */
export const unique = <T>(list: T[]): T[] => Array.from(new Set(list));

/** 字符串/数字/布尔的宽松布尔解析，兼容 "false" 这类命令行输入 */
export const toBool = (value: unknown, fallback = false): boolean => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
  }
  return Boolean(value);
};

/** 解析 "1mb" / "512kb" / "1024" 形式的尺寸 */
export const parseSize = (value: string | number): number => {
  if (typeof value === "number") return Math.max(0, Math.round(value));
  const matched = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i.exec(String(value).trim());
  if (!matched) throw new Error(`无法解析的文件大小：${value}`);
  const unit = (matched[2] || "b").toLowerCase() as "b" | "kb" | "mb" | "gb" | "tb";
  const mul = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 }[unit];
  return Math.round(Number(matched[1]) * mul);
};

/** 日志配置 */
export interface LogConfig {
  silent?: boolean;
  debug?: boolean;
}

/**
 * 兼容 v1 的 logger。
 * `sucess` 为历史拼写，保留别名避免破坏已有调用方。
 */
export const getLog = (config: LogConfig = {}) => {
  const print = (prefix: string, args: unknown[]) => {
    if (config.silent) return;
    if (prefix) console.log(prefix, ...args);
    else console.log(...args);
  };

  return {
    log: (...args: unknown[]) => print("", args),
    info: (...args: unknown[]) => print(color.bgBlue("[INFO]"), args),
    success: (...args: unknown[]) => print(color.bgGreen("[SUCCESS]"), args),
    /** @deprecated 历史拼写，请使用 success */
    sucess: (...args: unknown[]) => print(color.bgGreen("[SUCCESS]"), args),
    warn: (...args: unknown[]) => print(color.bgYellow("[WARN]"), args),
    error: (...args: unknown[]) => print(color.bgRed("[ERROR]"), args),
    debug: (...args: unknown[]) => {
      if (!config.debug) return;
      print(color.bgYellow("[DEBUG]"), args);
    },
  };
};

/** 兼容 v1 的工具集合 */
export const utils = {
  /** 获取指定路径文件的 md5 值（同步，兼容旧 API）。大文件请使用 hasher 模块 */
  getMd5: (filename: string) => {
    const buffer = fs.readFileSync(filename);
    return crypto.createHash("md5").update(buffer).digest("hex");
  },
  getLog,
};
