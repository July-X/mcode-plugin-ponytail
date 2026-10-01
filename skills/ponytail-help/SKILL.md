---
name: ponytail-help
description: >
  ponytail 全部模式、技能与命令的速查卡。
  触发：调用 ponytail-help / /ponytail-help，或用户说「ponytail 怎么用」
  「ponytail 有哪些命令」「help」「有哪些技能」。
  一次性展示，不是持久模式。
---

# Ponytail Help

上游速查卡。正文从命令取，不要凭记忆复述（命令和档位会随上游变）。

## 1. 取内容

CLI 路径与 `--root` 的取法见 `ponytail` 技能（会话里以 `PONYTAIL` 开头、含 `已就绪` 的那一行，或本文件 `../../scripts/ponytail.mjs`）。

```sh
node "<CLI>" skill ponytail-help --root "<dataRoot>"
```

## 2. 执行

1. 原样呈现速查卡。
2. 补一段**本地环境说明**（速查卡里没有的）：当前生效版本、当前强度、数据根路径 —— 取自 `node "<CLI>" status --root "<dataRoot>"`。
3. 提醒一句本插件的特殊之处：规则集**不自动注入每轮上下文**，要显式调用 `ponytail` 技能才生效；每日自动同步一次，`ponytail-update` 可立刻拉最新。
