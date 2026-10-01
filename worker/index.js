/**
 * @module worker
 *
 * CloudFlare Worker 入口：
 *  - `POST /api/increment` —— 成功求解后计数 +1，返回最新统计；
 *  - `GET  /api/stats`     —— 只读统计 `{ total, last24h }`；
 *  - 其余请求 → 转发给静态资产绑定 `ASSETS`（即 `vite build` 产物 `dist/`）。
 *
 * 同源部署于站点 `/api/*` 路由（见 `wrangler.jsonc`），无需 CORS。
 * 计数存储见 `./counter.js` 的 Durable Object `SolveCounter`。
 */

import { SolveCounter } from "./counter.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** 客户端真实 IP（CloudFlare 代理头）；取不到返回空串（此时不限流）。 */
function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("cf-connecting-ip") ||
    ""
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- API 路由 ----
    // 只读统计：不受限流
    if (url.pathname === "/api/stats" && request.method === "GET") {
      const counter = env.COUNTER.get(env.COUNTER.idFromName("global"));
      return json(counter.stats());
    }

    // 计数 +1：按 IP 限流防刷
    if (url.pathname === "/api/increment" && request.method === "POST") {
      const counter = env.COUNTER.get(env.COUNTER.idFromName("global"));
      const result = counter.increment(clientIp(request));
      if (result.rateLimited) return json({ error: "rate_limited" }, 429);
      return json(result);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }

    // ---- 其余请求：静态资产（vite build 产物） ----
    return env.ASSETS.fetch(request);
  },
};

export { SolveCounter };