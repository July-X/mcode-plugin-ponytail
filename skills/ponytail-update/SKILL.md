---
name: ponytail-update
description: >
  立刻检查并拉取 ponytail 上游最新版本（绕过每日一次的节流），并报告当前版本、来源与上次检查时间。
  触发：用户说「更新 ponytail」「检查更新」「ponytail 最新版」「拉一下最新版」，
  或调用 ponytail-update / /ponytail-update；也用于排查「我以为已经是最新版」。
  只同步规则集内容，不改本插件的代码或清单。
---

# Ponytail Update

绕过 24h 节流强制同步一次上游。

## 1. 定数据根

`--root` 优先取会话里以 `PONYTAIL` 开头、含 `已就绪` 那一行里的 `--root "…"` 值；没有就试这两个探测路径，命中即可写：

```sh
ls -d "$HOME/.minimax/plugin-data/ponytail" 2>/dev/null
ls -d "$HOME/.minimax/plugins/.data/ponytail" 2>/dev/null
```

两条都没有 → 明确告诉用户「没有可写数据目录，只能读包内钉版快照」，然后跑只读的 `status` 交代现状，**不要**去插件目录里写任何东西。

## 2. 同步并汇报

```sh
node "<CLI>" update --force --root "<dataRoot>"   # --force 跳过 24h 节流
node "<CLI>" status --root "<dataRoot>"
```

CLI 路径取法见 `ponytail` 技能（会话那一行，或本文件 `../../scripts/ponytail.mjs`）。

## 3. 汇报要点

- 同步前后的版本号（`update` 的输出 + `status` 的版本行）。
- 结果属于哪种：已更新 / 已是最新 / 失败。失败就把原因原样说给用户（常见是断网或 GitHub 限流），并说明**现有版本继续可用**，不会因为更新失败而降级。
- 若 `status` 有「上次异常」行，一并念出来。
- 同步成功后提醒：规则集立即生效，**已加载的技能可能仍持有旧内容**，新开一次调用即可拿到最新。

## 纪律

- 同步只写 `PLUGIN_DATA/upstream/<tag>/`，**永远不要**改插件包目录里的 `vendor/` 快照或 `skills/`。
- 拉取失败就如实失败，不要谎报成功，也不要反复重试超过两次。
