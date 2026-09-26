/**
 * @module main
 *
 * 应用入口：创建 Vue 应用并挂载到 `#app`。
 *
 * 页面结构与状态见 `./App.vue` 与 `./store.ts`（Vue 响应式）。
 */

import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";

createApp(App).mount("#app");