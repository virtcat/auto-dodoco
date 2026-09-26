/**
 * @module store
 *
 * UI 侧的响应式谜题状态（Vue `reactive`）：
 * 棋盘边长 N、模式 K、颜色矩阵、画笔颜色、求解状态。
 *
 * 求解引擎位于 `src/core`（纯 TS、无 DOM），执行环境由 `./solveEngine` 提供：
 *  - `startSolve()`：用 {@link toConfig} 组装 `PuzzleConfig` 并派发到求解引擎
 *    （真实浏览器在 worker 线程求解；无 `Worker` 的环境回退主线程）；
 *  - `stopSolve()`：提前终止进行中的求解；
 *  - `clearSolution()`：清除求解结果（任何棋盘变更都会自动调用；求解中则先终止求解）；
 *  - `cellMark(x, y)`：读取当前解中某格的标记（嘟嘟可 / 空白格）。
 */

import { reactive } from "vue";
import {
  CellState,
  DEFAULT_SOLVER_OPTIONS,
  mergeOptions,
  type SolutionResult,
  type SolverOptions,
} from "../core/index.js";
import { resolveEngine, type SolveHandle } from "./solveEngine.js";

/** 允许的最小棋盘边长 N。 */
export const MIN_N = 6;
/** 允许的最大棋盘边长 N。 */
export const MAX_N = 16;

/** 模式参数 K ∈ {1, 2}。 */
export type ModeK = 1 | 2;

/** 棋盘格子的求解结果标记（"" 表示未定 / 无结果）。 */
export type CellMark = "dodoco" | "empty" | "";

/** 求解流程状态。 */
export type SolveStatus = "idle" | "solving" | "done" | "error";

interface BoardState {
  /** 网格边长 N（6..16）。 */
  n: number;
  /** 模式参数 K（1 或 2）。 */
  k: ModeK;
  /** 颜色矩阵，`colors[y][x]`，颜色编号 0..N-1。 */
  colors: number[][];
  /** 当前画笔选中的颜色编号。 */
  selectedColor: number;
}

interface SolveState {
  /** 流程状态。 */
  status: SolveStatus;
  /** 错误信息（仅 `status === "error"` 时非空）。 */
  error: string | null;
  /** 求解结果（仅 `status === "done"` 时非空）。 */
  result: SolutionResult | null;
}

function blank(n: number): number[][] {
  return Array.from({ length: n }, () => new Array<number>(n).fill(0));
}

function clampN(next: number): number {
  return Math.min(MAX_N, Math.max(MIN_N, Math.round(next)));
}

/** 单例棋盘状态（响应式代理）。初始盘面为单色（全部颜色 0），由用户涂色或“随机着色”生成有效盘面。组件内直接读取即自动追踪依赖。 */
export const board = reactive<BoardState>({
  n: MIN_N,
  k: 1,
  colors: blank(MIN_N),
  selectedColor: 0,
});

/** 单例求解状态（响应式代理）。 */
export const solve = reactive<SolveState>({
  status: "idle",
  error: null,
  result: null,
});

export interface SolveOptsState {
  /** 最多寻找的解数（1 / 2 / Infinity = 全部）。 */
  maxSolutions: number;
}

/** 高级设置：求解器选项（响应式；仅影响之后的求解）。 */
export const solveOpts = reactive<SolveOptsState>({
  maxSolutions: DEFAULT_SOLVER_OPTIONS.maxSolutions,
});

/* ------------------------------------------------------------------ */
/* 求解动作                                                             */
/* ------------------------------------------------------------------ */

/** 进行中的求解句柄（两种引擎统一可取消）。 */
let activeHandle: SolveHandle | null = null;

/** 设置"最多寻找解数"（Infinity 表示全部）。 */
export function setMaxSolutions(next: number): void {
  solveOpts.maxSolutions = Number.isFinite(next)
    ? Math.max(1, Math.round(next))
    : Infinity;
}

/** 组装传给引擎的求解器选项（与默认值合并）。 */
function toOptions(): Required<SolverOptions> {
  return mergeOptions({ maxSolutions: solveOpts.maxSolutions });
}

/**
 * 求解当前棋盘（规则推导 + 必要时回溯）。
 *
 * 派发到求解引擎（`./solveEngine`）：真实浏览器中在独立 worker 线程执行、不阻塞 UI；
 * 无 `Worker` 的环境回退主线程求解。先让出一次宏任务，确保“求解中”状态先绘制。
 */
