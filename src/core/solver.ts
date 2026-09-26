/**
 * @module solver
 *
 * {@link Solver}：把“规则推理引擎”和“朴素回溯（带规则前向剪枝）”串起来的调度器
 *
 * 求解流程：
 *   1. 用规则引擎把盘面推导到不动点（产出 {@link ReasoningChain} 逻辑链）；
 *   2. 若已解出 → 直接返回；若矛盾 → 返回无解；
 *   3. 否则进入回溯搜索：逐格尝试“放嘟嘟可 / 不放”，每步都用规则引擎做前向剪枝，
 *      一旦推导出矛盾立即回溯。
 */

import { Grid } from "./grid.js";
import { RuleEngine } from "./rules.js";
import {
  CellState,
  PuzzleConfig,
  ReasoningChainBuilder,
  ReasoningStep,
  SolutionResult,
  SolverOptions,
  fmtCell,
  mergeOptions,
} from "./types.js";

/** 回溯搜索的内部状态（可变的统计与剪枝信息）。 */
interface SearchState {
  /** 已找到的解（按发现顺序）。 */
  solutions: Grid[];
  /** 已访问的节点数。 */
  nodes: number;
  /** 节点数上限。 */
  maxNodes: number;
  /** 最多返回多少个解。 */
  maxSolutions: number;
  /** 是否应停止搜索（达到解数上限或节点上限）。 */
  stop: boolean;
  /** 导致最终解的那条“猜测”决策链（首次命中时保存）。 */
  winningPath: ReasoningStep[] | null;
  /** 回溯内部前向检查专用的推理链（不进入对外逻辑链）。 */
  scratchChain: ReasoningChainBuilder;
}

/**
 * 求解器。
 *
 * 用法：
 * ```ts
 * const solver = new Solver(config);          // 默认只求 1 个解
 * const result = solver.solve();
 * console.log(result.solved, result.reasoningChain);
 * ```
 */
export class Solver {
  /** 谜题配置（只读）。 */
  readonly config: PuzzleConfig;
  /** 模式参数 K（1 或 2）。 */
  readonly k: number;
  /** 初始网格（全 UNKNOWN，只读引用，不会被求解修改）。 */
  private readonly initialGrid: Grid;
  /** 规则引擎。 */
  private readonly engine: RuleEngine;
  /** 合并默认值后的求解器选项。 */
  private readonly options: Required<SolverOptions>;

  constructor(config: PuzzleConfig, options: SolverOptions = {}) {
    this.config = config;
    this.k = config.k;
    this.options = mergeOptions(options);
    this.initialGrid = new Grid(config);
    this.engine = new RuleEngine(config.k, {
      maxLocalPermutationCells: this.options.maxLocalPermutationCells,
    });
  }

  /**
   * 静态冲突检查：判断“在 (x,y) 放置嘟嘟可”是否立即违反约束。
   * 用于在递归分支前做一次廉价剪枝。
   */
  private static canPlaceDodoco(grid: Grid, x: number, y: number): boolean {
    // 八邻域不能有嘟嘟可。
    for (const nb of grid.neighbors(x, y)) {
      if (grid.stateAt(nb.x, nb.y) === CellState.DODOCO) return false;
    }
    // 行 / 列 / 颜色的嘟嘟可容量都必须未满。
    if (grid.regionCount("row", y).dodoco >= grid.k) return false;
    if (grid.regionCount("col", x).dodoco >= grid.k) return false;
    if (grid.regionCount("color", grid.colorAt(x, y)).dodoco >= grid.k)
      return false;
    return true;
  }

