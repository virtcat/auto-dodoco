/**
 * @module util/ensure-utf8
 *
 * 在 Windows 上将控制台代码页切换为 UTF-8（CP65001），
 * 以便正确显示中文（例如推理日志中的“嘟嘟可”）。
 * 非 Windows 平台（终端通常已是 UTF-8）则不做任何事。
 *
 * 该模块只做“尽力而为”的设置，任何失败都静默忽略，绝不影响功能。
 */

import { spawnSync } from "node:child_process";

export function ensureUtf8Console(): void {
  if (process.platform !== "win32") return;
  try {
    // `chcp` 是 cmd 内建命令，需要 shell:true；stdio:"ignore" 抑制其输出。
    spawnSync("chcp 65001", { shell: true, stdio: "ignore" });
  } catch {
    /* 忽略：代码页切换失败不影响求解与测试逻辑。 */
  }
}