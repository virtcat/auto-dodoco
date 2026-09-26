/**
 * @module rules
 *
 * 规则推理引擎
 *
 * 引擎在一张可变的 {@link Grid} 上循环应用以下规则，直到盘面不再变化（不动点）：
 *   1. {@link RuleEngine.applyCounting}        —— 基础计数（容量已满/容量饱满）；
 *   2. {@link RuleEngine.applyNeighbor}        —— 八邻域互斥（拓扑剪枝）；
 *   3. {@link RuleEngine.applyLocalPermutation} —— 区域局部全排列枚举（行/列/颜色）。
 *
 * 求解调度（规则 → 回溯）由 {@link Solver} 负责。
 */

import { Grid } from "./grid.js";
import {
  CellDecision,
  CellState,
  Coord,
  ReasoningChainBuilder,
  ReasoningRule,
  ReasoningStep,
  RegionScope,
  coordKey,
  fmtCell,
  sameCoord,
  scopeToString,
} from "./types.js";

/** 一次“应用全部规则直到不动点”的结果。 */
export interface ApplyRulesResult {
  /** 是否有格子被标记（本轮是否推进了推理）。 */
  changed: boolean;
  /** 推导过程中是否检测到矛盾（不一致）。`false` 表示盘面仍然“可继续”。 */
  consistent: boolean;
  /** 规则引擎迭代轮数。 */
  rounds: number;
  /** 累计标记的格子数。 */
  markings: number;
}

/**
 * 标记上下文：在一次“应用规则”的过程中被各个规则共享，
 * 用于就地改盘、记录逻辑链、累计改动并传播“矛盾”信号。
 */
export interface MarkingContext {
  /** 待就地修改的网格。 */
  grid: Grid;
  /** 推理链累加器。 */
  chain: ReasoningChainBuilder;
  /** 一旦检测到矛盾即置为 `true`，各规则看到后应立刻停止。 */
  conflict: boolean;
  /** 本次（或本组）应用累计标记的格子数。 */
  markings: number;
}

/** 一次就地标记的结果。 */
type MarkResult = "marked" | "conflict" | "noop";

/**
 * 就地标记一个格子为目标状态（不记录逻辑链、不计数）。
 *
 * - 目标格当前为 UNKNOWN → 标记，返回 `"marked"`；
 * - 目标格当前已等于 target → 返回 `"noop"`；
 * - 目标格当前是另一个确定状态 → 置 `ctx.conflict` 并返回 `"conflict"`。
 */
function applyMark(
  ctx: MarkingContext,
  x: number,
  y: number,
  target: CellState.DODOCO | CellState.EMPTY,
): MarkResult {
  if (ctx.conflict) return "conflict";
  const current = ctx.grid.stateAt(x, y);
  if (current === CellState.UNKNOWN) {
    ctx.grid.setState(x, y, target);
    return "marked";
  }
  if (current !== target) {
    // 目标格已被推导为相反状态 → 逻辑矛盾。
    ctx.conflict = true;
    return "conflict";
  }
  return "noop";
}

/**
 * 单格规则便捷标记：就地标记 + 记录一条推理日志（仅 1 个决策）。
 *
 * - 目标格当前为 UNKNOWN → 标记并记录；
 * - 目标格当前已等于 target → 静默无操作；
 * - 目标格当前是另一个确定状态 → 记为矛盾（`ctx.conflict = true`）。
 *
 * @param scope      触发推理的区域作用域（基础计数规则携带）。
 * @param sourceCell 触发推理的嘟嘟可格子（邻域互斥规则携带）。
 */
function markOne(
  ctx: MarkingContext,
  x: number,
  y: number,
  target: CellState.DODOCO | CellState.EMPTY,
  rule: ReasoningRule,
  detail: string,
  scope?: RegionScope,
  sourceCell?: Coord,
): void {
  if (ctx.conflict) return;
  const r = applyMark(ctx, x, y, target);
  if (r === "marked") {
    ctx.markings++;
    ctx.chain.push(
      rule,
      [{ cell: { x, y }, decision: target }],
      detail,
      scope,
      sourceCell,
    );
  }
  // "noop" 静默无操作；"conflict" 已由 applyMark 置位。
}

