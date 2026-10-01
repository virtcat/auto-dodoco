/**
 * @module worker
 *
 * CloudFlare Worker
 *  - `POST /api/increment` —— 成功求解后计数 +1，返回最新统计；
 *  - `GET  /api/stats`     —— 只读统计 `{ total, last24h }`；
 *  - 其余请求 → 转发给静态资产绑定 `ASSETS`（即 `vite build` 产物 `dist/`）。
 *
 * 同源部署于站点 `/api/*` 路由（见 `wrangler.jsonc`），无需 CORS。
 */

import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const RATE_WINDOW_SEC = 10 * 60; // 限流窗口：10 分钟
const RATE_LIMIT = 60; // 每窗口每 IP 上限

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

// ---- Durable Object：求解次数计数器 ----

export class SolveCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS solves (hour INTEGER PRIMARY KEY, count INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS rate (ip TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (ip, bucket))");
  }

  hour() {
    return Math.floor(Date.now() / 3600_000);
  }

  stats() {
    const sql = this.ctx.storage.sql;
    const now = this.hour();
    const total = sql.exec("SELECT v FROM meta WHERE k = 'total'").one()?.v ?? 0;
    const last24h = sql
      .exec(`SELECT COALESCE(SUM(count), 0) AS s FROM solves WHERE hour >= ${now - 24}`)
      .one().s;
    return { total, last24h };
  }

  /** 转义 SQL 字符串字面量中的单引号。 */
  sq(str) {
    return String(str).replace(/'/g, "''");
  }

  increment(ip) {
    const sql = this.ctx.storage.sql;

    if (ip) {
      const bucket = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC);
      const ipq = this.sq(ip);
      sql.exec(
        `INSERT INTO rate (ip, bucket, count) VALUES ('${ipq}', ${bucket}, 1) ` +
          "ON CONFLICT(ip, bucket) DO UPDATE SET count = count + 1"
      );
      const used = sql
        .exec(`SELECT count FROM rate WHERE ip = '${ipq}' AND bucket = ${bucket}`)
        .one();
      if (used && used.count > RATE_LIMIT) {
        return { rateLimited: true };
      }
    }

    sql.exec(
      "INSERT INTO meta (k, v) VALUES ('total', 1) " +
        "ON CONFLICT(k) DO UPDATE SET v = v + 1"
    );

    sql.exec(
      `INSERT INTO solves (hour, count) VALUES (${this.hour()}, 1) ` +
        "ON CONFLICT(hour) DO UPDATE SET count = count + 1"
    );

    return { ...this.stats(), rateLimited: false };
  }
}

// ---- Worker 入口 ----

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const counter = env.COUNTER.getByName("global");

    if (url.pathname === "/api/stats" && request.method === "GET") {
      const stats = await counter.stats();
      return json(stats);
    }

    if (url.pathname === "/api/increment" && request.method === "POST") {
      const result = await counter.increment(clientIp(request));
      if (result.rateLimited) return json({ error: "rate_limited" }, 429);
      return json(result);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};