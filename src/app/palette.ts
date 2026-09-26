/**
 * @module palette
 *
 * UI 色板：为 N 色谜题生成 N 个高区分度的颜色（纯前端，不参与求解）。
 *
 * 色相不再按黄金角逐出，而是人工挑选 9 个彼此区分度好的锚点
 * （蓝 / 红 / 绿 / 橙 / 紫 / 黄 / 粉 / 青 / 黄绿），避免黄金角在
 * 绿区（≈90°–170°）落下多个色相造成的“多色相同看都是绿色”问题。
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