/** 批量标记的单个输入项。 */
interface BatchMark {
  x: number;
  y: number;
  target: CellState.DODOCO | CellState.EMPTY;
}

/**
 * 批量标记：一次性就地标记多个格子，并只记录一条推理日志。
 *
 * 用于局部全排列枚举（行/列/颜色）——一次枚举得到的多个可标记格子合并为同一条日志。
 * 若过程中检测到矛盾，则不记录任何日志（交由上层剪枝）。
 *
 * @returns 实际被标记（并计入逻辑链）的格子数；矛盾或无新增时为 0。
 */
function markBatch(
  ctx: MarkingContext,
  marks: readonly BatchMark[],
  rule: ReasoningRule,
  detail: string,
  scope?: RegionScope,
): number {
  if (ctx.conflict) return 0;
  const decisions: CellDecision[] = [];
  for (const m of marks) {
    const r = applyMark(ctx, m.x, m.y, m.target);
    if (r === "conflict") return 0; // 矛盾：放弃本次批量标记，不记录逻辑链
    if (r === "marked") {
      decisions.push({ cell: { x: m.x, y: m.y }, decision: m.target });
    }
  }
  if (decisions.length === 0) return 0; // 全部为 noop，无需记录
  ctx.markings += decisions.length;
  ctx.chain.push(rule, decisions, detail, scope);
  return decisions.length;
}

/**
 * 构建局部全排列枚举日志的合并说明文本。
 *
 * 合并日志不再携带每一轮各自的“共枚举出 N 个合法方案”计数，
 * 而是直接列出该区域推理确定的全部格子。
 */
function buildLocalPermutationDetail(
  first: ReasoningStep,
  decisions: readonly CellDecision[],
): string {
  const label = scopeToString(first.scope as RegionScope);
  const dodos = decisions
    .filter((d) => d.decision === CellState.DODOCO)
    .map((d) => fmtCell(d.cell.x, d.cell.y));
  const empties = decisions
    .filter((d) => d.decision === CellState.EMPTY)
    .map((d) => fmtCell(d.cell.x, d.cell.y));
  const parts: string[] = [];
  if (dodos.length > 0) parts.push(`格子 ${dodos.join("、")} 必为嘟嘟可`);
  if (empties.length > 0) parts.push(`格子 ${empties.join("、")} 必为空`);
  return `${label} 局部全排列枚举推理：${parts.join("，")}。`;
}

/**
 * 构建“容量已满”日志的合并说明文本。
 */
function buildCountFullDetail(
  first: ReasoningStep,
  decisions: readonly CellDecision[],
  k: number,
): string {
  const label = scopeToString(first.scope as RegionScope);
  const cells = decisions
    .map((d) => fmtCell(d.cell.x, d.cell.y))
    .join("、");
  return `${label}的嘟嘟可数量已达上限（${k} ≥ ${k}），故格子 ${cells} 标记为空。`;
}

/**
 * 构建“容量饱满”日志的合并说明文本。
 */
function buildCountApproachDetail(
  first: ReasoningStep,
  decisions: readonly CellDecision[],
): string {
  const label = scopeToString(first.scope as RegionScope);
  const cells = decisions
    .map((d) => fmtCell(d.cell.x, d.cell.y))
    .join("、");
  return `${label}还差嘟嘟可且仅剩少量未定格，故格子 ${cells} 标记为嘟嘟可。`;
}

/**
 * 构建“八邻域互斥”日志的合并说明文本。
 */
function buildNeighborDetail(
  first: ReasoningStep,
  decisions: readonly CellDecision[],
): string {
  const src = first.sourceCell as Coord;
  const cells = decisions
    .map((d) => fmtCell(d.cell.x, d.cell.y))
    .join("、");
  return `格子 ${fmtCell(src.x, src.y)} 已确定为嘟嘟可，其八邻域格子 ${cells} 标记为空。`;
}

