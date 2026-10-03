/**
 * @module boardDetect
 *
 * 棋盘图像识别（纯 TS、无 DOM、无第三方依赖）。
 *
 * 输入 `BoardImage`（一张棋盘截图的像素：宽/高 + RGBA），输出：
 *   - `n`：网格边长 N（= 颜色数）；
 *   - `colors[y][x]`：颜色矩阵（颜色编号 0..N-1，行优先首次出现重编号）；
 *   - `reps[c]`：N 个代表色 `[r, g, b]`；
 *   - `bbox`：棋盘外框 `[x0, y0, x1, y1]`。
 *
 * 算法分步：
 *   [0] Sobel 梯度幅值图（0–255，99.5 分位数稳健拉伸）；
 *   [1] 列强度剖面 + 峰值统计配对，找出"列"（两条相邻格线夹住的区域）；
 *   [2] 每列的竖线接缝段（左右边缘 ±tol 内有强竖线、内部大部分低于阈值）；
 *   [3] 由接缝段确定棋盘包围盒 / 行列数 / 各列边界 `colPairs` / 缝隙宽 `gap`；
 *   [4] 每格"有色区域"左上角 1/8 处采样一小块取 median 颜色；
 *   [5] KMeans（K=N）聚成 N 色，按行优先首次出现重编号。
 */

/* ------------------------------ 常量 ------------------------------ */

/** 梯度幅值阈值，> THR 视为"有边缘"。 */
const THR = 50;
/** 配对时只保留强度 ≥ 该比例·max 的强峰。 */
const STRONG_FRAC = 0.35;
/** 定位竖线时的行级像素容差（吸收亚像素抖动）。 */
const EDGE_TOL = 2;
/** 接缝行要求内部"低于阈值"的像素比例。 */
const CLEAN_FRAC = 0.7;
/** KMeans 初始化次数（与 sklearn 默认一致）。 */
const N_INIT = 20;
/** 采样点位于"有色区域"左上角的比例（1/8）。 */
const SAMPLE_FRAC = 0.125;

/* ------------------------------ 类型 ------------------------------ */

/** 一张棋盘截图的像素数据（来自 Canvas `ImageData`）。 */
export interface BoardImage {
  /** 宽（像素）。 */
  width: number;
  /** 高（像素）。 */
  height: number;
  /** RGBA [0,255]，长度 `width*height*4`，行主序（`[y*width + x]*4`）。 */
  rgba: Uint8ClampedArray;
}

/** 各格"有色区域"的边界（已排除格线缝隙）。 */
export interface BoardBounds {
  lefts: number[];
  rights: number[];
  tops: number[];
  bottoms: number[];
}

/** 识别结果。 */
export interface DetectResult {
  ok: boolean;
  error?: string;
  /** 网格边长 N（= 颜色数）。 */
  n: number;
  /** 颜色矩阵 `colors[y][x]`，颜色编号 0..N-1。 */
  colors: number[][];
  /** N 个代表色 `reps[c] = [r, g, b]`。 */
  reps: number[][];
  bbox: [number, number, number, number];
  sizes: number[];
}

/** 一个失败结果（便于复用）。 */
function fail(error: string): DetectResult {
  return {
    ok: false,
    error,
    n: 0,
    colors: [],
    reps: [],
    bbox: [0, 0, 0, 0],
    sizes: [],
  };
}

/* --------------------------- 小工具（纯数值） --------------------------- */

function maxOf(a: ArrayLike<number>): number {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (v > m) m = v;
  }
  return m;
}

/** 中位数（输入为空返回 0）。 */
function medianOf(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  const a = Array.from(values).sort((p, q) => p - q);
  const mid = (n - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return lo === hi ? a[lo]! : (a[lo]! + a[hi]!) / 2;
}

/** 百分位（线性插值，等价 numpy `percentile` 的默认行为）。 */
function percentileOf(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const a = Array.from(values).sort((x, y) => x - y);
  if (n === 1) return a[0]!;
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return lo === hi ? a[lo]! : a[lo]! + (rank - lo) * (a[hi]! - a[lo]!);
}

/** 确定性 PRNG（mulberry32），保证 KMeans 结果可复现。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------ [0] 梯度图 ------------------------------ */

/**
 * 灰度折算（`0.299R + 0.587G + 0.114B`，与 OpenCV BGR2GRAY 一致）。
 */
function toGray(rgba: Uint8ClampedArray, n: number): Uint8Array {
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    gray[i] = Math.round(0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!);
  }
  return gray;
}

/**
 * [0] Sobel 梯度幅值图（0–255）。
 *
 * Sobel ksize=3 求 x/y 方向梯度，幅值 `sqrt(gx^2 + gy^2)`；
 * 用 99.5 分位数做稳健拉伸（避免少量高亮异常像素压暗整图）。
 */
