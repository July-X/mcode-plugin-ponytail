# 钩子接入调研：暂不接入，等什么

调研日期 2026-10-23 ｜ MiniMax Code Desktop 3.1.4-inside.136 ｜ 上游 ponytail v5.3.2 ｜ 本包 v1.1.0

## 结论

**暂不接入上游那三个钩子**，等 MiniMax 出正式文档再定。三条理由，按权重排：

1. **官方投稿指南明确不受理 Hook。** 「当前第三方表单尚不受理 Hook，请勿提交 `hooks` 字段或 Hook JSON 文件。」这是官方对第三方发布路径的当前口径，接了反而把包变成不合规格的东西。
2. **上游那份 JSON 不能直接抄，有 4 处硬不兼容**（见 §2.2）。要接必须重写，不是复制粘贴。
3. **真正的缺口（子智能体看不见 ponytail）有低成本替代**，不必等钩子（见 §3.3）。

但调研本身产出了可复用的结论和两个包体规格问题，都已修（见 §5）。

---

## 1. MiniMax Code 现在的钩子能力

### 1.1 两种位置，别混

| 位置 | 文件 | 适用 |
|---|---|---|
| 插件自带 | 包内 `hooks/hooks.json`，由 manifest 的 `hooks` 数组声明 | 要分发、要跟包版本走的 |
| 用户级 | `<DATA_DIR>/hooks.json` | 只给自己用的 |
| 项目级 | `<项目根>/.minimax/hooks.json` | 只给一个项目用的 |

产品侧新建钩子面板：**设置 → 钩子**，可填钩子名称、事件、匹配条件、命令、Windows 命令、作用域（全局 / 项目）。命令里可用 `${MINIMAX_PROJECT_DIR}`、`${MINIMAX_HOOKS_DIR}`、`${MINIMAX_HOOKS_DATA}`；插件里的钩子另外可用 `${PLUGIN_ROOT}`、`${PLUGIN_DATA}`。

用户级和项目级钩子**不能**用 `${PLUGIN_ROOT}` / `${PLUGIN_DATA}`——那是插件包才有的注入。

### 1.2 事件与输出契约（插件格式）