/* -------------------------------------------------------------------------- */
/* 局部全排列枚举的辅助函数                                                  */
/* -------------------------------------------------------------------------- */

/** 判断格子 (x,y) 是否与网格中某个“已确定”的嘟嘟可八邻域相邻。 */
function isAdjacentToAnyDodoco(grid: Grid, x: number, y: number): boolean {
  for (const nb of grid.neighbors(x, y)) {
    if (grid.stateAt(nb.x, nb.y) === CellState.DODOCO) return true;
  }
  return false;
}

/**
 * 判断一个“方案”（一组将要放置嘟嘟可的格子）是否合法：
 *  1. 每个格子都不能与任何已存在的嘟嘟可八邻域相邻；
 *  2. 方案内部的任意两格不能八邻域相邻。
 */
function isPlanValid(grid: Grid, plan: readonly Coord[]): boolean {
  for (const c of plan) {
    if (isAdjacentToAnyDodoco(grid, c.x, c.y)) return false;
  }
  for (let i = 0; i < plan.length; i++) {
    for (let j = i + 1; j < plan.length; j++) {
      if (Grid.isAdjacent(plan[i], plan[j])) return false;
    }
  }
  return true;
}

/**
 * 从数组 `items` 中取 `k` 个元素的组合（元素保持原顺序），惰性生成。
 * 在本题中 `k = remainingNeeded ∈ {1, 2}`。
 */
function* combinations<T>(
  items: readonly T[],
  k: number,
): Generator<readonly T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  if (k > items.length) return;
  for (let i = 0; i <= items.length - k; i++) {
    const head = items[i];
    for (const tail of combinations(items.slice(i + 1), k - 1)) {
      yield [head, ...tail];
    }
  }
}

/* -------------------------------------------------------------------------- */
/* RuleEngine                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 规则推理引擎。
 *
 * 用法：
 * ```ts
 * const engine = new RuleEngine(k, { maxLocalPermutationCells: 8 });
 * const chain = new ReasoningChainBuilder();
 * const result = engine.applyAll(grid, chain);
 * if (result.consistent && grid.isComplete()) { /* 已解出 *\/ }
 * ```
 */
export class RuleEngine {
  /** 模式参数 K（1 或 2）。 */
  readonly k: number;
  /** 单区域（行 / 列 / 颜色）局部全排列枚举时，允许的未定格子上限。 */
  readonly maxLocalPermutationCells: number;

  constructor(
    k: number,
    options: { maxLocalPermutationCells?: number } = {},
  ) {
    if (k !== 1 && k !== 2) {
      throw new Error(`RuleEngine 要求 K ∈ {1, 2}，收到 K=${k}。`);
    }
    this.k = k;
    this.maxLocalPermutationCells =
      options.maxLocalPermutationCells ?? 8;
  }

  /* ---------------------------- 3.1 基础计数 ---------------------------- */

