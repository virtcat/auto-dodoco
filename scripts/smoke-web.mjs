/**
 * Web UI 冒烟测试（jsdom）：
 * 加载 dist 构建产物，验证应用启动渲染与关键交互。
 *
 * 注意：应用为 Vue 3 SPA，响应式更新在微任务中批量刷新，
 * 每次交互后需等待一个宏任务（tick）再断言 DOM。
 *
 * 用法：npm run build && node scripts/smoke-web.mjs
 */

import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dir = new URL("../dist/", import.meta.url);
const html = readFileSync(new URL("index.html", dir), "utf8");
const jsName = html.match(/assets\/([\w.-]+\.js)/)?.[1];
if (!jsName) throw new Error("未在 index.html 中找到 JS 资源");
const js = readFileSync(new URL(`assets/${jsName}`, dir), "utf8");

const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;
window.elementFromPoint = () => null; // jsdom 无命中测试实现，初始化阶段不会用到

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
};
// Vue 响应式更新是异步（微任务）的，等待渲染完成后再断言。
const tick = () => new Promise((r) => setTimeout(r, 20));

console.log("[冒烟] 启动应用…");
window.eval(js);
const doc = window.document;
const $ = (sel) => doc.querySelector(sel);
const $$ = (sel) => doc.querySelectorAll(sel);

console.log("[冒烟] 初始渲染（N=6, K=1）");
ok(!!$(".board-frame"), "棋盘容器已渲染");
ok($$(".board-cell").length === 36, `渲染 36 个格子（实际 ${$$(".board-cell").length}）`);
ok($$(".swatch").length === 6, "渲染 6 个画笔颜色");
ok(!!$('[data-action="random"]'), "随机着色按钮存在");
ok(!!$(".recog-drop"), "图像识别拖放区已渲染");
ok(!!$('input[type="file"]'), "图像选择 input 存在");

console.log("[冒烟] 切换画笔颜色");
const swatchOf = (id) =>
  Array.from(doc.querySelectorAll("[data-color]")).find((b) => b.dataset.color === id);
swatchOf("3").click();
await tick();
ok(swatchOf("3").dataset.active === "true", "第 4 色被选中");
ok(
  Array.from(doc.querySelectorAll("[data-color]")).filter((b) => b.dataset.active === "true").length === 1,
  "仅一个选中态",
);

console.log("[冒烟] 增大边长 N=6 → 7");
$('[data-step="1"]').click();
await tick();
ok($("#n-value").textContent === "7", "N 显示为 7");
ok($$(".board-cell").length === 49, `渲染 49 个格子（实际 ${$$(".board-cell").length}）`);
ok($$(".swatch").length === 7, "色板变为 7 色");

console.log("[冒烟] 切换模式 K=2");
$('[data-k="2"]').click();
await tick();
ok($('[data-k="2"]').dataset.active === "true", "K=2 为激活态");
ok($('[data-k="1"]').dataset.active === "false", "K=1 为非激活态");

console.log("[冒烟] 清空棋盘");
$('[data-action="clear"]').click();
await tick();
ok($$(".board-cell").length === 49, "清空后格子数量不变");
const c0 = $$(".board-cell")[0];
const anyOther = Array.from($$(".board-cell")).some((b) => b.style.background !== c0.style.background);
ok(!anyOther, "全部格子为同一颜色");

console.log("[冒烟] 随机着色");
$('[data-action="random"]').click();
await tick();
ok(
  Array.from($$(".board-cell")).some((b) => b.style.background !== c0.style.background),
  "随机着色后出现不同颜色的格子",
);

console.log("[冒烟] 拖动涂色：移出棋盘再回来应继续上色");
$('[data-action="clear"]').click();
await tick();
swatchOf("4").click();
await tick();
const bg4 = swatchOf("4").style.background;
const cellAt = (x, y) => doc.querySelector(`.board-cell[data-x="${x}"][data-y="${y}"]`);
const firePointer = (type, target) => {
  const ev = new window.Event(type, { bubbles: true });
  Object.defineProperty(ev, "clientX", { value: 1 });
  Object.defineProperty(ev, "clientY", { value: 1 });
  target.dispatchEvent(ev);
};
doc.elementFromPoint = () => cellAt(1, 1);
firePointer("pointerdown", $(".board-grid"));
await tick();
ok(cellAt(1, 1).style.background === bg4, "按下时格子 (1,1) 被上色");
// 模拟按住鼠标移出棋盘（painting 状态不应被终止）
$(".board-grid").dispatchEvent(new window.Event("pointerleave"));
await tick();
// 模拟重新移回棋盘并移动（仍按住）→ 应继续上色
doc.elementFromPoint = () => cellAt(3, 2);
firePointer("pointermove", $(".board-grid"));
await tick();
ok(cellAt(3, 2).style.background === bg4, "移出棋盘再移回后可继续上色（拖动未被中断）");
// 松开鼠标（可在棋盘外松开）后，移动不应再上色
window.dispatchEvent(new window.Event("pointerup"));
await tick();
doc.elementFromPoint = () => cellAt(5, 5);
firePointer("pointermove", $(".board-grid"));
await tick();
ok(cellAt(5, 5).style.background !== bg4, "松开鼠标后移动不再上色");


