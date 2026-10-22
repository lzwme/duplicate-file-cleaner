import fs from "node:fs";
import type { Rule, RuleInput } from "./types";
import { toPosix } from "./utils";

const escapeRegExp = (value: string): string => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/**
 * glob -> RegExp。
 * 支持 `*`、`**`、`?`、末尾 `/`（仅目录）、无斜杠模式匹配任意层级。
 * 字符串规则统一走该函数，既兼容 v1 的 `.git` 写法，也避免非法正则导致崩溃。
 */
export const globToRegExp = (glob: string): RegExp => {
  let pattern = toPosix(String(glob).trim());
  let dirOnly = false;

  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }

  const hasSlash = pattern.includes("/");
  let source = "";

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];

    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index++;
        if (pattern[index + 1] === "/") {
          index++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }

  const head = hasSlash ? "^" : "(?:^|/)";
  const tail = dirOnly ? "(?:/|$)" : "(?:/|$)";

  return new RegExp(head + source + tail);
};

/** 统一规则输入为 RegExp 数组；去除 g/y 标志，避免 lastIndex 跨文件残留 */
export const normalizeRules = (input: RuleInput): RegExp[] => {
  if (input === null || input === undefined) return [];

  const list = Array.isArray(input) ? input : [input];
  const result: RegExp[] = [];

  for (const rule of list as Rule[]) {
    if (!rule) continue;
    if (rule instanceof RegExp) {
      const flags = rule.flags.replace(/[gy]/g, "");
      result.push(new RegExp(rule.source, flags));
    } else if (typeof rule === "string") {
      const trimmed = rule.trim();
      if (trimmed) result.push(globToRegExp(trimmed));
    }
  }

  return result;
};

export interface Matcher {
  /** 仅判断排除规则（用于目录剪枝） */
  excludes(relPath: string): boolean;
  /** 判断文件最终是否参与处理（排除 + 白名单） */
  matches(relPath: string): boolean;
}

export const createMatcher = (include: RegExp[], exclude: RegExp[]): Matcher => {
  const test = (rules: RegExp[], target: string) => rules.some((rule) => rule.test(target));

  return {
    excludes(relPath: string) {
      return test(exclude, toPosix(relPath));
    },
    matches(relPath: string) {
      const target = toPosix(relPath);
      if (test(exclude, target)) return false;
      if (!include.length) return true;
      return test(include, target);
    },
  };
};

interface IgnoreRule {
  regex: RegExp;
  negate: boolean;
}

/** 简化版 .gitignore 解析：支持注释、空行、`!` 取反，后者优先 */
export class Ignorer {
  private rules: IgnoreRule[] = [];

  get size(): number {
    return this.rules.length;
  }

  add(pattern: string): void {
    const trimmed = pattern.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const negate = trimmed.startsWith("!");
    const body = negate ? trimmed.slice(1).trim() : trimmed;
    if (!body) return;

    this.rules.push({ regex: globToRegExp(body), negate });
  }

  addFile(filePath: string): void {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      return;
    }
    for (const line of content.split(/\r?\n/)) this.add(line);
  }

  ignores(relPath: string): boolean {
    if (!this.rules.length) return false;

    const target = toPosix(relPath);
    let ignored = false;

    // 后出现的规则优先，保证 `!` 可以覆盖前面的忽略
    for (const rule of this.rules) {
      if (rule.regex.test(target)) ignored = !rule.negate;
    }

    return ignored;
  }
}
