import path from "node:path";
import { CleanerError, errorMessage } from "./error";
import type { FileInfo } from "./types";

export const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
]);

export const isImageFile = (file: Pick<FileInfo, "name">): boolean =>
  IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase());

interface JimpInstance {
  bitmap: { data: Uint8Array; width: number; height: number };
  resize(options: { w: number; h: number }): JimpInstance;
}

interface JimpModule {
  Jimp: {
    read(filePath: string): Promise<JimpInstance>;
  };
}

let jimpModule: JimpModule | null = null;

const loadJimp = (): JimpModule => {
  if (jimpModule) return jimpModule;

  try {
    // 可选依赖：仅在检测相似图片时加载
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    jimpModule = require("jimp") as JimpModule;
  } catch {
    throw new CleanerError(
      "相似图片检测需要可选依赖 jimp，请先执行：pnpm add jimp",
      "MISSING_OPTIONAL_DEPENDENCY"
    );
  }

  return jimpModule;
};

/**
 * dHash（差异哈希）：
 * 缩放到 9x8、转灰度，比较每行相邻像素亮度，得到 64 bit 指纹。
 */
export const imageHash = async (filePath: string): Promise<string> => {
  const { Jimp } = loadJimp();
  const image = await Jimp.read(filePath);

  image.resize({ w: 9, h: 8 });

  const { data, width } = image.bitmap;
  let bits = "";

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = (y * width + x) * 4;
      const right = (y * width + x + 1) * 4;
      // 亮度近似：0.299R + 0.587G + 0.114B
      const lumaLeft = 0.299 * data[left] + 0.587 * data[left + 1] + 0.114 * data[left + 2];
      const lumaRight = 0.299 * data[right] + 0.587 * data[right + 1] + 0.114 * data[right + 2];
      bits += lumaLeft > lumaRight ? "1" : "0";
    }
  }

  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
};

/** 两个 dHash 之间的汉明距离（0-64） */
export const hammingDistance = (left: string, right: string): number => {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;

  while (value) {
    distance += Number(value & 1n);
    value >>= 1n;
  }

  return distance;
};

/** 读取图片并计算 dHash，失败时返回错误信息 */
export const safeImageHash = async (
  file: FileInfo
): Promise<{ file: FileInfo; hash: string | null; error?: string }> => {
  try {
    return { file, hash: await imageHash(file.path) };
  } catch (err) {
    return { file, hash: null, error: errorMessage(err) };
  }
};