function gradientMap(W: number, H: number, gray: Uint8Array): Uint8Array {
  const at = (x: number, y: number): number => {
    if (x < 0) x = 0;
    else if (x >= W) x = W - 1;
    if (y < 0) y = 0;
    else if (y >= H) y = H - 1;
    return gray[y * W + x]!;
  };

  const N = W * H;
  const mags = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const tl = at(x - 1, y - 1),
        tm = at(x, y - 1),
        tr = at(x + 1, y - 1);
      const ml = at(x - 1, y),
        mr = at(x + 1, y);
      const bl = at(x - 1, y + 1),
        bm = at(x, y + 1),
        br = at(x + 1, y + 1);
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tm - tr + bl + 2 * bm + br;
      mags[y * W + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // 稳健拉伸到 0–255
  let lo = Infinity;
  for (let i = 0; i < N; i++) {
    if (mags[i]! < lo) lo = mags[i]!;
  }
  const hi = percentileOf(mags, 99.5);
  const range = Math.max(hi - lo, 1e-6);

  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let v = mags[i]!;
    if (v < lo) v = lo;
    else if (v > hi) v = hi;
    out[i] = Math.round(((v - lo) / range) * 255);
  }
  return out;
}


/* ------------------------ [1] 峰值 + 统计配对 ------------------------ */

/**
 * 找峰值（近似 `scipy.signal.find_peaks(height, distance)`）：
 * 局部极大（严格大于左侧、不小于右侧）、值 ≥ `height`，且彼此间距 ≥ `distance`
 * （间距不足时保留较强者）。返回索引（升序）。
 */
function findPeaks(
  profile: ArrayLike<number>,
  height: number,
  distance: number,
): number[] {
  const n = profile.length;
  const cands: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (
      profile[i]! > profile[i - 1]! &&
      profile[i]! >= profile[i + 1]! &&
      profile[i]! >= height
    ) {
      cands.push(i);
    }
  }
  // distance 约束：按强度降序贪心保留，间距不足的丢弃
  const byStrength = cands.slice().sort((a, b) => profile[b]! - profile[a]!);
  const kept: number[] = [];
  for (const p of byStrength) {
    let tooClose = false;
    for (const q of kept) {
      if (Math.abs(q - p) < distance) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) kept.push(p);
  }
  kept.sort((a, b) => a - b);
  return kept;
}

export interface PairResult {
  /** 列宽（宽间隔族）。 */
  g: number;
  /** 列中心间距（pitch）。 */
  pitch: number;
  /** 一致性（落在 ±30%·pitch 内的比例）。 */
  consistency: number;
  /** 配对 `(a, b)`，即一个"列"的两条边界格线。 */
  pairs: Array<[number, number]>;
  /** 列数。 */
  n: number;
}


/**
 * [1] 统计配对：从强峰中找出"列"（两条相邻格线夹住的区域）。
 *
 * 格线常成对（双线），故峰间隔存在多个重复族：窄族（缝隙/双线间距）与宽族（列宽），
 * 截图里的 UI 还会贡献更多小间隔族。
 *
 * **多族投票**：出现次数足够（≥ MIN_FAMILY_COUNT）且列宽达标（≥ MIN_CELL）的每个间隔值
 * 都作为候选"列宽族"，逐族独立做 配对 + 等距网格（pitch + phase）拟合 + 一致性打分，
 * 再择优。择优规则：
 *   1. consistency（列中心等距程度，按最稠密连续列块计，孤立 UI 假列不拖累）——高者胜：
 *      真实棋盘是制造出来的等距网格，UI 不是；
 *   2. strength（保留列边界格线的平均强度）——高者胜；差距在噪声带内视为平手；
 *   3. 列宽 `g`——大者胜（“列”间隔宽于“缝隙”间隔）。
 */
/** 间隔族进入投票的最少配对数（过少则统计上站不住脚）。 */
const MIN_FAMILY_COUNT = 4;
/** 最小列宽（px）：窄于它的"列"对采样无意义（见 sampleCells 的 minSize 防护）。 */
const MIN_CELL = 8;
/** 强度平手噪声带（相对值）：两族强度差在此带内视为平手，改按"列宽较大者胜"。 */
const STRENGTH_TIE_BAND = 0.1;
/** "最稠密连续列块"的连续判定：相邻列中心间距 ≤ 该倍数·pitch 视为连续（孤立的 UI 假列在此被切出）。 */
const RUN_GAP_FRAC = 1.5;

