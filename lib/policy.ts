import path from "node:path";
import type { FileInfo, KeepStrategy } from "./types";
import { isInside } from "./utils";

export interface KeepPolicyOptions {
  keep: number;
  keepStrategy: KeepStrategy;
  preferDirs: string[];
}

export interface KeepDecision {
  keep: FileInfo[];
  remove: FileInfo[];
}

interface Candidate {
  file: FileInfo;
  index: number;
}

const preferredRank = (file: FileInfo, preferDirs: string[]): number => {
  if (!preferDirs.length) return 0;
  return preferDirs.some((dir) => isInside(dir, file.path)) ? 0 : 1;
};

const compareByStrategy = (a: Candidate, b: Candidate, strategy: KeepStrategy): number => {
  switch (strategy) {
    case "last":
      return b.index - a.index;
    case "newest":
      return b.file.mtimeMs - a.file.mtimeMs;
    case "oldest":
      return a.file.mtimeMs - b.file.mtimeMs;
    case "shortest-path":
      return a.file.relPath.length - b.file.relPath.length;
    case "longest-path":
      return b.file.relPath.length - a.file.relPath.length;
    case "first":
    default:
      return a.index - b.index;
  }
};

/**
 * 决定每个重复组保留哪些文件。
 * 比较顺序：preferDirs 优先 > 保留策略 > 相对路径字典序（保证确定性）。
 */
export const selectKeep = (files: FileInfo[], options: KeepPolicyOptions): KeepDecision => {
  const keepCount = Math.max(1, options.keep);

  if (files.length <= keepCount) {
    return { keep: files.slice(), remove: [] };
  }

  const candidates: Candidate[] = files.map((file, index) => ({ file, index }));

  candidates.sort((a, b) => {
    const rankDiff = preferredRank(a.file, options.preferDirs) - preferredRank(b.file, options.preferDirs);
    if (rankDiff !== 0) return rankDiff;

    const strategyDiff = compareByStrategy(a, b, options.keepStrategy);
    if (strategyDiff !== 0) return strategyDiff;

    return a.file.relPath.localeCompare(b.file.relPath);
  });

  return {
    keep: candidates.slice(0, keepCount).map((item) => item.file),
    remove: candidates.slice(keepCount).map((item) => item.file),
  };
};

/** 目录是否可作为优先保留目录 */
export const normalizePreferDirs = (dirs: string[]): string[] =>
  dirs.filter(Boolean).map((dir) => path.resolve(dir));
