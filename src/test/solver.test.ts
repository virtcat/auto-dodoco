/**
 * 核心算法模块的自校验测试
 *
 * 覆盖：
 *  - K=1（N=4）可解性 + 解的合法性；
 *  - K=2（N=10）可解性 + 解的合法性；
 *  - K=2（N=4）必然无解（拓扑上放不下 8 个互不相邻的嘟嘟可）；
 *  - 规则引擎逻辑链非空、且只包含合法状态；
 *  - Grid.checkValid 的正/反例；
 *  - 多解枚举（maxSolutions）。
 */

import { CellState, Grid, RuleEngine, ReasoningChainBuilder, Solver } from "../core/index.js";
import type { PuzzleConfig } from "../core/index.js";
import { ensureUtf8Console } from "../util/ensure-utf8.js";

// Windows 控制台默认可能是 GBK(CP936)，这里切换为 UTF-8 以便正确显示“嘟嘟可”等中文。
ensureUtf8Console();

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): asserts cond {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 ${msg}`);
  }
}

/** 校验求解器返回的每个解都合法。 */
function assertSolutionsValid(config: PuzzleConfig, solutions: number[][][]): void {
  for (const sol of solutions) {
    const g = Grid.fromSnapshot(config, sol);
    assert(Grid.checkValid(g), "解通过 Grid.checkValid 校验");
  }
}

/* -------------------------------------------------------------------------- */
/* 测试 1：K=1, N=4（四象限着色）                                              */
/* -------------------------------------------------------------------------- */
{
  console.log("\n[测试 1] K=1, N=4（四象限着色，可解）");
  const n = 4;
  const k = 1;
  const colors: number[][] = [];
  for (let y = 0; y < n; y++) {
    const row: number[] = [];
    for (let x = 0; x < n; x++) {
      // 左上=0, 右上=1, 左下=2, 右下=3
      row.push((y < 2 ? 0 : 2) + (x < 2 ? 0 : 1));
    }
    colors.push(row);
  }
  const config: PuzzleConfig = { n, k, colors };
  const solver = new Solver(config);
  const result = solver.solve();

  assert(result.solved, "求解器报告有解");
  // 空棋盘 + 所有区域 > K 时，纯逻辑无法先手推进 → 需回溯，此时逻辑链可为空；
  // 若未回溯（纯逻辑解出），则逻辑链必须非空。
  assert(
    !result.usedBacktrack ? result.reasoningChain.length > 0 : true,
    "若纯逻辑解出则逻辑链非空（否则允许为空并依赖回溯）",
  );
  assert(result.solutions.length >= 1, "至少返回 1 个解");
  if (result.solved) assertSolutionsValid(config, result.solutions);

  // 推理链中所有决策都应是 DODOCO / EMPTY。
  const legal = result.reasoningChain.every(
    (s) =>
      s.decisions.length > 0 &&
      s.decisions.every(
        (d) => d.decision === CellState.DODOCO || d.decision === CellState.EMPTY,
      ),
  );
  assert(legal, "推理链中所有决策均为 DODOCO / EMPTY");
}

/* -------------------------------------------------------------------------- */
/* 测试 2：K=2, N=10（可解）                                                  */
/* -------------------------------------------------------------------------- */
{
  console.log("\n[测试 2] K=2, N=10（可解，需回溯 + 强剪枝）");
  const n = 10;
  const k = 2;
  // 以“行”为颜色：恰好 10 种颜色、每种 10 格，每行/每色恰好 2 个嘟嘟可。
  const colors: number[][] = [];
  for (let y = 0; y < n; y++) {
    colors.push(new Array<number>(n).fill(y));
  }
  const config: PuzzleConfig = { n, k, colors };
  const solver = new Solver(config, { maxBacktrackNodes: 5_000_000 });
  const result = solver.solve();

  assert(result.solved, "求解器报告有解");
  assert(result.usedBacktrack, "该题需要回溯搜索");
  if (result.solved) assertSolutionsValid(config, result.solutions);
  console.log(
    `    (回溯节点数 = ${result.nodesVisited}, 耗时 = ${result.elapsedMs}ms)`,
  );
}

/* -------------------------------------------------------------------------- */
/* 测试 3：K=2, N=4（必然无解）                                               */
/* -------------------------------------------------------------------------- */
{
  console.log("\n[测试 3] K=2, N=4（拓扑上无法容纳 8 个互不相邻的嘟嘟可 → 无解）");
  const n = 4;
  const k = 2;
  const colors: number[][] = [];
  for (let y = 0; y < n; y++) colors.push(new Array<number>(n).fill(y));
  const config: PuzzleConfig = { n, k, colors };
  const solver = new Solver(config, { maxBacktrackNodes: 1_000_000 });
  const result = solver.solve();
  assert(!result.solved, "求解器正确报告无解");
}

/* -------------------------------------------------------------------------- */
/* 测试 4：Grid.checkValid 正/反例                                            */
/* -------------------------------------------------------------------------- */
{
  console.log("\n[测试 4] Grid.checkValid 正/反例");
  // 一个手写的合法解：N=4, K=1, 嘟嘟可位于 (0,1),(1,3),(2,0),(3,2)（互不相邻）。
  const n = 4;
  const k = 1;
  const colors: number[][] = [];
  for (let y = 0; y < n; y++) {
    const row: number[] = [];
    for (let x = 0; x < n; x++) row.push((y < 2 ? 0 : 2) + (x < 2 ? 0 : 1));
    colors.push(row);
  }
  const states = Array.from({ length: n }, () =>
    new Array<number>(n).fill(CellState.EMPTY),
  );
  const dodo = [
    { x: 1, y: 0 },
    { x: 3, y: 1 },
    { x: 0, y: 2 },
    { x: 2, y: 3 },
  ];
  for (const c of dodo) states[c.y][c.x] = CellState.DODOCO;

  const valid = Grid.fromSnapshot({ n, k, colors }, states);
  assert(Grid.checkValid(valid), "合法解通过 checkValid");

  // 制造一个非法解：把 (0,0) 也设为嘟嘟可（与 (0,1) 同行相邻）。
  const badStates = states.map((row) => row.slice());
  badStates[0][0] = CellState.DODOCO;
  const bad = Grid.fromSnapshot({ n, k, colors }, badStates);
  assert(!Grid.checkValid(bad), "非法解（相邻嘟嘟可）被 checkValid 拒绝");
}

/* -------------------------------------------------------------------------- */
/* 测试 5：多解枚举                                                            */
/* -------------------------------------------------------------------------- */
{
  console.log("\n[测试 5] 多解枚举（maxSolutions > 1）");
  const n = 4;
  const k = 1;
  const colors: number[][] = [];
  for (let y = 0; y < n; y++) colors.push(new Array<number>(n).fill(y));
  const config: PuzzleConfig = { n, k, colors };
  const solver = new Solver(config, {
    maxSolutions: Infinity,
    maxBacktrackNodes: 2_000_000,
  });
  const result = solver.solve();
  assert(result.solved, "可解");
  if (result.solved) {
    assert(result.solutions.length >= 1, `找到 ${result.solutions.length} 个解`);
    assertSolutionsValid(config, result.solutions);
  }
}

/* -------------------------------------------------------------------------- */
/* 测试 6：单色局部全排列枚举（K=2 直线 3 格 → 两端嘟嘟可、中间空白）         */
/* -------------------------------------------------------------------------- */
{
  console.log("\n[测试 6] 规则引擎：单色局部全排列枚举（K=2 直线 3 格特例）");
  // 构造：颜色 0 = 第 0 行的前 3 格 (0,0)(1,0)(2,0)（一条直线 3 格）；
  // 其余格子为颜色 1。K=2 时，3 格直线中两端必为嘟嘟可、中间必为 EMPTY。
  const n = 4;
  const k = 2;
  const colors: number[][] = [];
  for (let y = 0; y < n; y++) {
    const row: number[] = [];
    for (let x = 0; x < n; x++) {
      row.push(y === 0 && x <= 2 ? 0 : 1);
    }
    colors.push(row);
  }

  const grid = new Grid({ n, k, colors });
  const engine = new RuleEngine(k, { maxLocalPermutationCells: 8 });
  const chain = new ReasoningChainBuilder();
  engine.applyAll(grid, chain);

  assert(
    grid.stateAt(0, 0) === CellState.DODOCO,
    "直线 3 格的左端 (0,0) 被推导为嘟嘟可",
  );
  assert(
    grid.stateAt(2, 0) === CellState.DODOCO,
    "直线 3 格的右端 (2,0) 被推导为嘟嘟可",
  );
  assert(
    grid.stateAt(1, 0) === CellState.EMPTY,
    "直线 3 格的中间 (1,0) 被推导为 EMPTY",
  );
  assert(chain.length > 0, "规则引擎产生了非空推理链");
  const hasLocalPerm = chain.build().some(
    (s) => s.rule === "LOCAL_PERMUTATION",
  );
  assert(hasLocalPerm, "推理链中包含 LOCAL_PERMUTATION 类型的日志");

  // 一次“局部全排列枚举”（颜色 0）合并为一条日志，且覆盖多格。
  const localSteps = chain.build().filter((s) => s.rule === "LOCAL_PERMUTATION");
  const c0Steps = localSteps.filter(
    (s) => s.scope !== undefined && s.scope.kind === "color" && s.scope.index === 0,
  );
  assert(
    c0Steps.length === 1,
    "颜色 0 的局部全排列枚举只产生一条日志（一次枚举 = 一步）",
  );
  assert(
    (c0Steps[0]?.decisions.length ?? 0) >= 3,
    "该条日志覆盖 ≥3 格（直线 3 格的两端嘟嘟可 + 中间 EMPTY）",
  );
}

/* -------------------------------------------------------------------------- */
/* 测试 7：行/列的局部全排列枚举同样遵循“一个区域 = 一步”（多轮合并）         */
/* -------------------------------------------------------------------------- */
{
  console.log("\n[测试 7] 规则引擎：行的多轮局部全排列枚举合并为一步");
  // 该盘面会让第 1 行、第 3 行各被多轮重枚举（每行会产生多条 LOCAL_PERMUTATION 日志）：
  //   第 1 行：(1,0) EMPTY + (2,0) EMPTY；第 3 行：(1,4) EMPTY + (1,3) 嘟嘟可。
  const n = 6;
  const k = 1;
  const colors = [
    [1, 0, 2, 1, 0, 0],
    [0, 2, 2, 1, 0, 0],
    [1, 1, 2, 1, 1, 1],
    [0, 2, 2, 0, 1, 0],
    [0, 2, 2, 0, 2, 2],
    [2, 2, 0, 1, 1, 1],
  ];
  const grid = new Grid({ n, k, colors });
  grid.setState(4, 2, CellState.DODOCO);
  const engine = new RuleEngine(k, { maxLocalPermutationCells: 8 });
  const chain = new ReasoningChainBuilder();
  engine.applyAll(grid, chain);
  const steps = chain.build();

  const rowSteps = (idx: number) =>
    steps.filter(
      (s) =>
        s.rule === "LOCAL_PERMUTATION" &&
        s.scope !== undefined &&
        s.scope.kind === "row" &&
        s.scope.index === idx,
    );

  assert(rowSteps(1).length === 1, "第 1 行的局部全排列枚举只产生一步（多轮已合并）");
  assert(rowSteps(1)[0].decisions.length === 2, "该步覆盖 2 格（(1,0)、(2,0) 均 EMPTY）");
  assert(rowSteps(3).length === 1, "第 3 行的局部全排列枚举只产生一步（多轮已合并）");
  assert(rowSteps(3)[0].decisions.length === 2, "该步覆盖 2 格（1 格嘟嘟可 + 1 格 EMPTY）");
  assert(steps.every((s, i) => s.step === i), "合并后推理链步序号连续（0..n-1）");
  assert(grid.stateAt(1, 0) === CellState.EMPTY, "盘面 (1,0) EMPTY 不受合并影响");
  assert(grid.stateAt(2, 0) === CellState.EMPTY, "盘面 (2,0) EMPTY 不受合并影响");
  assert(grid.stateAt(1, 3) === CellState.DODOCO, "盘面 (1,3) 嘟嘟可不受合并影响");
  assert(grid.stateAt(1, 4) === CellState.EMPTY, "盘面 (1,4) EMPTY 不受合并影响");
}

/* -------------------------------------------------------------------------- */
/* 测试 8：基础计数 / 邻域互斥“一次推理确定多格”同样记为一步                    */
/* -------------------------------------------------------------------------- */
{
  console.log("\n[测试 8] 规则引擎：基础计数 / 邻域互斥的多格推理也合并为一步");
  // 复用测试 7 的确定性盘面：
  //   - 第 2 行、第 4 列容量已满，各一次推理确定 5 格 EMPTY；
  //   - 嘟嘟可 (4,2) 的八邻域互斥一次推理确定 3 格 EMPTY。
  const n = 6;
  const k = 1;
  const colors = [
    [1, 0, 2, 1, 0, 0],
    [0, 2, 2, 1, 0, 0],
    [1, 1, 2, 1, 1, 1],
    [0, 2, 2, 0, 1, 0],
    [0, 2, 2, 0, 2, 2],
    [2, 2, 0, 1, 1, 1],
  ];
  const grid = new Grid({ n, k, colors });
  grid.setState(4, 2, CellState.DODOCO);
  const engine = new RuleEngine(k, { maxLocalPermutationCells: 8 });
  const chain = new ReasoningChainBuilder();
  engine.applyAll(grid, chain);
  const steps = chain.build();

  const regionSteps = (rule: string, kind: string, idx: number) =>
    steps.filter(
      (s) =>
        s.rule === rule &&
        s.scope !== undefined &&
        s.scope.kind === kind &&
        s.scope.index === idx,
    );

  // 基础计数：同一区域“容量已满”一次推理确定的多格 = 一步。
  const row2 = regionSteps("COUNT_CAPACITY_FULL", "row", 2);
  assert(row2.length === 1, "第 2 行容量已满标记的 5 格 EMPTY 只记为一步");
  assert(row2[0].decisions.length === 5, "该步恰好覆盖 5 格");
  assert(
    row2[0].decisions.every((d) => d.decision === CellState.EMPTY),
    "该步的决策全部为 EMPTY",
  );

  const col4 = regionSteps("COUNT_CAPACITY_FULL", "col", 4);
  assert(col4.length === 1, "第 4 列容量已满标记的 5 格 EMPTY 只记为一步");
  assert(col4[0].decisions.length === 5, "该步恰好覆盖 5 格");

  // 邻域互斥：同一只嘟嘟可触发的全部邻域排除 = 一步。
  const neighborSteps = steps.filter((s) => s.rule === "NEIGHBOR_EXCLUSION");
  assert(
    neighborSteps.length === 1,
    "本盘面（仅嘟嘟可 (4,2)）的邻域互斥只记为一步",
  );
  assert(
    neighborSteps[0].sourceCell !== undefined &&
      neighborSteps[0].sourceCell.x === 4 &&
      neighborSteps[0].sourceCell.y === 2,
    "该步记录触发它的嘟嘟可 (4,2)",
  );
  assert(
    neighborSteps[0].decisions.length === 3,
    "该步恰好覆盖 3 个邻域格（(5,1)、(3,3)、(5,3)）",
  );

  assert(steps.every((s, i) => s.step === i), "合并后推理链步序号连续（0..n-1）");
  assert(grid.stateAt(0, 2) === CellState.EMPTY, "盘面 (0,2) EMPTY 不受合并影响");
  assert(grid.stateAt(5, 1) === CellState.EMPTY, "盘面 (5,1) EMPTY 不受合并影响");
}

/* -------------------------------------------------------------------------- */
/* 汇总                                                                        */
/* -------------------------------------------------------------------------- */
console.log(`\n${"=".repeat(48)}`);
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
if (failed > 0) {
  console.error("存在失败的断言！");
  process.exitCode = 1;
} else {
  console.log("全部通过 ✅");
}