/** 单个"列宽族"的投票明细（调试用）。 */
export interface FamilyScore {
  /** 族的间隔值（列宽）。 */
  g: number;
  /** 该间隔的出现次数。 */
  count: number;
  /** 族内候选列数（间距 ≈ g 的相邻强峰对）。 */
  pairs: number;
  /** 等距网格检验后保留的列数。 */
  kept: number;
  /** 等距一致性（越接近 1 越像等距网格）。 */
  consistency: number;
  /** 保留列的平均强度（每列两条边界格线强度的均值）。 */
  strength: number;
  /** 是否为胜出族。 */
  winner: boolean;
}

interface FamilyResult {
  g: number;
  count: number;
  pairs: number;
  kept: number;
  consistency: number;
  strength: number;
  pitch: number;
  colPairs: Array<[number, number]>;
  viable: boolean;
}

function statisticalPairing(
  peaks: number[],
  col: ArrayLike<number>,
  famsOut?: FamilyScore[],
): PairResult | null {
  const maxCol = maxOf(col);
  let strong = peaks.filter((p) => col[p]! >= STRONG_FRAC * maxCol);
  if (strong.length < 8) strong = peaks.slice();
  if (strong.length < 2) return null;

  const d: number[] = [];
  for (let i = 0; i < strong.length - 1; i++) d.push(strong[i + 1]! - strong[i]!);
  if (d.length === 0) return null;

  // 候选族：间隔值 v + 0.5（单位宽直方图），出现次数 ≥ MIN_FAMILY_COUNT 且列宽 ≥ MIN_CELL
  const lo = Math.floor(Math.min(...d));
  const hi = Math.ceil(Math.max(...d));
  const nbins = hi - lo + 1;
  const hist = new Array<number>(nbins).fill(0);
  for (const v of d) {
    let idx = Math.floor(v - lo);
    if (idx < 0) idx = 0;
    else if (idx >= nbins) idx = nbins - 1;
    hist[idx]!++;
  }
  const fams: Array<{ g: number; count: number }> = [];
  for (let idx = 0; idx < nbins; idx++) {
    const g = lo + idx + 0.5;
    if (hist[idx]! >= MIN_FAMILY_COUNT && g >= MIN_CELL) fams.push({ g, count: hist[idx]! });
  }
  if (fams.length === 0) return null;

  // 多族投票：逐族拟合，按 "consistency → strength → 列宽较大者胜" 择优
  const results: FamilyResult[] = [];
  let best: FamilyResult | null = null;
  for (const fam of fams) {
    const r = fitFamily(strong, d, col, fam.g, fam.count);
    results.push(r);
    if (betterFamily(r, best)) best = r;
  }
  if (famsOut) {
    for (const r of results) {
      famsOut.push({
        g: r.g,
        count: r.count,
        pairs: r.pairs,
        kept: r.kept,
        consistency: r.consistency,
        strength: r.strength,
        winner: r === best,
      });
    }
  }
  if (best === null || !best.viable) return null;
  return { g: best.g, pitch: best.pitch, consistency: best.consistency, pairs: best.colPairs, n: best.kept };
}

