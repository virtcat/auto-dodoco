/**
 * @module index
 *
 * “嘟嘟可”矩阵颜色谜题求解器 —— 纯 TypeScript 核心算法模块的公共导出。
 *
 * 该模块不包含任何 UI / DOM 代码，可被 Web / Node 环境直接引用。
 */

// 数据模型与公共类型
export {
  CellState,
  DEFAULT_SOLVER_OPTIONS,
  ReasoningChainBuilder,
  isDecided,
  mergeOptions,
  scopeToString,
  validateConfig,
  coord,
  fmtCell,
  sameCoord,
  coordKey,
} from "./types.js";
export type {
  CellDecision,
  Coord,
  PuzzleConfig,
  ReasoningChain,
  ReasoningRule,
  ReasoningStep,
  RegionScope,
  SolutionResult,
  SolverOptions,
} from "./types.js";

// 网格
export { Grid } from "./grid.js";
export type { RegionCount, RegionKind } from "./grid.js";

// 规则引擎
export { RuleEngine } from "./rules.js";
export type { ApplyRulesResult } from "./rules.js";

// 求解器
export { Solver } from "./solver.js";