  /**
   * 基础计数规则（容量为 K），作用于行 / 列 / 颜色三类区域。
   *
   * - 容量已满（排除法）：区域内嘟嘟可已达 K → 其余未定格标记 EMPTY；
   * - 容量饱满（逼近法）：区域内未定格数量恰好等于还差的嘟嘟可数 → 全部标记嘟嘟可。
   */
  applyCounting(ctx: MarkingContext): void {
    if (ctx.conflict) return;
    const { grid } = ctx;
    const k = this.k;

    // 依次处理所有行、列、颜色区域。
    const scopes: RegionScope[] = [];
    for (let i = 0; i < grid.n; i++) {
      scopes.push({ kind: "row", index: i });
      scopes.push({ kind: "col", index: i });
    }
    for (const color of grid.colorsList) {
      scopes.push({ kind: "color", index: color });
    }

    for (const scope of scopes) {
      if (ctx.conflict) return;
      const count = grid.countByScope(scope);
      const scopeLabel = scopeToString(scope);

      // ① 容量已满（排除法）。
      if (count.dodoco >= k && count.unknown > 0) {
        for (const cell of grid.regionCells(scope.kind, scope.index)) {
          if (grid.stateAt(cell.x, cell.y) !== CellState.UNKNOWN) continue;
          markOne(
            ctx,
            cell.x,
            cell.y,
            CellState.EMPTY,
            "COUNT_CAPACITY_FULL",
            `${scopeLabel}的嘟嘟可数量已达上限（${count.dodoco} ≥ ${k}），故格子 ${fmtCell(cell.x, cell.y)} 标记为空。`,
            scope,
          );
          if (ctx.conflict) return;
        }
        continue; // 已满的区域不再走逼近法
      }

      // ② 容量饱满（逼近法）。
      if (count.dodoco < k) {
        const needed = k - count.dodoco;
        if (count.unknown === needed && count.unknown > 0) {
          for (const cell of grid.regionCells(scope.kind, scope.index)) {
            if (grid.stateAt(cell.x, cell.y) !== CellState.UNKNOWN) continue;
            markOne(
              ctx,
              cell.x,
              cell.y,
              CellState.DODOCO,
              "COUNT_CAPACITY_FULL_APPROACH",
              `${scopeLabel}还差 ${needed} 个嘟嘟可，且仅剩 ${count.unknown} 个未定格，故格子 ${fmtCell(cell.x, cell.y)} 标记为嘟嘟可。`,
              scope,
            );
            if (ctx.conflict) return;
          }
        }
      }
    }
  }

  /* ---------------------------- 3.2 八邻域互斥 --------------------------- */

  /**
   * 八邻域互斥（拓扑剪枝）：任何确定嘟嘟可的格子，其 8 个邻居的未定格标记 EMPTY。
   *
   * 每个被标记的邻居日志都携带触发它的嘟嘟可格子（`sourceCell`），
   * 以便在 applyAll 末尾把“同一只嘟嘟可触发的邻域互斥”合并为一步。
   */
  applyNeighbor(ctx: MarkingContext): void {
    if (ctx.conflict) return;
    const { grid } = ctx;
    for (let y = 0; y < grid.n; y++) {
      for (let x = 0; x < grid.n; x++) {
        if (grid.stateAt(x, y) !== CellState.DODOCO) continue;
        for (const nb of grid.neighbors(x, y)) {
          if (grid.stateAt(nb.x, nb.y) !== CellState.UNKNOWN) continue;
          markOne(
            ctx,
            nb.x,
            nb.y,
            CellState.EMPTY,
            "NEIGHBOR_EXCLUSION",
            `格子 ${fmtCell(x, y)} 已确定为嘟嘟可，其八邻域格子 ${fmtCell(nb.x, nb.y)} 标记为空。`,
            undefined,
            { x, y },
          );
          if (ctx.conflict) return;
        }
      }
    }
  }

  /* --------------------- 3.3 区域局部全排列枚举（行/列/颜色） ----------- */

  /**
   * 区域局部全排列枚举推导（通用形状推理）。
   *
   * 对每一行、每一列、每一色区域 R（它们都满足“恰好 K 个嘟嘟可”的约束）：
   *  1. 取其内部所有未定格集合 U；
   *  2. 枚举在 U 中放置“剩余所需嘟嘟可数”的所有合法方案 S（满足八邻域互斥）；
   *  3. 交集 / 并集推理：
   *     - 若某格在所有方案中都有嘟嘟可 → 标记嘟嘟可；
   *     - 若某格在所有方案中都没有嘟嘟可 → 标记 EMPTY；
   *     - 外侧联动排除：若某外侧格在所有方案中都被嘟嘟可八邻域覆盖 → 标记 EMPTY。
   *
   * 一次枚举（同一区域）得到的全部可标记格合并为一条逻辑链日志；
   * 若同一区域在多轮中被反复枚举，其日志也会在 applyAll 末尾合并为一步；
   * 当区域未定格数过多（> {@link RuleEngine.maxLocalPermutationCells}）时跳过，交由回溯处理；
   * 当无合法方案（S 为空）时，判定当前分支矛盾。
   */
  applyLocalPermutation(ctx: MarkingContext): void {
    if (ctx.conflict) return;
    const { grid } = ctx;

    // 颜色是谜题的“定义性”约束（每种颜色恰好 K 个嘟嘟可），故优先枚举；
    // 行 / 列 / 颜色三类区域都满足“恰好 K 个嘟嘟可”，故都适用本枚举推导。
    for (const color of grid.colorsList) {
      this.applyRegionLocalPermutation(ctx, { kind: "color", index: color });
      if (ctx.conflict) return;
    }
    for (let i = 0; i < grid.n; i++) {
      this.applyRegionLocalPermutation(ctx, { kind: "row", index: i });
      if (ctx.conflict) return;
    }
    for (let i = 0; i < grid.n; i++) {
      this.applyRegionLocalPermutation(ctx, { kind: "col", index: i });
      if (ctx.conflict) return;
    }
  }