/** 拟合单个"列宽族"：按 g 配对 → 等距网格（pitch + phase）检验 → consistency / strength 打分。 */
function fitFamily(
  strong: number[],
  d: number[],
  col: ArrayLike<number>,
  g: number,
  count: number,
): FamilyResult {
  const base: FamilyResult = {
    g,
    count,
    pairs: 0,
    kept: 0,
    consistency: 0,
    strength: 0,
    pitch: 0,
    colPairs: [],
    viable: false,
  };
  // 找所有候选列（相邻强峰间距 ≈ g），交由下方的"等距网格拟合"统一裁决。
  const tol = Math.max(2, Math.round(0.25 * g));
  const candPairs: Array<[number, number]> = [];
  for (let i = 0; i < strong.length - 1; i++) {
    if (Math.abs(d[i]! - g) <= tol) candPairs.push([strong[i]!, strong[i + 1]!]);
  }
  if (candPairs.length < 4) return base;
  base.pairs = candPairs.length;

  // 列中心（升序）
  const centers = candPairs.map(([a, b]) => (a + b) / 2).sort((x, y) => x - y);
  const cg: number[] = [];
  for (let j = 0; j < centers.length - 1; j++) cg.push(centers[j + 1]! - centers[j]!);
  if (cg.length < 2) return base;

  // pitch = 列中心间距的中位数（稳健，不受单个离群列/漏列影响）
  const pitch = medianOf(cg);
  if (pitch <= 0) return base;
  base.pitch = pitch;

  // 相位 = 各 (center mod pitch) 的圆中位数：真实棋盘的所有列共相位，
  // 而 UI 边框 / 错配列的相位偏离 → 下方用残差把它们剔除。
  const mods = centers.map((c) => ((c % pitch) + pitch) % pitch);
  let phase = mods[0]!;
  let bestSum = Infinity;
  for (const p of mods) {
    let sum = 0;
    for (const m of mods) {
      let dd = Math.abs(m - p);
      if (dd > pitch / 2) dd = pitch - dd;
      sum += dd;
    }
    if (sum < bestSum) {
      bestSum = sum;
      phase = p;
    }
  }

  // 只保留落在等距网格上的列：中心到最近网格位置的圆距离 ≤ 0.1·pitch。
  // 离群列（残差大）与错配首列（相位偏离）在此被剔除。
  const residual = (c: number): number => {
    const m = ((c % pitch) + pitch) % pitch;
    const dd = Math.abs(m - phase);
    return Math.min(dd, pitch - dd);
  };
  const thr = Math.max(2, 0.1 * pitch);
  let pairs = candPairs.filter(([a, b]) => residual((a + b) / 2) <= thr);
  if (pairs.length < 4) pairs = candPairs; // 兜底：网格判定过严时退回全部候选
  pairs = pairs.slice().sort((p, q) => p[0] - q[0]);

  // [最稠密连续列块] 相邻中心间距 ≤ RUN_GAP_FRAC·pitch 视为连续；
  // 孤立的 UI 假列（同宽但远离棋盘）自成一块，在此被切出——
  // consistency / strength / 返回列集均基于该最稠密块计算。
  const keptCenters = pairs.map(([a, b]) => (a + b) / 2);
  const maxGap = RUN_GAP_FRAC * pitch;
  let runStart = 0;
  let runEnd = 1;
  let curStart = 0;
  for (let j = 1; j < pairs.length; j++) {
    if (keptCenters[j]! - keptCenters[j - 1]! > maxGap) curStart = j;
    if (j - curStart + 1 > runEnd - runStart) {
      runStart = curStart;
      runEnd = j + 1;
    }
  }
  const run = pairs.slice(runStart, runEnd);
  if (run.length < 4) return base; // 最稠密块也不足 4 列 → 该族不成立
  base.viable = true;
  base.kept = run.length;
  base.colPairs = run;

  // 一致性：最稠密块内相邻中心间距 ≈ pitch 的比例
  let within = 0;
  for (let j = 1; j < run.length; j++) {
    const gap = keptCenters[runStart + j]! - keptCenters[runStart + j - 1]!;
    if (Math.abs(gap - pitch) <= 0.3 * pitch) within++;
  }
  base.consistency = within / (run.length - 1);

  // 强度：最稠密块内列的平均强度（每列两条边界格线强度的均值）
  base.strength = run.reduce((s, [a, b]) => s + (col[a]! + col[b]!), 0) / (2 * run.length);
  return base;
}

/** 族比较：consistency 降序 → strength 降序（噪声带内视为平手）→ 列宽较大者胜。 */
function betterFamily(a: FamilyResult, b: FamilyResult | null): boolean {
  if (b === null || !b.viable) return a.viable;
  if (!a.viable) return false;
  if (a.consistency !== b.consistency) return a.consistency > b.consistency;
  const eps = Math.max(2, STRENGTH_TIE_BAND * Math.max(a.strength, b.strength));
  if (Math.abs(a.strength - b.strength) > eps) return a.strength > b.strength;
  return a.g > b.g;
}


/* ------------------------------ [2] 接缝段 ------------------------------ */

/**
 * [2] 竖线接缝段：对每一对 `(a, b)`，找出"两条竖线同时存在"的连续行区间。
 *
 * 每行 y 判定为"接缝行"需同时满足：
 *  1. 左边缘 `[a-tol, a+tol]` 内有强竖线（> THR）；
 *  2. 右边缘 `[b-tol, b+tol]` 内有强竖线（> THR）；
 *  3. 内部 `[a+tol+1, b-tol)` "大部分"低于阈值（> clean_frac）——格子可含少量元素。
 *
 * 满足的连续行 → 一个接缝段 `(a, b, y0, y1)`。
 */
