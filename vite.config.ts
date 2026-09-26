import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    // 应用构建产物输出到 dist/；核心算法模块由 build:core（tsc）编译到 dist-core/。
    outDir: "dist",
    target: "es2020",
  },
});
