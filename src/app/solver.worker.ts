/**
 * @module solver.worker
 *
 * 求解 worker 线程：接收 `SolveTask`（谜题配置），在本线程内同步执行求解，
 * 并以 `SolveReply` 回传结果。主线程可随时 terminate 本线程以提前结束求解。
 *
 * 由 Vite 以独立 worker 入口打包（见 `./solveEngine.ts` 的 `?worker&url` 导入与 `new Worker`）；
 * 本文件不得引用任何 UI / DOM / Vue 代码。
 */

import { Solver } from "../core/index.js";
import type { SolveReply, SolveTask } from "./solveEngine.js";

/** 专用 worker 全局作用域（投影为所需成员，避免引入 webworker lib）。 */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SolveTask>) => void) | null;
  postMessage: (msg: SolveReply) => void;
};

ctx.onmessage = (e: MessageEvent<SolveTask>) => {
  const { id, config, options } = e.data;
  try {
    const result = new Solver(config, options).solve();
    ctx.postMessage({ id, ok: true, result });
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