function seamSegments(
  gray: Uint8Array,
  W: number,
  H: number,
  a: number,
  b: number,
): Array<[number, number, number, number]> {
  const segs: Array<[number, number, number, number]> = [];
  const edgeHasLine = (edge: number, y: number): boolean => {
    const c0 = Math.max(0, edge - EDGE_TOL);
    const c1 = Math.min(W, edge + EDGE_TOL + 1);
    const base = y * W;
    for (let x = c0; x < c1; x++) {
      if (gray[base + x]! > THR) return true;
    }
    return false;
  };
  const i0 = a + EDGE_TOL + 1;
  const i1 = b - EDGE_TOL;
  const rowIsSeam = (y: number): boolean => {
    if (!edgeHasLine(a, y) || !edgeHasLine(b, y)) return false;
    if (i1 <= i0) return true;
    const base = y * W;
    let below = 0;
    let tot = 0;
    for (let x = i0; x < i1; x++) {
      tot++;
      if (gray[base + x]! < THR) below++;
    }
    return tot > 0 && below / tot > CLEAN_FRAC;
  };
  let y = 0;
  while (y < H) {
    if (rowIsSeam(y)) {
      const y0 = y;
      while (y < H && rowIsSeam(y)) y++;
      segs.push([a, b, y0, y - 1]);
    } else {
      y++;
    }
  }
  return segs;
}

/* ------------------------------ [3] 棋盘范围 ------------------------------ */

export interface Board {
  bbox: [number, number, number, number];
  width: number;
  height: number;
  pitch: number;
  nCols: number;
  nRows: number;
  gridX: number[];
  colPairs: Array<[number, number]>;
  gap: number;
}

/**
 * [3] 棋盘范围：从列配对与其竖线接缝段推出包围盒 / 行列数 / 各列边界 / 缝隙宽。
 *
 * 每列强度取其两条边界格线中较强的一条；保留强度 ≥ 0.25·max 的列，
 * 取最稠密的连续列块（允许 ≤2 个空档）作为棋盘，排除背景离群列。
 */
function computeBoard(
  pairs: Array<[number, number]>,
  col: ArrayLike<number>,
  segs: Array<[number, number, number, number]>,
): Board | null {
  if (pairs.length === 0) return null;
  const maxCol = maxOf(col);

  // 列筛选：强度 ≥ 0.25·max
  const strength = pairs.map(([a, b]) => Math.max(col[a]!, col[b]!));
  const thr = 0.25 * maxCol;
  let validIdx: number[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (strength[i]! >= thr) validIdx.push(i);
  }
  if (validIdx.length === 0) validIdx = pairs.map((_, i) => i);

  // 最稠密的连续列块（允许相邻索引差 ≤2）
  let bestRun = [validIdx[0]!];
  let cur = [validIdx[0]!];
  for (let j = 1; j < validIdx.length; j++) {
    const idx = validIdx[j]!;
    if (idx - cur[cur.length - 1]! <= 2) {
      cur.push(idx);
    } else {
      if (cur.length > bestRun.length) bestRun = cur;
      cur = [idx];
    }
  }
  if (cur.length > bestRun.length) bestRun = cur;

  const kept = bestRun.map((i) => pairs[i]!);
  const keptSet = new Set(kept.map(([a, b]) => `${a},${b}`));
  let keptSegs = segs.filter((s) => keptSet.has(`${s[0]},${s[1]}`));
  if (keptSegs.length === 0) keptSegs = segs;

  let xMin = Infinity;
  let xMax = -Infinity;
  for (const [a, b] of kept) {
    if (a < xMin) xMin = a;
    if (b > xMax) xMax = b;
  }
  const width = xMax - xMin;
  const nCols = kept.length;

  // 垂直范围：先按长度剔除两端稀疏伪段（< 0.3·中位长度），再取 min/max
  const medLen = medianOf(keptSegs.map((s) => s[3] - s[2] + 1));
  const filtered = keptSegs.filter((s) => s[3] - s[2] + 1 >= 0.3 * medLen);
  if (filtered.length > 0) keptSegs = filtered;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of keptSegs) {
    if (s[2] < yMin) yMin = s[2];
    if (s[3] > yMax) yMax = s[3];
  }
  const height = yMax - yMin;

  const pitch = nCols > 0 ? width / nCols : 0;
  const nRows = nCols; // 棋盘为 N×N 正方形
  const gridX = Array.from(new Set(kept.flatMap(([a, b]) => [a, b]))).sort(
    (a, b) => a - b,
  );
  // 各列有色区域的真实左右边界（从左到右）
  const colPairs = kept.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  // 缝隙宽 = 相邻两列"右线 → 下一列左线"的未上色带宽
  const seams: number[] = [];
  for (let c = 0; c < colPairs.length - 1; c++) {
    seams.push(colPairs[c + 1]![0] - colPairs[c]![1]);
  }
  const gap = seams.length > 0 ? medianOf(seams) : 0;

  return { bbox: [xMin, yMin, xMax, yMax], width, height, pitch, nCols, nRows, gridX, colPairs, gap };
}


/* ------------------------------ [4] 颜色采样 ------------------------------ */

/**
 * [4] 每格"有色区域"的边界（排除格线缝隙）。
 *
 * 水平：直接取检测到的每列边界格线 `colPairs`（含缝隙、吸收逐列漂移）；
 * 垂直：检测只给出竖线，故由 `height / N_rows / gap` 推算每行边界。
 */
