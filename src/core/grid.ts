/**
 * @module grid
 *
 * {@link Grid}：N×N 网格的运行时状态容器。
 *
 * 内部采用两张二维数组（颜色 / 状态）分别存储，以获得更好的缓存局部性；
 * 对外提供区域（行 / 列 / 颜色）的提取、计数、合法性校验（`checkValid`）等基础能力。
 *
 * 本模块不依赖任何 UI / DOM 代码。
 */

import {
  CellState,
  Coord,
  PuzzleConfig,
  RegionScope,
  validateConfig,
} from "./types.js";

/** 区域类型：行 / 列 / 颜色。 */
export type RegionKind = "row" | "col" | "color";

/** 一个区域内各状态的计数结果。 */
export interface RegionCount {
  /** 嘟嘟可数量 */
  dodoco: number;
  /** 空白格数量 */
  empty: number;
  /** 未定格数量 */
  unknown: number;
  /** 区域总格数 */
  total: number;
}

/**
 * 一个谜题的运行时网格。
 *
 * - 颜色矩阵在构造后不可变；
 * - 状态矩阵可被规则引擎 / 回溯器就地修改（`setState`）；
 * - 通过 {@link Grid.clone} 可以复制出一个完全独立的副本，供回溯做“试错 + 撤销”。
 */
export class Grid {
  /** 网格边长 N。 */
  readonly n: number;
  /** 模式参数 K（1 或 2）。 */
  readonly k: number;

  /** 颜色矩阵，`colors[y][x]`。构造后不可变。 */
  private readonly colors: number[][];
  /** 状态矩阵，`states[y][x]`。可被就地修改。 */
  private states: number[][];

  /** 所有出现过的颜色编号（升序），构造时缓存一次。 */
  private readonly colorList: number[];

