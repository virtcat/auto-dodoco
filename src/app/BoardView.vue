<script setup lang="ts">
/**
 * @component BoardView
 *
 * 棋盘视图：渲染 N×N 网格并处理“点击 / 拖动涂色”交互。
 *
 * - 使用 Pointer Events 统一鼠标与触屏；
 * - 拖动过程中通过 `document.elementFromPoint` 命中指针下的格子，
 *   调用 store 的 `setCell`；格子背景为响应式绑定，
 *   Vue 只会 patch 发生变化的格子（无需手动操作 DOM）；
 * - `touch-action: none`（见 styles.css）防止移动端拖动时页面滚动；
 * - 坐标与编号：内部仍用 0-based `(x, y)`（x=列、y=行，见 core `types.ts`）；
 *   显示采用“数学坐标系”惯例——`y=0` 渲染在棋盘**底部**，
 *   左侧行号 `y+1` 从下到上 1..N，底部列号 `x+1` 从左到右 1..N
 *   （见下方 `rowLabels` / `colLabels`）。
 */
import { computed, onBeforeUnmount, onMounted } from "vue";
import { board, cellMark, setCell, palette } from "./store";

/**
 * 所有格子坐标（仅当 N 变化时重算）。
 *
 * 纵向按 `y` 从大到小排列，使 `y=0` 落在棋盘**底部**（数学坐标系惯例）：
 * 这样左侧行号标签 `y+1` 自然从下到上 1..N，与视觉一致。
 */
const coords = computed(() => {
  const n = board.n;
  const out: { x: number; y: number }[] = [];
  for (let y = n - 1; y >= 0; y--) {
    for (let x = 0; x < n; x++) out.push({ x, y });
  }
  return out;
});

/** 左侧行号标签（视觉从上到下）：顶行 N … 底行 1（对应 y=N-1 … 0，行号 = y+1）。 */
const rowLabels = computed(() => {
  const n = board.n;
  return Array.from({ length: n }, (_, i) => n - i);
});

/** 底部列号标签（从左到右）：1..N（对应 x=0..N-1，列号 = x+1）。 */
const colLabels = computed(() => {
  const n = board.n;
  return Array.from({ length: n }, (_, i) => i + 1);
});

/** 读取某格当前颜色对应的背景色（与画笔色块同色；响应式：单格变化只更新单格）。 */
function cellBg(x: number, y: number): string {
  const color = board.colors[y]?.[x] ?? 0;
  return palette.value[color]?.swatchBg ?? "transparent";
}

/* ------------------------------------------------------------------ */
/* 拖动涂色交互                                                         */
/* ------------------------------------------------------------------ */

let painting = false;

function paintAt(e: PointerEvent): void {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el?.closest(".board-cell") as HTMLElement | null;
  if (!cell) return;
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  setCell(x, y, board.selectedColor);
}

function onPointerDown(e: PointerEvent): void {
  painting = true;
  paintAt(e);
}

function onPointerMove(e: PointerEvent): void {
  if (painting) paintAt(e);
}

function stopPainting(): void {
  painting = false;
}

onMounted(() => {
  window.addEventListener("pointerup", stopPainting);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerup", stopPainting);
});
</script>

<template>
  <div class="board-frame">
    <div class="board-with-labels">
      <!-- 左侧行号：视觉从上到下 = N…1（行号 y+1 从下到上 1..N，y=0 在底部） -->
      <div
        class="board-row-labels"
        aria-hidden="true"
        :style="{ gridTemplateRows: `repeat(${board.n}, minmax(0, 1fr))` }"
      >
        <span v-for="r in rowLabels" :key="`r${r}`" class="board-axis-label">{{ r }}</span>
      </div>

      <div
        class="board-grid"
        role="grid"
        aria-label="颜色棋盘"
        :style="{ gridTemplateColumns: `repeat(${board.n}, minmax(0, 1fr))` }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="stopPainting"
        @pointercancel="stopPainting"
      >
        <button
          v-for="c in coords"
          :key="`${c.x}:${c.y}`"
          type="button"
          class="board-cell"
          :data-x="c.x"
          :data-y="c.y"
          :data-mark="cellMark(c.x, c.y)"
          :style="{ background: cellBg(c.x, c.y) }"
          :aria-label="`第 ${c.y + 1} 行 第 ${c.x + 1} 列`"
        />
      </div>

      <!-- 底部列号：从左到右 = 1..N（列号 x+1，x=0 在最左） -->
      <div
        class="board-col-labels"
        aria-hidden="true"
        :style="{ gridTemplateColumns: `repeat(${board.n}, minmax(0, 1fr))` }"
      >
        <span v-for="c in colLabels" :key="`c${c}`" class="board-axis-label">{{ c }}</span>
      </div>
    </div>
  </div>
</template>