function cellBounds(board: Board): BoardBounds {
  const [x0, y0, x1, y1] = board.bbox;
  const nCols = board.nCols;
  const nRows = board.nRows;
  const colPairs = board.colPairs;
  const gap = board.gap;

  let lefts: number[];
  let rights: number[];
  if (colPairs.length === nCols) {
    lefts = colPairs.map((p) => p[0]);
    rights = colPairs.map((p) => p[1]);
  } else {
    const cw = (x1 - x0) / nCols;
    lefts = Array.from({ length: nCols }, (_, c) => x0 + c * cw);
    rights = Array.from({ length: nCols }, (_, c) => x0 + (c + 1) * cw);
  }

  const H = y1 - y0;
  const rowH = nRows > 0 ? (H - (nRows - 1) * gap) / nRows : H;
  const tops = Array.from({ length: nRows }, (_, r) => y0 + r * (rowH + gap));
  const bottoms = tops.map((t) => t + rowH);
  return { lefts, rights, tops, bottoms };
}

/**
 * [4] 颜色采样：每格在"有色区域"左上角 1/8 处取一小块（半宽/半高 ≈ 5%·格尺寸），
 * 取该块的 **median** 颜色。
 */
function sampleCells(img: BoardImage, board: Board): number[][][] {
  const { lefts, rights, tops, bottoms } = cellBounds(board);
  const nRows = tops.length;
  const nCols = lefts.length;
  const cellW = medianOf(lefts.map((l, c) => rights[c]! - l));
  const cellH = medianOf(tops.map((t, r) => bottoms[r]! - t));
  const hw = Math.max(2, Math.round(0.05 * cellW));
  const hh = Math.max(2, Math.round(0.05 * cellH));

  const W = img.width;
  const H = img.height;
  const rgba = img.rgba;
  const cells: number[][][] = [];
  for (let r = 0; r < nRows; r++) {
    const row: number[][] = [];
    for (let c = 0; c < nCols; c++) {
      const sx = lefts[c]! + (rights[c]! - lefts[c]!) * SAMPLE_FRAC;
      const sy = tops[r]! + (bottoms[r]! - tops[r]!) * SAMPLE_FRAC;
      const xx = Math.round(sx);
      const yy = Math.round(sy);

      const rs: number[] = [];
      const gs: number[] = [];
      const bs: number[] = [];
      const py0 = Math.max(0, yy - hh);
      const py1 = Math.min(H, yy + hh);
      const px0 = Math.max(0, xx - hw);
      const px1 = Math.min(W, xx + hw);
      for (let py = py0; py < py1; py++) {
        for (let px = px0; px < px1; px++) {
          const o = (py * W + px) * 4;
          rs.push(rgba[o]!);
          gs.push(rgba[o + 1]!);
          bs.push(rgba[o + 2]!);
        }
      }
      row.push([medianOf(rs), medianOf(gs), medianOf(bs)]);
    }
    cells.push(row);
  }
  return cells;
}


/* ------------------------------ [5] 颜色聚类 ------------------------------ */

/**
 * 确定性 KMeans（k-means++ 初始化 × N_INIT 次，取惯性最小者）。
 *
 * 纯 TS 实现，不依赖 sklearn；用于把 N×N 个格子颜色聚成 K 组。
 */
