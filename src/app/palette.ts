/**
 * @module palette
 *
 * UI 色板：为 N 色谜题生成 N 个高区分度的颜色（纯前端，不参与求解）。
 *
 * 色相取自人工挑选的 9 个彼此区分度好的锚点
 * （蓝 / 红 / 绿 / 橙 / 紫 / 黄 / 粉 / 青 / 黄绿）。
 * 前 9 色为饱和度 / 亮度一致的柔和色；第 10 色起（仅大棋盘需要）
 * 复用同一组色相并加深一档亮度，靠明度与浅色档区分。
 *
 * 棋盘格子与画笔色块使用完全相同的颜色（`swatchBg`）。
 */

export interface PaletteColor {
  /** 颜色编号（0..N-1）。 */
  id: number;
  /** 展示名称。 */
  label: string;
  /** 色块背景（画笔色块与棋盘格子同色）。 */
  swatchBg: string;
  /** 强调色（色块内编号文字 / 选中描边，保证与底色对比度）。 */
  accent: string;
}

/** 9 个两两区分度高的色相锚点（色板顺序即颜色编号顺序）。 */
const HUES = [220, 5, 140, 28, 272, 52, 328, 182, 90];

/** 生成 N 个区分度好的颜色。 */
export function generatePalette(n: number): PaletteColor[] {
  const colors: PaletteColor[] = [];
  for (let i = 0; i < n; i++) {
    const hue = HUES[i % HUES.length] ?? 220;
    const deep = i >= HUES.length; // 第 10 色起：同色相的深色调
    colors.push({
      id: i,
      label: `颜色 ${i + 1}`,
      swatchBg: deep ? `hsl(${hue} 56% 50%)` : `hsl(${hue} 64% 74%)`,
      accent: deep ? `hsl(${hue} 30% 96%)` : `hsl(${hue} 68% 38%)`,
    });
  }
  return colors;
}

/**
 * 用一组 RGB 代表色构建调色板。
 *
 * 用于"图像识别"场景：把检测到的 N 个真实代表色 `reps[c] = [r, g, b]`
 * 作为画笔 / 棋盘底色，使界面颜色与原始截图一致。
 * 强调色（编号文字 / 选中描边）按底色亮度自动取深色或浅色，保证对比度。
 *
 * @param n     颜色数（取前 n 个代表色）。
 * @param reps  代表色数组，`reps[c] = [r, g, b]`（0–255）；缺失项回退中性灰。
 */
export function paletteFromReps(n: number, reps: number[][]): PaletteColor[] {
  const colors: PaletteColor[] = [];
  for (let i = 0; i < n; i++) {
    const rgb = reps[i];
    const r = Math.round(rgb?.[0] ?? 200);
    const g = Math.round(rgb?.[1] ?? 200);
    const b = Math.round(rgb?.[2] ?? 200);
    // 感知亮度（ITU-R BT.601），用于决定强调色取深 / 浅。
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    colors.push({
      id: i,
      label: `颜色 ${i + 1}`,
      swatchBg: `rgb(${r}, ${g}, ${b})`,
      accent: lum > 150 ? "rgb(30, 30, 30)" : "rgb(255, 255, 255)",
    });
  }
  return colors;
}
