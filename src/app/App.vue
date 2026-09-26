<script setup lang="ts">
/**
 * @component App
 *
 * 根组件：搭建页面骨架并接线“棋盘设置区”（左 / 主）与“求解操作区”（右）。
 *
 * 全部状态与变更操作位于 `./store`（Vue 响应式），本组件只负责模板绑定与事件处理。
 *
 * 求解接入：
 *  - “开始求解” → `store.startSolve()`（worker 线程求解，不阻塞 UI）；
 *  - “结束求解” → `store.stopSolve()`（提前终止进行中的求解）；
 *  - “推理链”卡片逐步渲染 `SolutionResult.reasoningChain`。
 */
import { computed, ref } from "vue";
import {
  board,
  clearBoard,
  clearSolution,
  MAX_N,
  MIN_N,
  randomFill,
  setK,
  setMaxSolutions,
  setN,
  solve,
  solveOpts,
  startSolve,
  stopSolve,
} from "./store";
import type { ReasoningRule } from "../core/index.js";
import { generatePalette } from "./palette";
import BoardView from "./BoardView.vue";

const palette = computed(() => generatePalette(board.n));

/** “高级设置”折叠区是否展开（默认折叠）。 */
const advancedOpen = ref(false);

/** 边长步进器支持方向键增减。 */
function onStepperKey(e: KeyboardEvent): void {
  if (e.key === "ArrowUp" || e.key === "ArrowRight") {
    e.preventDefault();
    setN(board.n + 1);
  } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
    e.preventDefault();
    setN(board.n - 1);
  }
}

/* ------------------------------------------------------------------ */
/* 求解展示状态（自 store 派生）                                        */
/* ------------------------------------------------------------------ */

/** 规则类别中文名称（推理链标签用）。 */
const RULE_LABELS: Record<ReasoningRule, string> = {
  COUNT_CAPACITY_FULL: "容量已满",
  COUNT_CAPACITY_FULL_APPROACH: "容量饱满",
  NEIGHBOR_EXCLUSION: "邻域互斥",
  LOCAL_PERMUTATION: "局部枚举",
  CROSS_SET: "集合相交",
  BACKTRACK: "回溯猜测",
};

const ruleLabel = (r: ReasoningRule): string => RULE_LABELS[r] ?? r;

const hasResult = computed(() => solve.result !== null);
const solved = computed(() => solve.result?.solved === true);
const chain = computed(() => solve.result?.reasoningChain ?? []);
const backtrackSteps = computed(() => solve.result?.backtrackPath ?? []);

const badgeText = computed(() => {
  switch (solve.status) {
    case "solving":
      return "求解中…";
    case "done":
      return solved.value ? "已解出" : "无解";
    case "error":
      return "出错";
    default:
      return "待求解";
  }
});

