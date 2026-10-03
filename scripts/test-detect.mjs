/**
 * boardDetect 算法验证（纯 Node，无浏览器）：
 *
 * 生成"棋盘截图"样式的合成图（N×N 有色格 + 竖向格线 + 浅色背景），
 * 跑纯 TS 识别管线 `detectBoard`，断言：
 *   - 检测出的 N 与真实 N 一致；
 *   - 颜色矩阵正确（每格颜色 = 该列的颜色）；
 *   - 代表色恰有 N 组。
 *
 * 用途：在无法用浏览器打开 dev server 时，对识别管线做一次端到端冒烟测试。
 * 用法：node scripts/test-detect.mjs
 */

import { detectBoard } from "../src/app/boardDetect.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
};

/** HSL(0-360, 0-100, 0-100) → RGB(0-255)。 */
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

/**
 * 生成一张 N×N 棋盘合成图：
 *  - 浅色背景；
 *  - 每列一种颜色（共 N 色）；
 *  - 列之间有竖向格线（gap），行之间有横向格线（gap）——与真实截图结构一致。
 *
 * 返回 `{ width, height, rgba, expected }`，`expected[r][c] = c`（列号即颜色编号）。
 */
function makeBoard(N = 10, size = 1000, margin = 100) {
  const W = size;
  const H = size;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const bg = [236, 236, 236];
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = bg[0];
    rgba[i * 4 + 1] = bg[1];
    rgba[i * 4 + 2] = bg[2];
    rgba[i * 4 + 3] = 255;
  }
  const span = size - 2 * margin;
  const unit = span / N;
  const cell = Math.round(unit * 0.85); // 有色区域
  const colors = [];
  for (let c = 0; c < N; c++) colors.push(hslToRgb((c * 360) / N, 72, 58));
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x0 = Math.round(margin + c * unit);
      const y0 = Math.round(margin + r * unit);
      const x1 = x0 + cell;
      const y1 = y0 + cell;
      const col = colors[c];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          rgba[i] = col[0];
          rgba[i + 1] = col[1];
          rgba[i + 2] = col[2];
          rgba[i + 3] = 255;
        }
      }
    }
  }
  const expected = Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => c),
  );
  return { width: W, height: H, rgba, expected };
}

/**
 * 更真实的棋盘：拉丁方着色 `color(r,c) = (r+c) % N`（每种颜色恰好 N 次、
 * 每行每列各一次），并整体偏移 + 缩放，模拟真实截图的"棋盘不在正中"。
 */
function makeLatinBoard(N = 10, size = 1000, margin = 70) {
  const W = size;
  const H = size;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const bg = [240, 240, 244];
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = bg[0];
    rgba[i * 4 + 1] = bg[1];
    rgba[i * 4 + 2] = bg[2];
    rgba[i * 4 + 3] = 255;
  }
  const span = size - 2 * margin;
  const unit = span / N;
  const cell = Math.round(unit * 0.82);
  const colors = [];
  for (let c = 0; c < N; c++) colors.push(hslToRgb((c * 360) / N, 66, 62));
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x0 = Math.round(margin + c * unit);
      const y0 = Math.round(margin + r * unit);
      const x1 = x0 + cell;
      const y1 = y0 + cell;
      const col = colors[(r + c) % N];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          rgba[i] = col[0];
          rgba[i + 1] = col[1];
          rgba[i + 2] = col[2];
          rgba[i + 3] = 255;
        }
      }
    }
  }
  return { width: W, height: H, rgba };
}

/** 校验一次识别结果。 */
function runCase(N) {
  console.log(`\n[case] N=${N}`);
  const { expected, ...img } = makeBoard(N);
  const result = detectBoard(img);
  console.log(
    `  → ok=${result.ok}  n=${result.n}  clusters=${result.sizes.length}  ` +
      `sizes=[${result.sizes.join(",")}]${result.error ? "  error=" + result.error : ""}`,
  );
  if (process.env.DEBUG) {
    console.log("  bbox:", result.bbox);
    console.log("  reps:", result.reps.map((r) => r.map((v) => Math.round(v)).join(",")).join(" | "));
  }
  ok(result.ok, "识别成功（ok=true）");
  ok(result.n === N, `检测边长 N=${result.n} 等于真实 ${N}`);
  ok(result.colors.length === N, `颜色矩阵行数=${result.colors.length}`);
  const firstRow = result.colors[0] ?? [];
  ok(new Set(firstRow).size === N, `首行包含 ${N} 种不同颜色（实际 ${new Set(firstRow).size}）`);
  // 每列颜色应一致：colors[r][c] 与 colors[0][c] 相同（因为合成图按列着色）
  let colConsistent = true;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (result.colors[r][c] !== result.colors[0][c]) colConsistent = false;
    }
  }
  ok(colConsistent, "同列各格颜色一致（按列着色被正确恢复）");
  // 代表色应彼此可区分（两两欧氏距离足够大）
  let distinct = true;
  for (let i = 0; i < result.reps.length; i++) {
    for (let j = i + 1; j < result.reps.length; j++) {
      const d = Math.hypot(
        result.reps[i][0] - result.reps[j][0],
        result.reps[i][1] - result.reps[j][1],
        result.reps[i][2] - result.reps[j][2],
      );
      if (d < 25) distinct = false;
    }
  }
  ok(distinct, `${result.reps.length} 个代表色两两可区分`);
  void expected;
}

for (const N of [8, 10, 11]) runCase(N);

// 拉丁方（每色散落 N 次）
for (const N of [10, 12]) {
  console.log(`\n[case] N=${N}（拉丁方 / 偏移棋盘）`);
  const img = makeLatinBoard(N);
  const result = detectBoard(img);
  console.log(
    `  → ok=${result.ok}  n=${result.n}  sizes=[${result.sizes.join(",")}]` +
      `${result.error ? "  error=" + result.error : ""}`,
  );
  ok(result.ok, "识别成功（ok=true）");
  ok(result.n === N, `检测边长 N=${result.n} 等于真实 ${N}`);
  ok(result.colors.length === N, `颜色矩阵行数=${result.colors.length}`);
  // 拉丁方：每行每列都是 0..N-1 的一个排列
  let rowPermutation = true;
  let colPermutation = true;
  for (let r = 0; r < N; r++) {
    if (new Set(result.colors[r]).size !== N) rowPermutation = false;
  }
  for (let c = 0; c < N; c++) {
    const colVals = result.colors.map((row) => row[c]);
    if (new Set(colVals).size !== N) colPermutation = false;
  }
  ok(rowPermutation, "每行恰含 N 种颜色（拉丁方行排列被恢复）");
  ok(colPermutation, "每列恰含 N 种颜色（拉丁方列排列被恢复）");
}

console.log(failures === 0 ? "\nboardDetect 合成图验证全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);