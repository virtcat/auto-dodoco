/**
 * 演示脚本：求解一个 K=1 的四象限谜题，并打印推理链与最终盘面。
 *
 * 运行：`npm run demo`
 */

import {
  CellState,
  Grid,
  ReasoningChainBuilder,
  RuleEngine,
  Solver,
  fmtCell,
} from "../core/index.js";
import type { PuzzleConfig, ReasoningStep } from "../core/index.js";
import { ensureUtf8Console } from "../util/ensure-utf8.js";

// Windows 控制台默认可能是 GBK(CP936)，这里切换为 UTF-8 以便正确显示“嘟嘟可”等中文。
ensureUtf8Console();

/** 打印一个盘面（用颜色字母 + 嘟嘟可/空白标记）。 */
function printBoard(grid: Grid, title: string): void {
  console.log(`\n=== ${title} ===`);
  // 列坐标标尺
  console.log("    " + grid.colorsList.join("   "));
  console.log(grid.toAscii());
  console.log(
    "    X = 嘟嘟可   . = 空白   A/B/C/... = 未定（颜色）",
  );
}

/** 把一条推理日志格式化为可读文本（显式列出本步确定的全部格子）。 */
function formatStep(step: ReasoningStep): string {
  const scope = step.scope ? ` [${scopeName(step.scope)}]` : "";
  const cells = step.decisions
    .map(
      (d) =>
        `${fmtCell(d.cell.x, d.cell.y)}→${d.decision === CellState.DODOCO ? "嘟嘟可" : "EMPTY"}`,
    )
    .join("  ");
  return `#${String(step.step).padStart(2, " ")} (${step.rule})${scope}\n     ${cells}\n     → ${step.detail}`;
}

function scopeName(scope: { kind: string; index: number }): string {
  // 行/列/颜色编号与棋盘、画笔展示一致：1-based（索引 0 → 第 1 行/列、颜色 #1）。
  if (scope.kind === "row") return `第 ${scope.index + 1} 行`;
  if (scope.kind === "col") return `第 ${scope.index + 1} 列`;
  return `颜色 #${scope.index + 1}`;
}

/**
 * 规则引擎单独演示：用一个 K=2 的“直线 3 格”颜色区域展示
 * 单色局部全排列枚举如何产出一条非空的逻辑链（无需回溯即可推进）。
 */
function showRuleEngineDemo(): void {
  console.log(`\n${"=".repeat(48)}`);
  console.log(`规则引擎单独演示  (K=2, 直线 3 格 → 两端嘟嘟可 / 中间空白)`);
  const n = 4;
  const k = 2;
  const colors: number[][] = [];
  for (let y = 0; y < n; y++) {
    const row: number[] = [];
    for (let x = 0; x < n; x++) {
      row.push(y === 0 && x <= 2 ? 0 : 1); // 颜色 0 = 第 0 行前 3 格
    }
    colors.push(row);
  }
  const grid = new Grid({ n, k, colors });
  const engine = new RuleEngine(k, { maxLocalPermutationCells: 8 });
  const chain = new ReasoningChainBuilder();
  const result = engine.applyAll(grid, chain);

  printBoard(grid, "规则引擎推导后的盘面（局部全排列 + 计数 + 邻域联动）");
  console.log(
    `    consistent=${result.consistent}, rounds=${result.rounds}, markings=${result.markings}`,
  );
  if (!result.consistent) {
    console.log(
      "    注：此为例示性构造——直线 3 格的局部推导完全正确；consistent=false 是该人工盘面其余部分并非完整可解所致。",
    );
  }
  console.log(`\n=== 逻辑链（共 ${chain.length} 步）===`);
  for (const step of chain.build()) {
    console.log(formatStep(step));
  }
}

function main(): void {
  // ---- 构造谜题：N=4, K=1, 四象限着色 ----
  const n = 4;
  const k = 1;
  const colors: number[][] = [];
  for (let y = 0; y < n; y++) {
    const row: number[] = [];
    for (let x = 0; x < n; x++) {
      row.push((y < 2 ? 0 : 2) + (x < 2 ? 0 : 1)); // 0=左上 1=右上 2=左下 3=右下
    }
    colors.push(row);
  }
  const config: PuzzleConfig = { n, k, colors };

  console.log(`\n嘟嘟可谜题求解演示  (N=${n}, K=${k})`);
  const initGrid = new Grid(config);
  printBoard(initGrid, "初始盘面（全部未定）");

  // ---- 求解 ----
  const solver = new Solver(config, { maxSolutions: 3 });
  const result = solver.solve();

  console.log(
    `\n求解结果：${result.solved ? "✅ 有解" : "❌ 无解"}  ` +
      `(回溯=${result.usedBacktrack}, 节点=${result.nodesVisited}, ` +
      `耗时=${result.elapsedMs}ms, 解数=${result.solutions.length})`,
  );

  // ---- 推理链 ----
  console.log(`\n=== 推理链（共 ${result.reasoningChain.length} 步）===`);
  for (const step of result.reasoningChain) {
    console.log(formatStep(step));
  }

  // ---- 最终解 ----
  if (result.solved) {
    for (let i = 0; i < result.solutions.length; i++) {
      const g = Grid.fromSnapshot(config, result.solutions[i]);
      printBoard(g, `解 #${i + 1}`);
      console.log(`    checkValid = ${Grid.checkValid(g)}`);
    }

    // 回溯路径（若有）
    if (result.backtrackPath && result.backtrackPath.length > 0) {
      console.log(`\n=== 回溯猜测路径（共 ${result.backtrackPath.length} 步）===`);
      for (const step of result.backtrackPath) {
        console.log(`#${step.step} → ${step.detail}`);
      }
    }
  }

  // ---- 规则引擎单独演示（展示非空逻辑链）----
  showRuleEngineDemo();
}

main();