---
name: ponytail-debt
description: >
  把代码库里所有 `ponytail:` 注释收成一份技术债台账，让当初刻意留下的简化和推迟项被跟踪，
  而不是烂在「以后再说」里。
  触发：用户说「ponytail 欠的债」「ponytail-debt」「当时推迟了什么」「把标记出来的列一下」
  「技术债台账」，或调用 ponytail-debt / /ponytail-debt。
  一次性报告，不改任何代码。
---

# Ponytail Debt

上游的技术债收割流程。正文从命令取，不要凭记忆复述。

## 1. 取内容

CLI 路径与 `--root` 的取法见 `ponytail` 技能（会话里以 `PONYTAIL` 开头、含 `已就绪` 的那一行，或本文件 `../../scripts/ponytail.mjs`）。

```sh
node "<CLI>" skill ponytail-debt --root "<dataRoot>"
```

## 2. 执行

1. 搜全仓的 `ponytail:` 标记注释（常见形态 `// ponytail: <省略了什么>, 什么时候该换成什么`）。
2. 按取到的正文整理成台账，每条给：位置 → 被砍掉的是什么 → 标记里写的升级路径 → 现状判断（该换了吗 / 还不急 / 标记已过期）。
3. 一个标记都没搜到就直接说没有，不要编。
4. **一次性报告，不改代码。** 标记过时（升级路径早就该走了）单独列一节提示，这通常是最值钱的部分。