支持 11 个事件：`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`SubagentStart`、`SubagentStop`、`Stop`、`PreCompact`、`PostCompact`。

只有同步 `type: "command"`。handler 允许的字段**只有**：`type`、`command`、`commandWindows`、`timeout`（1–10 秒，默认 5）。**`statusMessage` 不在白名单里**，`matcher` 可选且最长 256 字符。

给模型加上下文的输出形状：

```json
{ "hookSpecificOutput": { "hookEventName": "SubagentStart", "additionalContext": "..." } }
```

`hookEventName` 必须与实际事件名完全一致。`SessionStart` 和 `UserPromptSubmit` 还支持纯文本 stdout 直接进上下文。

事件预算：普通事件合计 15 秒，`SessionEnd` 全体共享 3 秒；最多 8 个命令并发。

### 1.3 官方文档现状（关键）

| 页面 | 地址 | 状态 |
|---|---|---|
| 插件市场 | `agent.minimaxi.com/docs/code/agents/plugins.md` | 有，但只讲安装与投稿入口 |
| **插件开发与上架指南** | `agent.minimaxi.com/docs/code/agents/plugin-submission.md` | **2026-10 新增**，最权威 |
| 钩子专页 | — | **不存在** |

投稿指南里与钩子相关的原文：

> 一个 Plugin 可以只包含一种能力，也可以组合 App、MCP 和 Skill；每个 Plugin 至少包含一种能力。**当前第三方表单尚不受理 Hook**，请勿提交 `hooks` 字段或 Hook JSON 文件。桌面端可直接导入的其他插件格式，也需要先转换为本指南规定的 MiniMax Plugin 包才能投稿。

注意 `agent.minimaxi.com` 会 302 跳到 `agent.minimax.cn`，两个域名都能用。

---

## 2. 上游 ponytail 的钩子

### 2.1 三个钩子各干什么

上游 `.codex-plugin/plugin.json` 里 `"hooks": "./hooks/claude-codex-hooks.json"`，内容是三个事件：

| 事件 | 脚本 | 作用 |
|---|---|---|
| `SessionStart` | `ponytail-activate.js` | 写模式标志文件；**把规则集作为隐藏上下文注入本会话**；检查 statusline 配置 |
| `SubagentStart` | `ponytail-subagent.js` | **把规则集注入每个子智能体** |
| `UserPromptSubmit` | `ponytail-mode-tracker.js` | 从提示词里抓 `/ponytail` 命令改模式；模式变了就注入规则集 |

上游自己的说明：**「two lifecycle hooks」**（session-start + subagent），**「Active every session」**——不是每轮注入。`UserPromptSubmit` 是给**没有技能**的宿主用的（上游 INSTALL.md 写「Cursor gets `/ponytail` level switching only, typed as a plain message」）。有技能的宿主走技能切档。

上游脚本还都从 `~/.claude` 读配置、用 `CLAUDE_PLUGIN_ROOT` 定位自己。

### 2.2 与 MiniMax 的 4 处硬不兼容

上游那份 JSON **不能直接抄**：

| 上游 | MiniMax 要求 | 后果 |
|---|---|---|
| `CLAUDE_PLUGIN_ROOT` | `${PLUGIN_ROOT}` | 路径定位不到，钩子必失败 |
| `statusMessage` | 不在白名单字段 | 被忽略（面板上就看不到那两个名字） |
| `timeout: 15` | 上限 10 秒 | 校验不过 |
| `UserPromptSubmit` 带 `matcher` | matcher 被忽略，应省略 | 无效字段 |

再加上语义差异：上游读 `~/.claude` 的模式文件，本包要读 `${PLUGIN_DATA}`；上游的输出格式是它自己的 `writeHookOutput()`，本包要吐 `hookSpecificOutput.additionalContext`。

---

## 3. 实测（本机，两个探针）

### 3.1 SessionStart 上下文**不传给子智能体**

派一个子智能体问它上下文里有没有 `PONYTAIL` 开头的行，答案是**没有**。再让它去翻会话日志 `~/.minimax/v2/sessions/**/messages.jsonl` 逐条按 role 核对：父会话里那行是 `role=custom` 的 `<plugin-hook-context>`，子会话里整块不存在。

这和上游 issue #252 描述的一致——「SessionStart context is parent-thread only and never reaches subagents」。

### 3.2 但子智能体**仍然能拿到完整规则集**

第二个探针让子智能体自己加载 `ponytail:ponytail` 技能并取规则集，它做到了：

- 走 SKILL.md 的退路 `../../scripts/ponytail.mjs` 定位到 CLI；
- 走 `resolveDataRoot()` 的探测路径命中 `~/.minimax/v2/plugin-data/hooks/ponytail`；
- 取到 41 行完整规则集，头行 `PONYTAIL ACTIVE — level: full（上游 v5.3.2）`。

技能目录条目在子智能体里**是可见的**（探针确认 `available_skills` 里有 7 个 ponytail 技能）。

### 3.3 真正的风险是**静默降级**，不是「拿不到」

指针行的真实作用不是「规则集来源」，而是传递三个参数：**数据根 + CLI 绝对路径 + 当前强度**。

拿不到 `--root` 时，数据根靠探测。探测一旦失败，CLI 会**静默**退回包内钉版快照：

- 当前已同步 **v5.3.2**，包内钉版是 **v4.10.0** —— 拿到的是过期规则集，且没有任何提示；
- `mode set` 这类写操作会因无数据根直接失败。

这是真实风险，不是理论风险。可低成本消掉（见 §4 的 A 案）。

### 3.4 成本实测

| 内容 | 体积 | 粗估 token |
|---|---|---|
| 现有指针行（SessionStart 注入） | 243 字符 | ~60 |
| 完整规则集 `full` | 2,970 字节 / 41 行 | ~740 |
| `lite` / `ultra` | 3,025 / 3,039 字节 | ~756 / ~759 |

上游给每个子智能体注入完整规则集——派 5 个子智能体就是约 3,700 token 的规则集。上游为此专门提供了 `PONYTAIL_SUBAGENT_MATCHER` 做范围限制（opt-in，issue #506）。

---

## 4. 三个选项

| | 做法 | 成本 | 拿到什么 |
|---|---|---|---|
| **A** | 加 `SubagentStart`，注入**同一行指针** | 60 token/子智能体 | 子智能体拿到正确数据根、CLI 路径、当前强度，不猜、不降级。规则集仍靠它自己调技能（技能目录它看得见） |
| **B** | 加 `SubagentStart`，注入**完整规则集** | 740 token/子智能体 | 子智能体无条件受约束，对齐上游 |
| **C** | B + `SessionStart` 也注入完整规则集 | 740/会话 + 740/子智能体 | 完全对齐上游 v5「always on」，放弃「显式调用」设计 |

**当时推荐 A**。理由：规则集有 ~740 token，×N 个子智能体就是主要成本来源；A 保住了「规则集需显式调用技能」的设计不变，只补参数传递。

**这次没有实现任何一个**——官方口径是「投稿表单尚不受理 Hook」，且没有钩子专页文档，契约可能变。等官方文档出来再按当时的契约重新评估。

### 补充：`UserPromptSubmit` 单独判断

**不建议加。** 上游自己说「the skills still work」——只有 Cursor 那种没有技能的宿主才需要打字切档。本包有 7 个技能，模式切换已经走 `mode set`。而且它每轮用户提示都要起一次 node，收益却只有「少依赖 Agent 自觉调用技能」。

---

## 5. 调研顺手修掉的问题

### 5.1 包体规格不合官方投稿指南

读投稿指南时发现本包两处不合规格：

| 问题 | 官方要求 | 修正 |
|---|---|---|
| `exampleQueries` 有 6 条 | **0–3 条** | 裁到 3 条；被裁掉的 3 条记在 §5.3 |
| 声明了 `darkIcon` | 「当前生产发布仅接受默认 `icon`，请勿声明 `darkIcon`」 | **保留**——本地运行时支持 `darkIcon`，只有走 Marketplace 发布才要删。本包目前是 GitHub 导入分发，不受影响；但投稿前必须删 |

同时把 `exampleQueries` 的 0–3 条上限补进了 `tools/validate-package.mjs`，以后自检会拦。

### 5.2 sync 的临时文件泄漏

`PLUGIN_DATA` 下积了 4 个 `state.json.<pid>.tmp` 残留。根因：`writeState()` 先写 `state.json.<pid>.tmp` 再 rename，进程被钩子超时 kill 时正好卡在两步之间，临时文件就留下了（PID 各不相同，可证是 4 次独立的中断）。

修法：写失败时清掉自己的临时文件；并在写入前扫掉 mtime 超过 10 分钟的同类残留（活进程的临时文件是毫秒级的，不会被误删）。

已验证：造一个 1 小时前的旧残留和一个刚写的新残留，跑 `mode set` 后——旧残留被删、新残留保留、正式 `state.json` 正常。存量 4 个残留也已清掉。

### 5.3 README 里对上游的描述是错的（已改）

原 README 写「上游在 Claude Code / Codex 上默认**每轮**把规则集注入上下文」——**这是 v4 的行为**。上游 v5 的 README 原文是 "**Active every session**" 和 "its **two** lifecycle hooks"（session-start + subagent，**不是每轮**）。

我们原来引用来支撑「不自动注入」的那笔成本账（每轮重注入）已经不成立。README 已按 v5 的实际行为改写。

被裁掉的 3 条 `exampleQueries`（留档，投稿前若要补回可从这里取）：

- `ponytail-debt，把代码库里标记的待办整理成技术债台账`
- `更新 ponytail 到最新版`
- `ponytail 有哪些命令，速查一下`

---

## 6. 重新评估的触发条件

出现以下任一条，就重开这个调研：

1. MiniMax 发布**钩子专页**文档（`agent.minimax.cn/docs/` 下），说明钩子的官方契约与投稿口径；
2. 投稿指南里「尚不受理 Hook」这句话变了；
3. `plugin.json` 的 manifest 字段表里出现了 `hooks`；
4. 上游 ponytail 改了钩子集（比如把 `UserPromptSubmit` 去掉或新增事件）。

到时按 §2.2 的对照表逐项重核，再按 §3 的探针方法重测子智能体行为。
