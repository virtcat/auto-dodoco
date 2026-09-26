/**
 * @module solveEngine
 *
 * 求解执行引擎：把 `Solver.solve()` 调度到合适的执行环境中。
 *
 * - Worker 引擎：在独立 worker 线程（`./solver.worker.ts`）中求解，主线程保持响应，
 *   可随时 `terminate()` 线程实现“提前结束求解”；
 * - 主线程引擎：面向没有 `Worker` 的环境（如 jsdom 冒烟测试）的兜底，
 *   直接在主线程求解（小盘面 / 测试场景耗时足够短）。
 *
 * 两种引擎共用同一套消息协议（`SolveTask` / `SolveReply`）与句柄接口（`SolveHandle`），
 * 调用方（`./store`）无需感知当前使用的是哪个引擎。
 */

import {
  Solver,
  type PuzzleConfig,
  type SolutionResult,
  type SolverOptions,
} from "../core/index.js";
// Vite 约定：`?worker&url` 导入得到独立打包的 worker 产物 URL。
// 构建时它被内联为静态字符串，避免在主 bundle 中引入 `import.meta`
// （主 bundle 需要能在 jsdom 冒烟测试中以非模块脚本方式加载）。
import solverWorkerUrl from "./solver.worker.ts?worker&url";

/** 求解任务（主线程 → worker 线程）。 */
export interface SolveTask {
  /** 任务编号（当前始终为 0，预留字段）。 */
  id: number;
  /** 谜题配置（结构化可克隆）。 */
  config: PuzzleConfig;
  /** 求解器选项（如最多寻找解数）。 */
  options: SolverOptions;
}

/** 求解回执（worker 线程 → 主线程）。 */
export type SolveReply =
  | { id: number; ok: true; result: SolutionResult }
  | { id: number; ok: false; error: string };

/** 一次进行中的求解的句柄。 */
export interface SolveHandle {
  /** 取消求解（worker：立即终止线程；主线程兜底：标记取消，丢弃其结果）。 */
  cancel(): void;
}

/** 求解引擎接口：`reply` 恰好被回调一次（成功或失败）。 */
export interface SolveEngine {
  solve(
    config: PuzzleConfig,
    options: SolverOptions,
    reply: (reply: SolveReply) => void,
  ): SolveHandle;
}

function toErrorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 主线程兜底引擎（无 `Worker` 的环境）。 */
const mainThreadEngine: SolveEngine = {
  solve(config, options, reply) {
    let cancelled = false;
    let pending: SolveReply;
    try {
      pending = { id: 0, ok: true, result: new Solver(config, options).solve() };
    } catch (e) {
      pending = { id: 0, ok: false, error: toErrorText(e) };
    }
    // 异步投递结果，保持与 worker 引擎一致的时序，并留出取消窗口
    Promise.resolve().then(() => {
      if (!cancelled) reply(pending);
    });
    return { cancel() { cancelled = true; } };
  },
};

/** Worker 引擎：独立线程求解，可随时终止。 */
const workerEngine: SolveEngine = {
  solve(config, options, reply) {
    let worker: Worker;
    try {
      // solverWorkerUrl 为 Vite 打包出的 worker 产物地址（见文件头部 `?worker&url` 导入）
      worker = new Worker(solverWorkerUrl, { type: "module" });
    } catch (e) {
      reply({ id: 0, ok: false, error: `无法创建求解工作线程：${toErrorText(e)}` });
      return { cancel() {} };
    }
    let settled = false;
    /** 结算：确保只生效一次（回执 / 错误 / 取消三者互斥）。 */
    const cleanup = (): boolean => {
      if (settled) return false;
      settled = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      return true;
    };
    worker.onmessage = (e: MessageEvent<SolveReply>) => {
      if (cleanup()) reply(e.data);
    };
    worker.onerror = (e: ErrorEvent) => {
      if (cleanup()) {
        reply({ id: 0, ok: false, error: e.message || "求解工作线程发生错误" });
      }
    };
    worker.postMessage({ id: 0, config, options } satisfies SolveTask);
    return {
      cancel() {
        cleanup();
      },
    };
  },
};

/** 按环境选择引擎：有 `Worker` 用 worker 线程，否则主线程兜底。 */
export function resolveEngine(): SolveEngine {
  return typeof Worker === "function" ? workerEngine : mainThreadEngine;
}