  /**
   * 朴素回溯搜索（按位置驱动 + 规则前向剪枝）。
   *
   * 对每个未定格尝试“放嘟嘟可 / 不放”，向下递归；
   * 每进入一层就用规则引擎做一次前向剪枝，若推导出矛盾立即返回（剪枝）。
   *
   * @param grid  当前盘面（本层尝试后的状态）。
   * @param state 搜索状态（统计 / 剪枝信息）。
   * @param path  从根到当前层的“猜测”决策链（用于记录最终解的路径）。
   */
  private backtrack(
    grid: Grid,
    state: SearchState,
    path: ReasoningStep[],
  ): void {
    // 前向剪枝：把本层状态推导到不动点；若矛盾则剪枝。
    const res = this.engine.applyAll(grid, state.scratchChain);
    if (!res.consistent) return;

    // 已经推导出完整解。
    if (grid.isComplete()) {
      state.solutions.push(grid.clone());
      if (state.winningPath === null) state.winningPath = path.slice();
      if (state.solutions.length >= state.maxSolutions) state.stop = true;
      return;
    }

    if (state.stop || state.nodes >= state.maxNodes) {
      state.stop = true;
      return;
    }

    // 选择下一个未定格：从上到下、从左到右（行优先）。
    let bx = -1;
    let by = -1;
    outer: for (let y = 0; y < grid.n; y++) {
      for (let x = 0; x < grid.n; x++) {
        if (grid.stateAt(x, y) === CellState.UNKNOWN) {
          bx = x;
          by = y;
          break outer;
        }
      }
    }
    if (bx === -1) return; // 理论上不会发生（未完成却无未定格）

    // 分支 1：在该格放置嘟嘟可。
    if (Solver.canPlaceDodoco(grid, bx, by)) {
      state.nodes++;
      path.push({
        rule: "BACKTRACK",
        decisions: [{ cell: { x: bx, y: by }, decision: CellState.DODOCO }],
        detail: `回溯猜测：在格子 ${fmtCell(bx, by)} 放置嘟嘟可。`,
        step: path.length,
      });
      const g1 = grid.clone();
      g1.setState(bx, by, CellState.DODOCO);
      this.backtrack(g1, state, path);
      path.pop();
      if (state.stop) return;
    }

    // 分支 2：在该格标记空白（不放嘟嘟可）。
    state.nodes++;
    path.push({
      rule: "BACKTRACK",
      decisions: [{ cell: { x: bx, y: by }, decision: CellState.EMPTY }],
      detail: `回溯猜测：在格子 ${fmtCell(bx, by)} 标记为空。`,
      step: path.length,
    });
    const g2 = grid.clone();
    g2.setState(bx, by, CellState.EMPTY);
    this.backtrack(g2, state, path);
    path.pop();
  }

  /**
   * 求解谜题：规则推导 →（必要时）回溯搜索。
   *
   * @returns 结构化的求解结果（解、逻辑链、回溯路径、统计信息）。
   */
  solve(): SolutionResult {
    const start = Date.now();
    const chain = new ReasoningChainBuilder();
    const working = this.initialGrid.clone();

    // 阶段 1：规则引擎推导到不动点（产出逻辑链）。
    const r = this.engine.applyAll(working, chain);
    const ruleRounds = r.rounds;
    const ruleMarkings = r.markings;

    if (!r.consistent) {
      return {
        solved: false,
        solutions: [],
        reasoningChain: chain.build(),
        usedBacktrack: false,
        nodesVisited: 0,
        elapsedMs: Date.now() - start,
        stats: { ruleRounds, ruleMarkings },
      };
    }

    if (working.isComplete()) {
      return {
        solved: true,
        solutions: [working.snapshot()],
        reasoningChain: chain.build(),
        usedBacktrack: false,
        nodesVisited: 0,
        elapsedMs: Date.now() - start,
        stats: { ruleRounds, ruleMarkings },
      };
    }

    // 阶段 2：回溯搜索（带规则前向剪枝）。
    const state: SearchState = {
      solutions: [],
      nodes: 0,
      maxNodes: this.options.maxBacktrackNodes,
      maxSolutions: this.options.maxSolutions,
      stop: false,
      winningPath: null,
      scratchChain: new ReasoningChainBuilder(),
    };
    this.backtrack(working, state, []);

    const found = state.solutions;
    const limited = found.slice(0, this.options.maxSolutions);
    return {
      solved: found.length > 0,
      solutions: limited.map((g) => g.snapshot()),
      reasoningChain: chain.build(),
      usedBacktrack: true,
      nodesVisited: state.nodes,
      elapsedMs: Date.now() - start,
      stats: { ruleRounds, ruleMarkings },
      ...(state.winningPath !== null ? { backtrackPath: state.winningPath } : {}),
    };
  }
}