  constructor(config: PuzzleConfig) {
    validateConfig(config);
    this.n = config.n;
    this.k = config.k;

    // 深拷贝颜色矩阵，避免外部引用被后续修改影响。
    this.colors = config.colors.map((row) => row.slice());

    // 初始盘面完全空白：全部为 UNKNOWN。
    this.states = Array.from({ length: this.n }, () =>
      new Array<number>(this.n).fill(CellState.UNKNOWN),
    );

    // 缓存颜色列表（升序、去重）。
    const set = new Set<number>();
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) set.add(this.colors[y][x]);
    }
    this.colorList = Array.from(set).sort((a, b) => a - b);
  }

  /* ------------------------------------------------------------------ */
  /* 基础访问                                                            */
  /* ------------------------------------------------------------------ */

  /** 获取指定格子颜色。 */
  colorAt(x: number, y: number): number {
    this.assertInBounds(x, y);
    return this.colors[y][x];
  }

  /** 获取指定格子当前状态。 */
  stateAt(x: number, y: number): CellState {
    this.assertInBounds(x, y);
    return this.states[y][x] as CellState;
  }

  /**
   * 就地设置指定格子的状态。
   * @throws {Error} 当目标状态为 UNKNOWN（即“撤销为未知”）时抛出，
   *                 规则引擎不应把格子改回 UNKNOWN；如需撤销请使用 clone/回溯。
   */
  setState(x: number, y: number, state: CellState): void {
    this.assertInBounds(x, y);
    if (state === CellState.UNKNOWN) {
      throw new Error(
        `Grid.setState(${x},${y}) 不允许设置为 UNKNOWN（撤销请使用 Grid.clone）。`,
      );
    }
    this.states[y][x] = state;
  }

  /** 所有出现过的颜色编号（升序）。 */
  get colorsList(): readonly number[] {
    return this.colorList;
  }

  /* ------------------------------------------------------------------ */
  /* 复制 / 导出                                                         */
  /* ------------------------------------------------------------------ */

  /** 深拷贝当前网格（颜色 + 状态），用于回溯试错。 */
  clone(): Grid {
    const n = this.n;
    const copy = new Grid({
      n,
      k: this.k,
      colors: this.colors.map((row) => row.slice()),
    });
    copy.states = this.states.map((row) => row.slice());
    return copy;
  }

  /** 导出完整的状态矩阵（`states[y][x]`），深拷贝，供外部安全持有。 */
  snapshot(): number[][] {
    return this.states.map((row) => row.slice());
  }

  /**
   * 从一份“状态快照”（`states[y][x]`）重建网格。
   * 便于把求解器返回的解重新载入 {@link Grid} 以做 {@link Grid.checkValid} 校验。
   */
  static fromSnapshot(config: PuzzleConfig, states: number[][]): Grid {
    const g = new Grid(config);
    if (states.length !== g.n) throw new Error("状态矩阵行数与 N 不一致。");
    for (let y = 0; y < g.n; y++) {
      if (states[y].length !== g.n)
        throw new Error(`状态矩阵第 ${y} 行长度与 N 不一致。`);
      for (let x = 0; x < g.n; x++) {
        const s = states[y][x];
        if (s !== CellState.DODOCO && s !== CellState.EMPTY) {
          throw new Error(`状态矩阵 [${y}][${x}] 的值 ${s} 非法。`);
        }
        g.states[y][x] = s;
      }
    }
    return g;
  }

  /* ------------------------------------------------------------------ */
  /* 邻域                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 返回某格子的八邻域（仅落在网格内的坐标）。
   * 顺序固定：上 / 下 / 左 / 右 / 左上 / 右上 / 左下 / 右下。
   */
  neighbors(x: number, y: number): Coord[] {
    const result: Coord[] = [];
    const n = this.n;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < n && ny >= 0 && ny < n) {
          result.push({ x: nx, y: ny });
        }
      }
    }
    return result;
  }

  /** 判断两格是否八邻域相邻（含对角线）。 */
  static isAdjacent(a: Coord, b: Coord): boolean {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
  }

  /* ------------------------------------------------------------------ */
  /* 区域提取与计数                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * 返回某区域（行 / 列 / 颜色）内的所有坐标。
   * @param kind   区域类型
   * @param index  区域索引（行号 / 列号 / 颜色编号）
   */
  regionCells(kind: RegionKind, index: number): Coord[] {
    const n = this.n;
    const result: Coord[] = [];
    if (kind === "row") {
      for (let x = 0; x < n; x++) result.push({ x, y: index });
    } else if (kind === "col") {
      for (let y = 0; y < n; y++) result.push({ x: index, y });
    } else {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (this.colors[y][x] === index) result.push({ x, y });
        }
      }
    }
    return result;
  }

  /** 对某区域做状态计数。 */
  regionCount(kind: RegionKind, index: number): RegionCount {
    let dodoco = 0;
    let empty = 0;
    let unknown = 0;
    let total = 0;
    for (const c of this.regionCells(kind, index)) {
      total++;
      const s = this.stateAt(c.x, c.y);
      if (s === CellState.DODOCO) dodoco++;
      else if (s === CellState.EMPTY) empty++;
      else unknown++;
    }
    return { dodoco, empty, unknown, total };
  }

  /** 将 {@link RegionScope} 转成 (kind, index)。 */
  private scopeToKindIndex(scope: RegionScope): {
    kind: RegionKind;
    index: number;
  } {
    if (scope.kind === "row") return { kind: "row", index: scope.index };
    if (scope.kind === "col") return { kind: "col", index: scope.index };
    return { kind: "color", index: scope.index };
  }

  /** 便捷方法：按 {@link RegionScope} 做区域计数。 */
  countByScope(scope: RegionScope): RegionCount {
    const { kind, index } = this.scopeToKindIndex(scope);
    return this.regionCount(kind, index);
  }

  /* ------------------------------------------------------------------ */
  /* 完成度与合法性                                                      */
  /* ------------------------------------------------------------------ */

  /** 是否所有格子都已确定（无 UNKNOWN）。 */
  isComplete(): boolean {
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) {
        if (this.states[y][x] === CellState.UNKNOWN) return false;
      }
    }
    return true;
  }

  /**
   * 检查当前盘面是否“可继续”（尚未矛盾）。
   *
   * 判据（对每一行 / 每一列 / 每种颜色）：
   *  1. 嘟嘟可数量 <= K；
   *  2. 嘟嘟可数量 + 未定格数量 >= K（否则凑不齐 K 个嘟嘟可）。
   *
   * 额外判据：
   *  3. 不存在两个八邻域相邻的嘟嘟可（拓扑互斥）。
   *
   * @returns `true` 表示当前盘面没有矛盾、可以继续推理。
   */
  isConsistent(): boolean {
    // 判据 1 & 2：区域计数。
    for (let i = 0; i < this.n; i++) {
      for (const kind of ["row", "col"] as const) {
        const c = this.regionCount(kind, i);
        if (c.dodoco > this.k) return false;
        if (c.dodoco + c.unknown < this.k) return false;
      }
    }
    for (const color of this.colorList) {
      const c = this.regionCount("color", color);
      if (c.dodoco > this.k) return false;
      if (c.dodoco + c.unknown < this.k) return false;
    }

    // 判据 3：拓扑互斥——任意两个嘟嘟可不能八邻域相邻。
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) {
        if (this.states[y][x] !== CellState.DODOCO) continue;
        for (const nb of this.neighbors(x, y)) {
          if (this.states[nb.y][nb.x] === CellState.DODOCO) return false;
        }
      }
    }
    return true;
  }

  /**
   * 静态校验函数 `checkValid`：验证一个“完整”的盘面是否满足所有硬性约束：
   *  - 每行 / 每列 / 每颜色的嘟嘟可数量恰好为 K；
   *  - 任意两个嘟嘟可八邻域不相邻。
   *
   * @param grid 待校验的网格（应已完成，即无 UNKNOWN）。
   * @returns `true` 表示该盘面是一个合法的完整解。
   */
  static checkValid(grid: Grid): boolean {
    if (!grid.isComplete()) return false;
    if (!grid.isConsistent()) return false;

    // 完整时，"可继续" 已保证 dodoco<=K 且 dodoco+unknown>=K；
    // 由于 unknown==0，进一步要求 dodoco==K。
    for (let i = 0; i < grid.n; i++) {
      if (grid.regionCount("row", i).dodoco !== grid.k) return false;
      if (grid.regionCount("col", i).dodoco !== grid.k) return false;
    }
    for (const color of grid.colorsList) {
      if (grid.regionCount("color", color).dodoco !== grid.k) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 展示辅助                                                            */
  /* ------------------------------------------------------------------ */

  /** 生成一个人类可读的盘面字符串（便于控制台 / 演示展示）。 */
  toAscii(legend?: (color: number) => string): string {
    const n = this.n;
    const render = (color: number, state: CellState): string => {
      if (state === CellState.DODOCO) return "X"; // 嘟嘟可
      if (state === CellState.EMPTY) return "."; // 空白
      // UNKNOWN：用颜色图例（默认字母）表示
      if (legend) return legend(color);
      return String.fromCharCode(65 + (color % 26)).toLowerCase();
    };
    const lines: string[] = [];
    for (let y = 0; y < n; y++) {
      const cells: string[] = [];
      for (let x = 0; x < n; x++) {
        cells.push(
          render(this.colors[y][x], this.states[y][x] as CellState).padEnd(2),
        );
      }
      lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines.join("\n");
  }

  /* ------------------------------------------------------------------ */

  private assertInBounds(x: number, y: number): void {
    if (x < 0 || x >= this.n || y < 0 || y >= this.n) {
      throw new Error(`坐标 (${x},${y}) 越界，网格边长 N=${this.n}。`);
    }
  }
}