---
name: ponytail-gain
description: >
  展示 ponytail 的实测影响记分板：少多少代码、少多少成本、快多少倍，取自官方基准的中位数。
  触发：调用 ponytail-gain / /ponytail-gain，或用户说「ponytail 省了多少」「ponytail 有什么收益」
  「展示 ponytail 效果」「ponytail scoreboard」。
  一次性展示，不是持久模式；给的是上游基准的通用数字，不是当前仓库的实测值——必须说清这个区别。
---

# Ponytail Gain

上游的收益记分板。正文从命令取，不要凭记忆编数字。

## 1. 取内容

CLI 路径与 `--root` 的取法见 `ponytail` 技能（会话里以 `PONYTAIL` 开头、含 `已就绪` 的那一行，或本文件 `../../scripts/ponytail.mjs`）。

```sh
node "<CLI>" skill ponytail-gain --root "<dataRoot>"
```

## 2. 执行

1. 按取到的正文原样呈现记分板（代码量 / 成本 / 速度，以及安全性对比）。
2. **必须标注**这是上游基准的中位数、不是当前仓库的实测值。要当前仓库的真实数字，得另外量（`git log` / 语言自带的度量），别混为一谈。
3. 数字以取到的正文为准；取不到就说取不到，不要凭印象填。