function kmeans(
  points: Float32Array,
  dim: number,
  k: number,
  seed: number,
): { labels: Int32Array; centers: Float32Array } {
  const n = points.length / dim;
  let bestLabels: Int32Array | null = null;
  let bestCenters: Float32Array | null = null;
  let bestInertia = Infinity;

  const dist2c = (centers: Float32Array, i: number, c: number): number => {
    let d = 0;
    const base = i * dim;
    const cbase = c * dim;
    for (let cch = 0; cch < dim; cch++) {
      const diff = points[base + cch]! - centers[cbase + cch]!;
      d += diff * diff;
    }
    return d;
  };

  for (let init = 0; init < N_INIT; init++) {
    const rng = mulberry32(seed + init);
    // k-means++ 初始化
    const centers = new Float32Array(k * dim);
    const first = Math.floor(rng() * n);
    for (let cch = 0; cch < dim; cch++) centers[cch] = points[first * dim + cch]!;
    const nearest = new Float64Array(n).fill(Infinity);
    for (let c = 1; c < k; c++) {
      for (let i = 0; i < n; i++) {
        const d = dist2c(centers, i, c - 1);
        if (d < nearest[i]!) nearest[i] = d;
      }
      let total = 0;
      for (let i = 0; i < n; i++) total += nearest[i]!;
      if (total > 0) {
        let pick = rng() * total;
        let idx = 0;
        for (let i = 0; i < n; i++) {
          pick -= nearest[i]!;
          if (pick <= 0) {
            idx = i;
            break;
          }
        }
        for (let cch = 0; cch < dim; cch++) {
          centers[c * dim + cch] = points[idx * dim + cch]!;
        }
      }
    }

    // Lloyd 迭代
    const labels = new Int32Array(n);
    let prev = new Int32Array(n).fill(-1);
    for (let iter = 0; iter < 100; iter++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let best = 0;
        let bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const d = dist2c(centers, i, c);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        labels[i] = best;
        if (prev[i] !== best) changed = true;
      }
      const sum = new Float32Array(k * dim);
      const cnt = new Int32Array(k);
      for (let i = 0; i < n; i++) {
        const c = labels[i]!;
        cnt[c]!++;
        const base = i * dim;
        const cbase = c * dim;
        for (let cch = 0; cch < dim; cch++) sum[cbase + cch]! += points[base + cch]!;
      }
      for (let c = 0; c < k; c++) {
        if (cnt[c]! > 0) {
          for (let cch = 0; cch < dim; cch++) {
            centers[c * dim + cch]! = sum[c * dim + cch]! / cnt[c]!;
          }
        }
      }
      prev = labels;
      if (!changed) break;
    }

    let inertia = 0;
    for (let i = 0; i < n; i++) inertia += dist2c(centers, i, labels[i]!);
    if (inertia < bestInertia) {
      bestInertia = inertia;
      bestLabels = labels;
      bestCenters = centers;
    }
  }

  return { labels: bestLabels!, centers: bestCenters! };
}


interface Clustered {
  labels: number[][]; // [r][c] = id
  reps: number[][]; // [k] = [r, g, b]
}

/**
 * [5] 颜色聚类：把 N×N 个格子颜色聚成 K 组；代表色 = 每簇 median；
 * 并按"行优先首次出现顺序"重编号，使 id 在棋盘上读起来自然。
 */
function clusterColors(cells: number[][][], k: number): Clustered {
  const nr = cells.length;
  const nc = nr > 0 ? cells[0]!.length : 0;
  const total = nr * nc;
  const flat = new Float32Array(total * 3);
  let p = 0;
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      flat[p] = cells[r]![c]![0]!;
      flat[p + 1] = cells[r]![c]![1]!;
      flat[p + 2] = cells[r]![c]![2]!;
      p += 3;
    }
  }

  const km = kmeans(flat, 3, k, 0);

  // 按行优先首次出现重编号
  const first = new Map<number, number>();
  const remap = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    const v = km.labels[i]!;
    let id = first.get(v);
    if (id === undefined) {
      id = first.size;
      first.set(v, id);
    }
    remap[i] = id;
  }

  const labels: number[][] = [];
  for (let r = 0; r < nr; r++) {
    const row: number[] = [];
    for (let c = 0; c < nc; c++) row.push(remap[r * nc + c]!);
    labels.push(row);
  }

  // 代表色 = 每簇 median（空簇回退到全体均值）
  const reps: number[][] = [];
  for (let i = 0; i < k; i++) {
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let j = 0; j < total; j++) {
      if (remap[j] === i) {
        rs.push(flat[j * 3]!);
        gs.push(flat[j * 3 + 1]!);
        bs.push(flat[j * 3 + 2]!);
      }
    }
    if (rs.length > 0) {
      reps.push([medianOf(rs), medianOf(gs), medianOf(bs)]);
    } else {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let j = 0; j < total; j++) {
        sr += flat[j * 3]!;
        sg += flat[j * 3 + 1]!;
        sb += flat[j * 3 + 2]!;
      }
      reps.push([
        total > 0 ? sr / total : 0,
        total > 0 ? sg / total : 0,
        total > 0 ? sb / total : 0,
      ]);
    }
  }
  return { labels, reps };
}

/* ------------------------------ 总入口 ------------------------------ */

