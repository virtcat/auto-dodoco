/**
 * @module counter
 *
 * 求解次数统计（前端侧）：
 *  - {@link reportSolve}：成功求解后 fire-and-forget 上报一次（`POST /api/increment`）；
 *  - {@link solveStats}：响应式统计（总数 + 近 24 小时），页面加载时经 {@link loadStats} 拉取。
 *
 * 后端为 CloudFlare Worker + Durable Object（见 `worker/`），同源部署于 `/api/*`。
 * 所有网络调用失败均静默降级，绝不影响求解主流程。
 */
import { reactive } from "vue";

/** 统计接口返回结构。 */
interface Stats {
  total: number;
  last24h: number;
}

/** 页面底部展示的响应式统计（`loaded` 表示已成功取到过服务端数据）。 */
export const solveStats = reactive<{ loaded: boolean } & Stats>({
  loaded: false,
  total: 0,
  last24h: 0,
});

/** 用接口返回的最新值刷新展示。 */
function applyStats(data: Stats | null | undefined): void {
  if (data && typeof data.total === "number" && typeof data.last24h === "number") {
    solveStats.total = data.total;
    solveStats.last24h = data.last24h;
    solveStats.loaded = true;
  }
}

/** 浏览器环境是否可用 `fetch`（jsdom 等测试环境可能没有）。 */
function canFetch(): boolean {
  return typeof fetch === "function";
}

/** 拉取当前统计（失败静默，不影响主流程）。 */
export async function loadStats(): Promise<void> {
  if (!canFetch()) return;
  try {
    const res = await fetch("/api/stats", { headers: { Accept: "application/json" } });
    if (!res.ok) return;
    applyStats((await res.json()) as Stats);
  } catch {
    // 未部署 API / 网络异常时静默
  }
}

/**
 * 成功求解后上报一次计数（fire-and-forget，失败静默）。
 * 若服务端返回了最新统计，则顺带刷新底部展示。
 */
export function reportSolve(): void {
  if (!canFetch()) return;
  fetch("/api/increment", { method: "POST", headers: { "Content-Type": "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => applyStats(data as Stats))
    .catch(() => {
      /* 忽略：计数上报失败不应影响用户体验 */
    });
}