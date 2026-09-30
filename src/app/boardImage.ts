/**
 * @module boardImage
 *
 * 棋盘识别的 DOM 适配层：把"用户给的图像"（`File` / `Blob` / dataURL 字符串）
 * 读入 `<canvas>` → `ImageData` → `BoardImage`，再交给 `./boardDetect` 的纯算法。
 *
 *  - `imageToBoardImage(src)`：加载图像、等比缩放到上限、绘制到 canvas、取像素；
 *  - `recognizeImage(src)`：一站式入口，返回 `DetectResult`（N、颜色矩阵、代表色…）。
 *
 * 仅依赖浏览器内建 API（`Image` / `canvas` / `createObjectURL`），不引入第三方库。
 * 注意：图像必须是本地来源（文件选择 / 剪贴板 / 拖入），否则会因跨域污染
 * 导致 `getImageData` 失败——本模块会给出明确错误提示。
 */

import {
  detectBoard,
  type BoardImage,
  type DetectResult,
} from "./boardDetect.js";

/** 处理尺寸上限（等比缩放的最大边）。
 *
 * 取 2560：常见截图（≤2560px）按原分辨率处理，保真度最高；仅对超大图
 * （手机 4K / 大屏截图）等比缩小以控制耗时与内存。检测是尺度不变的，
 * 高质量（面积平均）缩放不破坏格线结构。 */
const MAX_DIM = 2560;

/** 支持作为输入的图像来源：文件 / 二进制 / dataURL 字符串。 */
export type ImageSource = File | Blob | string;

/**
 * 把一个图像来源加载成 `HTMLImageElement`（自动管理 objectURL 的生命周期）。
 */
function loadImage(src: ImageSource): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    let url: string;
    let revoke = false;
    if (typeof src === "string") {
      url = src;
    } else {
      url = URL.createObjectURL(src);
      revoke = true;
    }
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (revoke) URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (revoke) URL.revokeObjectURL(url);
      reject(new Error("图像加载失败，请确认是有效的图片文件"));
    };
    img.src = url;
  });
}

/**
 * 加载图像并从 Canvas 读取像素，得到 `BoardImage`。
 *
 * 等比缩放到 `MAX_DIM` 上限，绘制到 canvas 后用 `getImageData` 取 RGBA 像素。
 *
 * @throws 当图像无法加载、canvas 不可用或读取像素被跨域策略阻止时。
 */
export async function imageToBoardImage(src: ImageSource): Promise<BoardImage> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("图像尺寸无效（可能不是有效图片）");

  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法获取 Canvas 2D 上下文");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, cw, ch);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, cw, ch).data;
  } catch {
    throw new Error("读取像素失败：图像受跨域限制（请使用本地文件 / 剪贴板 / 拖入的图片）");
  }
  return { width: cw, height: ch, rgba: data };
}

/**
 * 一站式识别：图像来源 → `DetectResult`（N、颜色矩阵、代表色…）。
 *
 * 成功（`ok=true`）时 `n` / `colors` / `reps` 可直接填入棋盘；失败时 `ok=false`
 * 并给出可读的 `error`。
 */
export async function recognizeImage(src: ImageSource): Promise<DetectResult> {
  const boardImage = await imageToBoardImage(src);
  return detectBoard(boardImage);
}