export async function startSolve(): Promise<void> {
  if (solve.status === "solving") return;
  solve.status = "solving";
  solve.error = null;
  solve.result = null;
  await new Promise((r) => setTimeout(r, 30));
  if (solve.status !== "solving") return; // 让出期间已被用户终止
  const handle = resolveEngine().solve(toConfig(), toOptions(), (reply) => {
    if (activeHandle !== handle) return; // 已取消的求解结果，丢弃
    activeHandle = null;
    if (reply.ok) {
      solve.result = reply.result;
      solve.status = "done";
    } else {
      solve.error = reply.error;
      solve.status = "error";
    }
  });
  activeHandle = handle;
}

/** 用户主动“结束求解”：终止进行中的求解并回到待求解态（未在求解时为无操作）。 */
export function stopSolve(): void {
  if (solve.status !== "solving") return;
  if (activeHandle) {
    activeHandle.cancel();
    activeHandle = null;
  }
  solve.status = "idle";
  solve.error = null;
  solve.result = null;
}

/** 清除求解结果与棋盘标记（棋盘变更时也会自动调用；求解中则先终止求解）。 */
export function clearSolution(): void {
  if (solve.status === "solving" && activeHandle) {
    activeHandle.cancel();
    activeHandle = null;
  }
  if (solve.status === "idle") return;
  solve.status = "idle";
  solve.error = null;
  solve.result = null;
}

/** 读取当前解中某格的标记（无结果 / 未定格返回 ""）。 */
export function cellMark(x: number, y: number): CellMark {
  const r = solve.result;
  if (!r || !r.solved || r.solutions.length === 0) return "";
  const s = r.solutions[0]?.[y]?.[x];
  if (s === CellState.DODOCO) return "dodoco";
  if (s === CellState.EMPTY) return "empty";
  return "";
}

/* ------------------------------------------------------------------ */
/* 状态变更（棋盘变化时自动清除旧求解结果）                               */
/* ------------------------------------------------------------------ */

/** 设置边长 N；保留旧盘面 (0,0) 起（x、y 索引最小一角）的重叠区域，超出范围的颜色做取模重映射。 */
export function setN(next: number): void {
  const n = clampN(next);
  if (n === board.n) return;
  const prev = board.colors;
  board.colors = Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => {
      const c = prev[y]?.[x] ?? 0;
      return c >= n ? c % n : c;
    }),
  );
  board.n = n;
  board.selectedColor = Math.min(board.selectedColor, n - 1);
  clearSolution();
}

/** 设置模式 K（仅接受 1 / 2，其余安全忽略）。 */
export function setK(k: ModeK): void {
  if (k !== 1 && k !== 2) return;
  if (k === board.k) return;
  board.k = k;
  clearSolution();
}

/** 设置单个格子颜色（越界 / 非法值安全忽略）。 */
export function setCell(x: number, y: number, color: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  if (x < 0 || x >= board.n || y < 0 || y >= board.n) return;
  const row = board.colors[y];
  if (!row) return;
  const next = Math.min(Math.max(color, 0), board.n - 1);
  if (row[x] === next) return;
  row[x] = next;
  clearSolution();
}

/** 清空棋盘：全部重置为颜色 0。 */
export function clearBoard(): void {
  board.colors = blank(board.n);
  clearSolution();
}

/** 随机着色，并保证每种颜色至少有 K 格（用于初始盘面 / 演示）。 */
export function randomFill(): void {
  const { n, k } = board;
  const total = n * n;
  const order = Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const flat = new Array<number>(total).fill(0);
  let p = 0;
  for (let c = 0; c < n && p < total; c++) {
    for (let r = 0; r < k && p < total; r++) flat[order[p]!] = c;
  }
  for (; p < total; p++) flat[order[p]!] = Math.floor(Math.random() * n);
  board.colors = Array.from({ length: n }, (_, y) => flat.slice(y * n, (y + 1) * n));
  clearSolution();
}

/* ------------------------------------------------------------------ */
/* 查询与导出                                                           */
/* ------------------------------------------------------------------ */

/** 输出与 core `PuzzleConfig` 同构的配置，可直接交给求解器。 */
export function toConfig(): { n: number; k: number; colors: number[][] } {
  return { n: board.n, k: board.k, colors: board.colors.map((row) => row.slice()) };
}