/**
 * @module types
 *
 * 核心数据模型与公共类型定义。
 *
 * 本模块不依赖任何 UI / DOM 代码，是“嘟嘟可”矩阵颜色谜题求解器的纯数据层。
 *
 * 坐标约定：
 *   - 网格为 N×N 的正方形；
 *   - `x` 为列（column，横向，0..N-1）；
 *   - `y` 为行（row，纵向，0..N-1）；
 *   - 二维数组一律采用 `arr[y][x]`（先行后列）的排布方式。
 */

/* -------------------------------------------------------------------------- */
/* 1. 格子状态                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 单个格子在某一时刻的状态。
 *
 * - {@link CellState.DODOCO}  (1)  ：确定为嘟嘟可。
 * - {@link CellState.EMPTY}    (0)  ：确定空白（无嘟嘟可）。
 * - {@link CellState.UNKNOWN} (-1) ：未知，待推导或待搜索。
 */
export enum CellState {
  /** 确定为嘟嘟可 */
  DODOCO = 1,
  /** 确定空白（无嘟嘟可） */
  EMPTY = 0,
  /** 未知，待推导或待搜索 */
  UNKNOWN = -1,
}

/** 判断某状态是否为“已确定”（非 UNKNOWN）。 */
export function isDecided(state: CellState): boolean {
  return state !== CellState.UNKNOWN;
}

/* -------------------------------------------------------------------------- */
/* 2. 坐标与格子                                                              */
/* -------------------------------------------------------------------------- */

/** 一个格子坐标。`x` 为列，`y` 为行。 */
export interface Coord {
  /** 列坐标（0..N-1） */
  x: number;
  /** 行坐标（0..N-1） */
  y: number;
}

/** 构造坐标的便捷工厂函数。 */
export function coord(x: number, y: number): Coord {
  return { x, y };
}

