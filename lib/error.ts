/** 可被 CLI 识别并友好展示的错误 */
export class CleanerError extends Error {
  code: string;

  constructor(message: string, code = "CLEANER_ERROR") {
    super(message);
    this.name = "CleanerError";
    this.code = code;
  }
}

export const isCleanerError = (err: unknown): err is CleanerError =>
  err instanceof CleanerError;

/** 将未知异常转为可读文本 */
export const errorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};
