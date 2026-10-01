/**
 * @module counter
 *
 * Durable Object「求解次数计数器」（SQLite 存储）。
 *
 * 三张表：
 *  - `meta`   ：`('total', N)` —— 独立维护的累计总数。`stats` 只读这一行即可拿到总数，
 *              无需扫描 `solves` 全部分桶，节省读取量。
 *  - `solves` ：按小时分桶 `{ hour -> count }`，用于「近 24 小时」口径（暂不清理过期桶）。
 *  - `rate`   ：按 `IP × 10 分钟窗口` 限流，简单防刷（超限 → 429，见 `index.js`）。
 *
 * DO 的请求串行化保证并发 `increment` 不会丢计数（无需分布式锁）。
 * 绑定名 `COUNTER`（见 `wrangler.jsonc` 的 `durable_objects.bindings`）。
 */

/** 限流窗口长度（秒）：10 分钟。 */
const RATE_WINDOW_SEC = 600;
/** 每窗口每 IP 允许的计数上限（≈ 1 次 / 10 秒）。 */
const RATE_LIMIT = 60;

export class SolveCounter {
  /**
   * @param {import("@cloudflare/workers-types").DurableObjectState} ctx
   * @param {object} env
   */
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.db = ctx.storage.sql;
    this.db.exec(
      `
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY,
        v INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS solves (
        hour INTEGER PRIMARY KEY,
        count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate (
        ip TEXT NOT NULL,
        bucket INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (ip, bucket)
      );
      `
    );
  }

  /** 当前小时桶键（hoursFromEpoch）。 */
  hour() {
    return Math.floor(Date.now() / 3600_000);
  }

  /** 只读统计：总数（`meta` 单行）+ 近 24 小时（`solves` 分桶求和）。 */
  stats() {
    const now = this.hour();
    const total =
      this.db.prepare("SELECT v FROM meta WHERE k = 'total'").read()?.v ?? 0;
    const last24h = this.db
      .prepare("SELECT COALESCE(SUM(count), 0) AS s FROM solves WHERE hour >= ?")
      .bind(now - 24)
      .read().s;
    return { total, last24h };
  }

  /**
   * 计数 +1（含限流）。
   * @param {string} ip 客户端 IP；为空则跳过限流（本地 / 无 CF 头场景更宽容）。
   * @returns {{total:number, last24h:number, rateLimited:boolean}}
   */
  increment(ip) {
    // 1) 限流（按 IP × 10 分钟窗口）
    if (ip) {
      const bucket = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC);
      this.db
        .prepare(
          "INSERT INTO rate (ip, bucket, count) VALUES (?, ?, 1) " +
            "ON CONFLICT(ip, bucket) DO UPDATE SET count = count + 1"
        )
        .bind(ip, bucket)
        .run();
      const used = this.db
        .prepare("SELECT count FROM rate WHERE ip = ? AND bucket = ?")
        .bind(ip, bucket)
        .read();
      if (used && used.count > RATE_LIMIT) {
        return { rateLimited: true };
      }
    }

    // 2) 总数 +1（独立 key，`stats` 读取无需扫描分桶）
    this.db
      .prepare(
        "INSERT INTO meta (k, v) VALUES ('total', 1) " +
          "ON CONFLICT(k) DO UPDATE SET v = v + 1"
      )
      .run();

    // 3) 当前小时桶 +1（近 24 小时口径；按需求暂不清理过期桶）
    this.db
      .prepare(
        "INSERT INTO solves (hour, count) VALUES (?, 1) " +
          "ON CONFLICT(hour) DO UPDATE SET count = count + 1"
      )
      .bind(this.hour())
      .run();

    // 4) 返回最新统计
    return { ...this.stats(), rateLimited: false };
  }
}