/** 坐标相等判断。 */
export function sameCoord(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

/** 将坐标编码成一个唯一的数字索引（用于 Set / Map）。 */
export function coordKey(c: Coord): number {
  // N <= 16，使用 (y << 8) | x 足以唯一编码且不冲突。
  return (c.y << 8) | c.x;
}

/**
 * 把一个格子坐标格式化为展示文本（1-based）。
 *
 * 内部坐标为 0-based `(x, y)`，面向用户的文本统一显示
 * 列号 `x+1`、行号 `y+1`（与棋盘行列编号一致：
 * 列号从左到右 1..N，行号从下到上 1..N）。
 */
export function fmtCell(x: number, y: number): string {
  return `(${x + 1},${y + 1})`;
}

/* -------------------------------------------------------------------------- */
/* 3. 关卡 / 谜题配置                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 一个关卡（谜题）的完整配置。
 *
 * @property n       网格边长，1 <= n <= 16。
 * @property k       模式参数 K，取值为 1 或 2：
 *                    - K=1：每种颜色、每行、每列恰好 1 个嘟嘟可；
 *                    - K=2：每种颜色、每行、每列恰好 2 个嘟嘟可。
 * @property colors  `colors[y][x]` 为格子颜色编号；
 *                    颜色编号应为连续整数 0..(colorCount-1)，共 N 种颜色。
 */
export interface PuzzleConfig {
  /** 网格边长 N（N <= 16）。 */
  n: number;
  /** 模式参数 K（K ∈ {1, 2}）。 */
  k: number;
  /** 颜色矩阵，形状 N×N，`colors[y][x]`。 */
  colors: number[][];
}

/**
 * 校验一份 {@link PuzzleConfig} 是否自洽（不要求可解，只要求结构合法）。
 *
 * @throws {Error} 当配置非法时抛出带有中文说明的错误。
 */
export function validateConfig(config: PuzzleConfig): void {
  const { n, k, colors } = config;

  if (!Number.isInteger(n) || n < 1 || n > 16) {
    throw new Error(`非法的网格边长 N=${n}：必须为 1..16 的整数。`);
  }
  if (k !== 1 && k !== 2) {
    throw new Error(`非法的模式参数 K=${k}：只能为 1 或 2。`);
  }
  if (!Array.isArray(colors) || colors.length !== n) {
    throw new Error(`颜色矩阵行数 ${colors?.length} 与 N=${n} 不一致。`);
  }
  for (let y = 0; y < n; y++) {
    const row = colors[y];
    if (!Array.isArray(row) || row.length !== n) {
      throw new Error(`颜色矩阵第 ${y} 行长度 ${row?.length} 与 N=${n} 不一致。`);
    }
    for (let x = 0; x < n; x++) {
      const c = row[x];
      if (!Number.isInteger(c) || c < 0) {
        throw new Error(`颜色矩阵 [${y}][${x}] 的值 ${c} 非法：必须为非负整数。`);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 4. 推理链（ReasoningChain）                                                */
/* -------------------------------------------------------------------------- */

/** 规则类别枚举：一条推理日志来源于哪一类规则。 */
export type ReasoningRule =
  /** 3.1 基础计数 - 容量已满（排除法） */
  | "COUNT_CAPACITY_FULL"
  /** 3.1 基础计数 - 容量饱满（逼近法） */
  | "COUNT_CAPACITY_FULL_APPROACH"
  /** 3.2 八邻域互斥（拓扑剪枝） */
  | "NEIGHBOR_EXCLUSION"
  /** 3.3 区域局部全排列枚举（行/列/颜色） */
  | "LOCAL_PERMUTATION"
  /** 3.4 高级区域相交推导 */
  | "CROSS_SET"
  /** 回溯搜索做出的决策（非纯逻辑推导） */
  | "BACKTRACK";

/** 一个被规则影响到的区域描述（行 / 列 / 颜色）。 */
export type RegionScope =
  | { kind: "row"; index: number }
  | { kind: "col"; index: number }
  | { kind: "color"; index: number };

/** 区域作用域的字符串描述（用于日志展示；行/列/颜色编号均为 1-based，与棋盘及画笔展示一致）。 */
export function scopeToString(scope: RegionScope): string {
  switch (scope.kind) {
    case "row":
      return `第 ${scope.index + 1} 行`;
    case "col":
      return `第 ${scope.index + 1} 列`;
    case "color":
      return `颜色区域 #${scope.index + 1}`;
  }
}

/** 单格决策：某一步推理中，一个被确定状态的格子及其目标状态。 */
export interface CellDecision {
  /** 被决定状态的格子坐标。 */
  cell: Coord;
  /** 目标状态（仅 DODOCO 或 EMPTY）。 */
  decision: CellState.DODOCO | CellState.EMPTY;
}

/**
 * 一条结构化的推理日志。
 *
 * 引擎每完成一次“推理动作”就产生一条这样的日志，串起来即 {@link ReasoningChain}。
 * 一条日志可覆盖多个格子（{@link CellDecision} 数组）：
 *  - “一次推理确定多格”的规则（基础计数 / 邻域互斥 / 局部全排列枚举）
 *    → 同一次推理（以区域或触发嘟嘟可为主体，可能跨多轮）确定的全部格子合并为同一条日志；
 *  - 回溯猜测 → `decisions` 仅 1 个元素。
 * 日志文本使用中文并统一使用“嘟嘟可”一词，便于演示时直接展示。
 */
export interface ReasoningStep {
  /** 产生该日志的规则类别。 */
  rule: ReasoningRule;
  /** 本步确定的全部格子（≥1）。 */
  decisions: CellDecision[];
  /** 触发推理的区域作用域（可选）。 */
  scope?: RegionScope;
  /** 触发邻域互斥的嘟嘟可格子（仅 NEIGHBOR_EXCLUSION 日志携带）。 */
  sourceCell?: Coord;
  /** 供人类阅读的解释文本（中文，含“嘟嘟可”）。 */
  detail: string;
  /** 产生该日志时的全局步序号（从 0 开始）。 */
  step: number;
}

/** 推理链：按产生顺序排列的结构化日志数组。 */
export type ReasoningChain = ReasoningStep[];

/**
 * 推理链累加器：在规则引擎 / 回溯器内部使用，
 * 负责按顺序追加日志并自动编号，最终产出 {@link ReasoningChain}。
 */
export class ReasoningChainBuilder {
  private steps: ReasoningStep[] = [];
  /** 已并入更早步骤的日志（最终产出推理链时被过滤掉）。 */
  private mergedOut = new WeakSet<ReasoningStep>();

  get length(): number {
    return this.steps.length;
  }

  /**
   * 追加一条推理日志。
   * @param sourceCell 触发推理的嘟嘟可格子（用于 NEIGHBOR_EXCLUSION 日志）。
   * @returns 本次追加后的最新一条日志（供调用方判断是否为“有效推理”）。
   */
  push(
    rule: ReasoningRule,
    decisions: CellDecision[],
    detail: string,
    scope?: RegionScope,
    sourceCell?: Coord,
  ): ReasoningStep {
    const step: ReasoningStep = {
      rule,
      decisions,
      detail,
      step: this.steps.length,
    };
    if (scope !== undefined) step.scope = scope;
    if (sourceCell !== undefined) step.sourceCell = { ...sourceCell };
    this.steps.push(step);
    return step;
  }

  /**
   * 合并“同一规则 + 同一推理主体”的多条日志为一步。
   *
   * “推理主体”是触发推理的单位：
   *  - 区域规则（基础计数 / 局部全排列枚举）→ {@link ReasoningStep.scope}（某行/列/颜色）；
   *  - 邻域互斥规则 → {@link ReasoningStep.sourceCell}（某只嘟嘟可）。
   *
   * 同一主体的多条日志合并到**最早出现**的那一条上：
   *   - `decisions` 取并集（按“格子 + 目标状态”去重）；
   *   - `detail` 用 `buildDetail(first, decisions)` 重新生成；
   *   - 仅出现一次的主体日志原样保留（保留其原有说明文本）。
   *
   * `fromIndex` 界定“本次应用”的范围：只有下标 ≥ `fromIndex` 的日志参与合并
   * （典型用法是传入调用前的 `chain.length`，只合并本次 `applyAll` 新增的日志）。
   * 合并在原地完成（更新最早一条的内容 + 将后续条目标记为“已并入”），
   * 不重排日志数组，因此本次调用开销为 O(本次新增日志数)；
   * “已并入”日志的过滤与重新编号（`step` 字段）统一在 {@link build} 时完成。
   *
   * 其他规则的日志不受影响，且相对顺序保持不变。
   */
  mergeStepsBySubject(
    rule: ReasoningRule,
    buildDetail: (first: ReasoningStep, decisions: CellDecision[]) => string,
    fromIndex = 0,
  ): void {
    if (this.steps.length === 0) return;
    const subjectKey = (s: ReasoningStep): string | null => {
      if (s.scope !== undefined) return `scope:${s.scope.kind}:${s.scope.index}`;
      if (s.sourceCell !== undefined)
        return `cell:${s.sourceCell.x}:${s.sourceCell.y}`;
      return null;
    };

    const from = Math.min(Math.max(0, fromIndex), this.steps.length);
    // 按“推理主体”对本次范围内的日志分组。
    const groups = new Map<string, number[]>();
    for (let i = from; i < this.steps.length; i++) {
      const s = this.steps[i];
      if (s.rule !== rule) continue;
      const key = subjectKey(s);
      if (key === null) continue;
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [i]);
      else list.push(i);
    }

    for (const indices of groups.values()) {
      if (indices.length === 1) continue; // 主体仅出现一次：保留原有说明文本
      const first = this.steps[indices[0]];
      const merged: CellDecision[] = [];
      for (const i of indices) {
        for (const d of this.steps[i].decisions) {
          if (
            !merged.some(
              (e) =>
                e.cell.x === d.cell.x &&
                e.cell.y === d.cell.y &&
                e.decision === d.decision,
            )
          ) {
            merged.push(d);
          }
        }
      }
      // 就地更新最早一条日志：decisions 并集 + 重新生成的说明文本。
      first.decisions = merged;
      first.detail = buildDetail(first, merged);
      // 后续日志标记为“已并入”，build() 时过滤。
      for (let j = 1; j < indices.length; j++) {
        this.mergedOut.add(this.steps[indices[j]]);
      }
    }
  }

  /**
   * 产出累积的推理链。
   *
   * 返回新数组：过滤掉“已并入”其他日志的条目，并按出现顺序重新编号
   * （`step` 为 0..n-1）。被合并掉的日志不会出现在结果中。
   */
  build(): ReasoningChain {
    const out: ReasoningStep[] = [];
    for (const s of this.steps) {
      if (this.mergedOut.has(s)) continue;
      out.push({ ...s, step: out.length });
    }
    return out;
  }
}

/* -------------------------------------------------------------------------- */
/* 5. 求解结果与求解器选项                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 一次完整求解（规则推导 + 回溯）的结果。
 *
 * - `solved`  ：是否至少找到 1 个解；
 * - `solutions`：所有找到的解（默认最多返回 `maxSolutions` 个）；
 * - `reasoningChain`：规则引擎阶段产生的逻辑链；
 * - `usedBacktrack`：是否启用了回溯搜索；
 * - `nodesVisited`：回溯搜索访问的节点数（用于复杂度观测）。
 */
export interface SolutionResult {
  solved: boolean;
  /** 找到的解（每个解是一个完整的 N×N 状态矩阵，`states[y][x]`）。 */
  solutions: number[][][];
  /** 规则引擎阶段产生的结构化逻辑链。 */
  reasoningChain: ReasoningChain;
  /** 是否用到了回溯搜索。 */
  usedBacktrack: boolean;
  /** 回溯搜索访问的节点总数。 */
  nodesVisited: number;
  /**
   * 回溯阶段导致最终解的那条“猜测”决策链（规则引擎无法推导、必须猜测的步骤）。
   * 仅在 `usedBacktrack` 为 `true` 且 `solved` 为 `true` 时通常非空。
   */
  backtrackPath?: ReasoningStep[];
  /** 求解耗时（毫秒）。 */
  elapsedMs: number;
  /** 额外统计信息。 */
  stats: {
    /** 规则引擎迭代轮数。 */
    ruleRounds: number;
    /** 规则引擎累计改动的格子数。 */
    ruleMarkings: number;
  };
}

/** 求解器可选参数。 */
export interface SolverOptions {
  /** 最多返回多少个解（默认 1；传 `Infinity` 表示枚举全部解）。 */
  maxSolutions?: number;
  /**
   * 单区域（行 / 列 / 颜色）局部全排列枚举时，允许的未定格子（UNKNOWN）数量上限（默认 8）。
   * 超过该上限将跳过该区域的枚举（避免组合爆炸），交由回溯完成。
   */
  maxLocalPermutationCells?: number;
  /**
   * 回溯搜索的节点数上限（默认 2_000_000）。
   * 超过后停止搜索并返回“未找到更多解”。
   */
  maxBacktrackNodes?: number;
}

/** {@link SolverOptions} 的默认值。 */
export const DEFAULT_SOLVER_OPTIONS: Required<SolverOptions> = {
  maxSolutions: 1,
  maxLocalPermutationCells: 8,
  maxBacktrackNodes: 2_000_000,
};

/** 将部分 options 与默认值合并。 */
export function mergeOptions(
  options: SolverOptions = {},
): Required<SolverOptions> {
  return { ...DEFAULT_SOLVER_OPTIONS, ...options };
}