  /**
   * 对单个区域（行 / 列 / 颜色）做局部全排列枚举推导。
   * 推理细节见 {@link RuleEngine.applyLocalPermutation} 的说明。
   */
  private applyRegionLocalPermutation(
    ctx: MarkingContext,
    scope: RegionScope,
  ): void {
    if (ctx.conflict) return;
    const { grid } = ctx;
    const k = this.k;
    const { kind, index } = scope;

    const count = grid.regionCount(kind, index);
    const remainingNeeded = k - count.dodoco;
    if (remainingNeeded <= 0) return; // 容量已满，交由计数规则处理

    // 提取该区域内部所有未定格 U。
    const U = grid
      .regionCells(kind, index)
      .filter((c) => grid.stateAt(c.x, c.y) === CellState.UNKNOWN);

    if (U.length < remainingNeeded) {
      // 未定格不足以放置所需嘟嘟可 → 矛盾（isConsistent 亦会捕获）。
      ctx.conflict = true;
      return;
    }
    if (U.length > this.maxLocalPermutationCells) {
      // 未定格过多，跳过枚举，交由回溯器处理，避免组合爆炸。
      return;
    }

    // ② 生成合法方案集合 S。
    const plans: Coord[][] = [];
    for (const combo of combinations(U, remainingNeeded)) {
      if (isPlanValid(grid, combo)) plans.push(combo as Coord[]);
    }

    if (plans.length === 0) {
      // 无合法方案 → 当前分支矛盾。
      ctx.conflict = true;
      return;
    }

    const uSet = new Set<number>(U.map((c) => coordKey(c)));

    // ③ 交集 / 并集推理（U 内部格子）：收集本次枚举可确定的格子。
    const marks: BatchMark[] = [];
    for (const p of U) {
      const presentInAll = plans.every((plan) =>
        plan.some((c) => sameCoord(c, p)),
      );
      const absentFromAll = plans.every((plan) =>
        plan.every((c) => !sameCoord(c, p)),
      );
      if (presentInAll) {
        marks.push({ x: p.x, y: p.y, target: CellState.DODOCO });
      } else if (absentFromAll) {
        marks.push({ x: p.x, y: p.y, target: CellState.EMPTY });
      }
      // 其余情况（部分方案含、部分不含）保持 UNKNOWN。
    }

    // ④ 外侧联动排除：U 之外、但与 U 八邻域相交且被每个方案覆盖的未定格 → 空。
    const candidates = new Map<number, Coord>();
    for (const c of U) {
      for (const nb of grid.neighbors(c.x, c.y)) {
        if (grid.stateAt(nb.x, nb.y) !== CellState.UNKNOWN) continue;
        if (uSet.has(coordKey(nb))) continue; // U 内部格子已在 ③ 处理
        candidates.set(coordKey(nb), nb);
      }
    }
    for (const q of candidates.values()) {
      const coveredInAll = plans.every((plan) =>
        plan.some((c) => Grid.isAdjacent(c, q)),
      );
      if (coveredInAll) {
        marks.push({ x: q.x, y: q.y, target: CellState.EMPTY });
      }
    }

    // ⑤ 一次枚举 = 一条逻辑链：把上面收集到的全部格子合并为单步记录。
    if (marks.length > 0) {
      const dodos = marks
        .filter((m) => m.target === CellState.DODOCO)
        .map((m) => fmtCell(m.x, m.y));
      const empties = marks
        .filter((m) => m.target === CellState.EMPTY)
        .map((m) => fmtCell(m.x, m.y));
      const parts: string[] = [];
      if (dodos.length > 0) parts.push(`格子 ${dodos.join("、")} 必为嘟嘟可`);
      if (empties.length > 0) parts.push(`格子 ${empties.join("、")} 必为空`);
      const label = scopeToString(scope);
      const detail = `${label} 共枚举出 ${plans.length} 个合法方案，${parts.join("，")}。`;
      markBatch(ctx, marks, "LOCAL_PERMUTATION", detail, scope);
      if (ctx.conflict) return;
    }
  }