const badgeState = computed(() =>
  solve.status === "done"
    ? solved.value
      ? "solved"
      : "unsolved"
    : solve.status,
);
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="mx-auto w-full max-w-[1240px] px-4 pb-4 pt-6 sm:px-6">
      <div class="flex items-center gap-3">
        <div class="logo-mark" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2.5" y="2.5" width="7.5" height="7.5" rx="2.4" fill="#fff" fill-opacity=".95" />
            <rect x="12" y="2.5" width="7.5" height="7.5" rx="2.4" fill="#fff" fill-opacity=".55" />
            <rect x="2.5" y="12" width="7.5" height="7.5" rx="2.4" fill="#fff" fill-opacity=".55" />
            <rect x="12" y="12" width="7.5" height="7.5" rx="2.4" fill="#fff" fill-opacity=".28" />
          </svg>
        </div>
        <div class="min-w-0">
          <h1 class="truncate text-[15px] font-semibold tracking-tight text-slate-900 sm:text-lg">
            AutoDodoco
          </h1>
          <p class="mt-0.5 hidden text-xs text-slate-400 sm:block">
            嘟嘟可在哪里 1 & 2 自动求解
          </p>
        </div>
        <!-- <span class="stage-badge ml-auto shrink-0">求解已接入</span> -->
      </div>
    </header>

    <main
      class="mx-auto grid w-full max-w-[1240px] flex-1 grid-cols-1 items-start gap-5 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_336px] lg:gap-6"
    >
      <!-- ============ 棋盘设置区（主区域） ============ -->
      <section class="card p-4 sm:p-6" aria-label="棋盘设置">
        <div class="flex items-baseline justify-between">
          <h2 class="text-sm font-semibold text-slate-900">棋盘设置</h2>
          <p class="text-xs text-slate-400">边长 · 模式 · 颜色矩阵</p>
        </div>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <span class="control-label">棋盘边长 N</span>
            <div class="stepper" role="group" aria-label="棋盘边长 N" @keydown="onStepperKey">
              <button
                type="button"
                class="step-btn"
                data-step="-1"
                aria-label="缩小边长"
                :disabled="board.n <= MIN_N"
                @click="setN(board.n - 1)"
              >
                −
              </button>
              <span class="step-value" id="n-value">{{ board.n }}</span>
              <button
                type="button"
                class="step-btn"
                data-step="1"
                aria-label="增大边长"
                :disabled="board.n >= MAX_N"
                @click="setN(board.n + 1)"
              >
                +
              </button>
            </div>
            <p class="control-hint">{{ MIN_N }} – {{ MAX_N }} 的整数，越大求解耗时越长</p>
          </div>
          <div>
            <span class="control-label">模式参数 K</span>
            <div class="seg" role="group" aria-label="模式参数 K">
              <button
                type="button"
                class="seg-btn"
                data-k="1"
                :data-active="String(board.k === 1)"
                @click="setK(1)"
              >
                K = 1
              </button>
              <button
                type="button"
                class="seg-btn"
                data-k="2"
                :data-active="String(board.k === 2)"
                @click="setK(2)"
              >
                K = 2
              </button>
            </div>
            <p class="control-hint">每行 / 每列 / 每色恰好 K 个嘟嘟可</p>
          </div>
        </div>

        <div class="mt-5">
          <span class="control-label">画笔颜色</span>
          <div class="swatch-row" id="palette-slot" role="group" aria-label="画笔颜色">
            <button
              v-for="c in palette"
              :key="c.id"
              type="button"
              class="swatch"
              :data-color="c.id"
              :data-active="String(c.id === board.selectedColor)"
              :style="{ background: c.swatchBg, color: c.accent }"
              :title="c.label"
              :aria-label="`选择${c.label}`"
              @click="board.selectedColor = c.id"
            />
          </div>
        </div>

        <div class="mt-5" id="board-slot">
          <BoardView />
        </div>

        <p class="mt-3 text-center text-xs text-slate-400">
          点击或按住拖动格子，为每个格子涂色
        </p>
      </section>
      <!-- ============ 求解操作区（右侧） ============ -->
      <aside class="space-y-5" aria-label="求解操作区">
        <section class="card p-5" aria-label="求解">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-900">求解</h2>
            <span class="status-badge" :data-state="badgeState">{{ badgeText }}</span>
          </div>
          <button
            v-if="solve.status === 'solving'"
            type="button"
            class="btn btn-danger mt-4 w-full"
            data-action="stop-solve"
            @click="stopSolve()"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" />
            </svg>
            <span class="spinner" aria-hidden="true"></span>
            结束求解
          </button>
          <button
            v-else
            type="button"
            class="btn btn-primary mt-4 w-full"
            data-action="solve"
            @click="startSolve()"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M5 2.7a.6.6 0 0 1 1.05-.47l6.5 5.3a.6.6 0 0 1 0 .94l-6.5 5.3A.6.6 0 0 1 5 13.3V2.7Z" />
            </svg>
            {{ hasResult ? "重新求解" : "开始求解" }}
          </button>
          <div class="mt-2.5 grid grid-cols-2 gap-2.5">
            <button type="button" class="btn btn-secondary" data-action="random" @click="randomFill()">
              随机着色
            </button>
            <button type="button" class="btn btn-secondary" data-action="clear" @click="clearBoard()">
              清空棋盘
            </button>
          </div>
          <button
            v-if="solve.status !== 'idle'"
            type="button"
            class="btn btn-secondary mt-2.5 w-full"
            data-action="clear-result"
            @click="clearSolution()"
          >
            清除求解结果
          </button>
          <p v-if="solve.error" class="error-text" role="alert">{{ solve.error }}</p>

          <!-- 结果概要（默认展示：状态 / 耗时 / 统计） -->
          <div v-if="hasResult" class="result-line">
            <span class="result-pill" :data-state="solved ? 'solved' : 'unsolved'">
              {{ solved ? "已解出" : "无解" }}
            </span>
            <span>耗时 {{ solve.result?.elapsedMs }} ms</span>
            <span>规则推导 {{ solve.result?.stats.ruleMarkings }} 格</span>
            <span v-if="solve.result?.usedBacktrack">回溯 {{ solve.result?.nodesVisited }} 节点</span>
            <span v-if="solve.result?.solutions.length > 1">{{ solve.result.solutions.length }} 个解</span>
          </div>
          <div v-else-if="solve.status === 'solving'" class="solving-box">
            <span class="spinner" aria-hidden="true"></span>
            <span>求解中…规则引擎正在推导</span>
          </div>
          <p v-else class="idle-hint">求解后在此展示结果概要，推理链详情见下方「高级设置」。</p>

          <!-- 高级设置：默认折叠，点击展开 -->
          <div class="adv" data-advanced>
            <button
              type="button"
              class="adv-head"
              data-action="toggle-advanced"
              :aria-expanded="String(advancedOpen)"
              @click="advancedOpen = !advancedOpen"
            >
              <span class="adv-title">高级设置</span>
              <span class="adv-sub">推理链 {{ hasResult ? `${chain.length} 步` : "待求解" }}</span>
              <svg
                class="adv-chevron"
                :class="{ 'is-open': advancedOpen }"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                aria-hidden="true"
              >
                <path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <div v-show="advancedOpen" class="adv-body">
              <!-- 高级设置项：最多寻找解数 -->
              <div>
                <span class="control-label">最多寻找解数</span>
                <div class="seg" role="group" aria-label="最多寻找解数">
                  <button
                    type="button"
                    class="seg-btn"
                    data-smax="1"
                    :data-active="String(solveOpts.maxSolutions === 1)"
                    @click="setMaxSolutions(1)"
                  >
                    1
                  </button>
                  <button
                    type="button"
                    class="seg-btn"
                    data-smax="2"
                    :data-active="String(solveOpts.maxSolutions === 2)"
                    @click="setMaxSolutions(2)"
                  >
                    2
                  </button>
                  <button
                    type="button"
                    class="seg-btn"
                    data-smax="all"
                    :data-active="String(solveOpts.maxSolutions === Infinity)"
                    @click="setMaxSolutions(Infinity)"
                  >
                    全部
                  </button>
                </div>
                <p class="control-hint">仅对之后的求解生效；盘面展示第 1 个解。</p>
              </div>

              <!-- 推理链具体内容（默认折叠在内，不展示） -->
              <div class="adv-chain">
                <div class="flex items-center justify-between">
                  <span class="control-label">推理链</span>
                  <span class="step-count">{{ hasResult ? `${chain.length} 步` : "0 步" }}</span>
                </div>
                <template v-if="hasResult">
                  <ol v-if="chain.length > 0" class="chain">
                    <li v-for="s in chain" :key="s.step" class="chain-item">
                      <div class="chain-head">
                        <span class="chain-idx">{{ s.step + 1 }}</span>
                        <span class="rule-tag" :data-rule="s.rule">{{ ruleLabel(s.rule) }}</span>
                      </div>
                      <p class="chain-detail">{{ s.detail }}</p>
                    </li>
                  </ol>
                  <p v-else class="chain-empty">规则阶段未产生推理步骤。</p>

                  <template v-if="backtrackSteps.length > 0">
                    <h3 class="chain-subhead">回溯猜测（非纯逻辑推导）</h3>
                    <ol class="chain">
                      <li v-for="(s, i) in backtrackSteps" :key="'bt' + i" class="chain-item">
                        <div class="chain-head">
                          <span class="chain-idx">{{ i + 1 }}</span>
                          <span class="rule-tag" data-rule="BACKTRACK">回溯</span>
                        </div>
                        <p class="chain-detail">{{ s.detail }}</p>
                      </li>
                    </ol>
                  </template>
                </template>
                <p v-else-if="solve.status === 'solving'" class="chain-empty">求解中…规则引擎正在推导。</p>
                <p v-else class="chain-empty">尚未产生推理链，求解后将在此逐步展示。</p>
              </div>
            </div>
          </div>
        </section>

      </aside>
    </main>
  </div>
</template>