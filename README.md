# AutoDodoco · 嘟嘟可在哪里求解器

「嘟嘟可在哪里」谜题求解器！

支持 1 和 2，支持原版与 Pro 版截图识别！

**[>> 点此进入 <<](https://dodoco.awsl.link)**

[![License](https://img.shields.io/badge/License-MIT-94E044?style=flat-square)](./LICENSE)

给定一个 N×N、N 种颜色的棋盘格，嘟嘟可格子的周围八格不会有其他嘟嘟可，求解器判断每个格子应标记为「嘟嘟可」还是「空白」：

- **K = 1**：每种颜色、每行、每列恰好 **1** 个嘟嘟可；
- **K = 2**：每种颜色、每行、每列恰好 **2** 个嘟嘟可。

## 特性

- 调整边长 **N**（≤ 16）与模式 **K**（1 / 2）；
- 可用画笔拖曳着色；
- 可选择/拖放/粘贴盘面截图，自动识别网格提取着色；
- 自动推理最终盘面标记。

## 运行 Web 应用

```bash
npm install
npm run dev        # 打开 http://localhost:5173
```

## 许可证

[MIT](./LICENSE) © 2026 virtcat