  /* --------------------------- 固定点驱动 ------------------------------- */

  /**
   * 循环应用全部规则直到盘面不再变化（或检测到矛盾）。
   *
   * 每一轮按顺序执行：基础计数 → 八邻域互斥 → 单色局部全排列枚举；
   * 随后做一次矛盾检测（{@link Grid.isConsistent}）；
   * 若本轮没有任何新标记（不动点）或检测到矛盾，则停止。
   *
   * @param grid  待就地修改的网格。
   * @param chain 推理链累加器（会追加本轮所有日志）。
   * @returns 应用结果（是否推进、是否矛盾、轮数、改动数）。
   */
  applyAll(grid: Grid, chain: ReasoningChainBuilder): ApplyRulesResult {
    const ctx: MarkingContext = {
      grid,
      chain,
      conflict: false,
      markings: 0,
    };
    // 记录本次调用前链的长度：末尾合并“同区域多步”时只针对本次新增的日志，
    // 避免影响回溯阶段共享的长链（也保持 O(本次新增日志数) 的开销）。
    const chainLenBefore = chain.length;
    let rounds = 0;
    const maxRounds = grid.n * grid.n * 2 + 16; // 安全上限，防止意外死循环

    for (;;) {
      rounds++;
      const before = ctx.markings;

      this.applyCounting(ctx);
      if (!ctx.conflict) this.applyNeighbor(ctx);
      if (!ctx.conflict) this.applyLocalPermutation(ctx);

      // 矛盾检测：任一区域计数越界，或出现相邻嘟嘟可。
      if (!ctx.conflict && !grid.isConsistent()) {
        ctx.conflict = true;
      }
      if (ctx.conflict) break;

      // 不动点：本轮没有任何新标记。
      if (ctx.markings - before === 0) break;

      if (rounds >= maxRounds) break; // 安全上限
    }

    // “一次推理 = 一步”：把本次新增日志中“同一规则 + 同一推理主体”的多条日志
    // 合并到最早出现的那一步上：
    //   - 基础计数 / 局部全排列枚举：推理主体 = 区域（scope）；
    //   - 邻域互斥：推理主体 = 触发它的嘟嘟可（sourceCell）。
    const k = this.k;
    chain.mergeStepsBySubject(
      "LOCAL_PERMUTATION",
      (first, decisions) => buildLocalPermutationDetail(first, decisions),
      chainLenBefore,
    );
    chain.mergeStepsBySubject(
      "COUNT_CAPACITY_FULL",
      (first, decisions) => buildCountFullDetail(first, decisions, k),
      chainLenBefore,
    );
    chain.mergeStepsBySubject(
      "COUNT_CAPACITY_FULL_APPROACH",
      (first, decisions) => buildCountApproachDetail(first, decisions),
      chainLenBefore,
    );
    chain.mergeStepsBySubject(
      "NEIGHBOR_EXCLUSION",
      (first, decisions) => buildNeighborDetail(first, decisions),
      chainLenBefore,
    );

    return {
      changed: ctx.markings > 0,
      consistent: !ctx.conflict,
      rounds,
      markings: ctx.markings,
    };
  }
}