/** 管线各步中间结果（调试用）。 */
export interface PipelineDebug {
  /** 识别结果（同 {@link detectBoard} 返回）。 */
  result: DetectResult;
  /** [0] 灰度图。 */
  gray: Uint8Array;
  /** [0] Sobel 梯度幅值图（0–255，99.5 分位拉伸）。 */
  grad: Uint8Array;
  /** [1] 列强度剖面（每列 > THR 的像素数）。 */
  col: Int32Array;
  /** [1] 强峰位置（升序）。 */
  peaks: number[];
  /** [1] 多族投票明细（哪些间隔族参选、胜出族及其打分）。 */
  families: FamilyScore[];
  /** [1] 列配对结果（失败时 null）。 */
  pair: PairResult | null;
  /** [2] 接缝段 `(a, b, y0, y1)`。 */
  segs: Array<[number, number, number, number]>;
  /** [3] 棋盘范围（失败时 null）。 */
  board: Board | null;
  /** [4] 各格"有色区域"边界（失败时 null）。 */
  bounds: BoardBounds | null;
  /** [4] 每格采样颜色 `cells[r][c] = [r, g, b]`（失败时 null）。 */
  cells: number[][][] | null;
  /** [5] 聚类标签 `labels[r][c]`（失败时 null）。 */
  labels: number[][] | null;
  /** [5] 代表色 `reps[c] = [r, g, b]`（失败时 null）。 */
  reps: number[][] | null;
}

/** 识别管线本体：依次执行 [0]–[5]，同时保留各步中间结果。 */
function runPipeline(img: BoardImage): PipelineDebug {
  const W = img.width;
  const H = img.height;
  if (W < 16 || H < 16) {
    return {
      result: fail("图像太小，无法识别棋盘"),
      gray: new Uint8Array(0),
      grad: new Uint8Array(0),
      col: new Int32Array(0),
      peaks: [],
      families: [],
      pair: null,
      segs: [],
      board: null,
      bounds: null,
      cells: null,
      labels: null,
      reps: null,
    };
  }

  // [0] 梯度图 + [1] 列强度剖面 / 峰值
  const gray = toGray(img.rgba, W * H);
  const grad = gradientMap(W, H, gray);
  const col = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    let cnt = 0;
    for (let y = 0; y < H; y++) {
      if (grad[y * W + x]! > THR) cnt++;
    }
    col[x] = cnt;
  }
  const maxCol = maxOf(col);
  const peaks = findPeaks(col, maxCol * 0.2, 3);
  const families: FamilyScore[] = [];
  const pair = statisticalPairing(peaks, col, families);
  if (!pair) {
    return {
      result: fail("未找到一致的列配对（可能不是 N×N 棋盘截图）"),
      gray,
      grad,
      col,
      peaks,
      families,
      pair: null,
      segs: [],
      board: null,
      bounds: null,
      cells: null,
      labels: null,
      reps: null,
    };
  }

  // [2] 接缝段（基于梯度图：边缘处梯度强、格子内部梯度弱）
  const segs: Array<[number, number, number, number]> = [];
  for (const [a, b] of pair.pairs) segs.push(...seamSegments(grad, W, H, a, b));

  // [3] 棋盘范围
  const board = computeBoard(pair.pairs, col, segs);
  if (!board) {
    return {
      result: fail("未找到棋盘区域"),
      gray,
      grad,
      col,
      peaks,
      families,
      pair,
      segs,
      board: null,
      bounds: null,
      cells: null,
      labels: null,
      reps: null,
    };
  }

  // [4] 颜色采样
  const bounds = cellBounds(board);
  const cells = sampleCells(img, board);

  // [5] 颜色聚类（K = 网格边长 N）
  const k = Math.max(board.nCols, board.nRows);
  const { labels, reps } = clusterColors(cells, k);

  const sizes = new Array<number>(k).fill(0);
  const used = new Set<number>();
  for (const row of labels) {
    for (const id of row) {
      used.add(id);
      if (id >= 0 && id < k) sizes[id]!++;
    }
  }

  // 应恰有 N 个不同颜色；不足则标记"可能不准确"
  const ok = used.size === k;
  const result: DetectResult = {
    ok,
    error: ok ? undefined : `颜色聚类得到 ${used.size} 组（期望 ${k} 组），结果可能不准确`,
    n: k,
    colors: labels,
    reps,
    bbox: board.bbox,
    sizes,
  };
  return { result, gray, grad, col, peaks, families, pair, segs, board, bounds, cells, labels, reps };
}

/**
 * 棋盘识别总入口：`BoardImage`（像素）→ `DetectResult`（N、颜色矩阵、代表色…）。
 *
 * 失败（图太小 / 找不到配对 / 找不到棋盘）时 `ok=false` 并给出 `error`。
 * 颜色聚类若不足 N 组仍会返回结果，但 `ok=false` 并提示"可能不准确"。
 */
export function detectBoard(img: BoardImage): DetectResult {
  return runPipeline(img).result;
}

/**
 * 调试入口：与 {@link detectBoard} 完全相同的管线，额外返回各步中间结果
 * （梯度图 / 列剖面 / 峰值 / 配对 / 接缝段 / 棋盘范围 / 采样色 / 聚类标签），
 * 供 Node 端逐步渲染排查。
 */
export function detectBoardDebug(img: BoardImage): PipelineDebug {
  return runPipeline(img);
}