/* ------------------------------------------------------------------ */
/* 求解器接入：N=6, K=1 的已知唯一解盘面                                  */
/* ------------------------------------------------------------------ */

console.log("[冒烟] 求解器接入（N=6, K=1）");
$('[data-step="-1"]').click(); // N 7 → 6
await tick();
ok($("#n-value").textContent === "6", "N 恢复为 6");
ok($$(".board-cell").length === 36, `渲染 36 个格子（实际 ${$$(".board-cell").length}）`);
$('[data-k="1"]').click(); // K 2 → 1
await tick();
ok($('[data-k="1"]').dataset.active === "true", "K=1 为激活态");

$('[data-action="clear"]').click(); // 棋盘全部重置为颜色 0
await tick();

// 铺设已知盘面（唯一解）：解为 (0,0)(2,1)(4,2)(1,3)(3,4)(5,5)。
// 颜色 1..5 各仅出现一次（“容量饱满”规则必然推出嘟嘟可），颜色 0 占其余 31 格。
const paintCells = [
  [2, 1, 1],
  [4, 2, 2],
  [1, 3, 3],
  [3, 4, 4],
  [5, 5, 5],
];
let paintTarget = null;
doc.elementFromPoint = () => paintTarget; // 劫持命中测试，模拟“点中”目标格
const gridEl = $(".board-grid");
for (const [x, y, color] of paintCells) {
  swatchOf(String(color)).click();
  await tick();
  paintTarget = doc.querySelector(`.board-cell[data-x="${x}"][data-y="${y}"]`);
  const ev = new window.Event("pointerdown", { bubbles: true });
  Object.defineProperty(ev, "clientX", { value: 1 });
  Object.defineProperty(ev, "clientY", { value: 1 });
  gridEl.dispatchEvent(ev);
  window.dispatchEvent(new window.Event("pointerup"));
  await tick();
}

$('[data-action="solve"]').click();
// startSolve 内部先让出宏任务再同步求解；Vue 的状态→DOM 刷新也是异步的，
// 因此每轮先等一个 tick 再读状态，直到进入终态（solved / unsolved / error）。
const deadline = Date.now() + 5000;
let badgeState = "";
while (Date.now() < deadline) {
  await tick();
  badgeState = $(".status-badge")?.dataset.state ?? "";
  if (badgeState !== "idle" && badgeState !== "solving") break;
}
ok(badgeState === "solved", `状态徽章为「已解出」（实际 ${badgeState || "无"}）`);
const dodos = $$(".board-cell[data-mark='dodoco']");
const empties = $$(".board-cell[data-mark='empty']");
ok(dodos.length === 6, `6 个嘟嘟可格（白点蓝圈），实际 ${dodos.length}`);
ok(empties.length === 30, `30 个空白格（白叉），实际 ${empties.length}`);
ok(
  doc.querySelector('.board-cell[data-x="2"][data-y="1"]')?.dataset.mark === "dodoco",
  "格子 (2,1) 为嘟嘟可",
);
ok(
  doc.querySelector('.board-cell[data-x="0"][data-y="1"]')?.dataset.mark === "empty",
  "格子 (0,1) 为空白格",
);
ok($$(".chain-item").length > 0, `推理链已渲染（${$$(".chain-item").length} 步）`);

$('[data-action="clear-result"]').click();
await tick();
ok($$(".board-cell[data-mark='dodoco']").length === 0, "清除结果后嘟嘟可标记消失");
ok($(".status-badge")?.dataset.state === "idle", "状态回到「待求解」");

console.log(failures === 0 ? "\n冒烟测试全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);