# mcode-plugin-ponytail

把 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) 的「懒惰阶梯」完整搬进 **MiniMax Code 桌面版**，并让它每天自动跟上上游最新版本。

## ⚠️ 这不是一个独立项目

规则集、技能正文、强度裁剪逻辑**全部来自上游** [DietrichGebert/ponytail](https://github.com/Dietrichgebert/ponytail)（MIT，Copyright © Dietrich Gebert），逐字复制在 `ponytail/vendor/` 里，并附原文许可 `ponytail/vendor/LICENSE`。

本仓库只提供**适配层**：把上游的 Claude Code / Codex 形态接到 MiniMax 的 Plugin V1 格式上，并补上自动更新。**如果你的工具不是 MiniMax Code，请直接用上游**——它原生支持 16+ 个 agent，装起来比自己写适配省事得多。

## 它管什么

写代码前先走六级阶梯，停在第一个成立的台阶上：

1. 这东西需要存在吗？（YAGNI）
2. 代码库里已有吗？→ 复用
3. 标准库能做吗？→ 用标准库
4. 平台原生能做吗？→ 用原生
5. 已装依赖能做吗？→ 用已装的
6. 一行能搞定吗？→ 就一行
7. 都不行 → 才写最少能工作的代码

**不砍的东西**（这是它的红线，不是可调项）：信任边界校验、防数据丢失的错误处理、安全措施、可访问性、真实硬件需要的标定旋钮。

效果对比（上游 README 的原例）：

| | 不带 ponytail | 带 ponytail |
|---|---|---|
| 要个日期选择器 | `npm i flatpickr` + wrapper 组件 + 样式表 + 开始讨论时区 | `<input type="date">` |

## 安装

**前置**：MiniMax Code 桌面版；`node` 在 PATH 上（钩子要用，Node ≥ 18 即可）。

```sh
git clone https://github.com/July-X/mcode-plugin-ponytail.git
cp -R mcode-plugin-ponytail/ponytail ~/.minimax/plugins/ponytail
```

目标路径：

| 系统 | 路径 |
|---|---|
| macOS | `/Users/<你>/.minimax/plugins/ponytail/` |
| Linux | `/home/<你>/.minimax/plugins/ponytail/` |
| Windows | `C:\Users\<你>\.minimax\plugins\ponytail\` |

如果你改过数据目录（环境变量 `MINIMAX_DATA_DIR`），放进那个目录下的 `plugins/` 里。

装完重启 MiniMax Code，在插件面板确认 **Ponytail** 已出现且已启用。

**注意别漏掉隐藏目录** —— 插件靠 `ponytail/.minimax-plugin/plugin.json` 被识别，`cp -R` 会带上，别用只拷可见文件的方式。

装完可以自检：

```sh
node tools/validate-package.mjs ponytail
```

它会校验清单字段、技能 frontmatter、钩子声明、图标字节与路径合法性；有问题会列出具体哪一条红。

## 用法

| 技能 | 作用 |
|---|---|
| `ponytail` | 开 / 查当前档位（默认 `full`） |
| `ponytail lite\|full\|ultra` | 切档位 |
| `ponytail off` | 停用 |
| `ponytail-review` | 评审当前改动里的过度设计，每条一行 |
| `ponytail-audit` | 全仓审计，按收益排序 |
| `ponytail-debt` | 把代码里的 `ponytail:` 标记收成技术债台账 |
| `ponytail-gain` | 收益记分牌（上游基准中位数） |
| `ponytail-help` | 速查卡 |
| `ponytail-update` | 立刻拉上游最新版并汇报 |

## 与上游的一个关键差异：规则集不自动注入

上游在 Claude Code / Codex 上默认**每轮**把规则集注入上下文。这里**不这么做**——规则集只在显式调用 `ponytail` 技能时生效，之后在本会话内持续有效。

原因：上游 README 自己算过这笔账——「规则集每轮重新注入，在很短的 prompt 上这个开销可能超过它省下的成本」。上游还提到 74k star 版本实测能省 54% 代码量、22% token、27% 时间，但那是**不含每轮注入开销**的对比。

于是本适配层只在每个会话启动时注入**一行**指针（活动版本 + 强度 + 数据根 + CLI 路径），约 90 token，供技能找到活的内容。规则集正文不进去。

想改回常驻注入：给 `ponytail/hooks/hooks.json` 加一个 `UserPromptSubmit` handler，跑 `ponytail.mjs rules` 并把输出写进 `additionalContext`，约 10 行。

## 自动更新

`SessionStart` 钩子每天最多检查一次上游有没有新版本，有就自动切换。

- **取源顺序**：GitHub release（权威，给 2.5s）→ npm registry → npmmirror。三者版本号锁步（实测 GitHub `v4.10.0` = npm `4.10.0`），是同一个事实的不同传输。
- **为什么要降级**：实测从中国大陆访问 `api.github.com` / `github.com` 延迟极不稳定——5 次采样里有 2 次接近 8 秒（0.9 / 1.0 / 1.3 / **7.7** / **8.5** 秒），而 `raw.githubusercontent.com` 稳定在 0.5~1.7 秒、npmmirror 只要 0.05~0.14 秒。卡满预算会让「每日更新」经常失败。
- **失败不消耗每日额度**：网络抖动只触发 30 分钟短退避，不吃掉 24 小时窗口。一次失败不该让自动更新静默停摆一整天。
- **失败不降级**：拉不到新版就用现有版本，规则集照常工作。

手动查：`ponytail-update`，或

```sh
node ponytail/scripts/ponytail.mjs update --force
node ponytail/scripts/ponytail.mjs status
```

排查卡在哪一步（分阶段耗时打到 stderr）：

```sh
PONYTAIL_TRACE=1 node ponytail/scripts/ponytail.mjs update --force
```

### 换镜像

```sh
export PONYTAIL_GITHUB_WEB=https://github.com          # release 重定向
export PONYTAIL_GITHUB_RAW=https://raw.githubusercontent.com
export PONYTAIL_NPM_REGISTRY=https://registry.npmjs.org
export PONYTAIL_NPM_MIRROR=https://registry.npmmirror.com
```

换源只影响「从哪问版本号」，不影响 tag 校验和逐文件落盘，不放宽任何安全判据。

## 卸载

1. 退出 MiniMax Code
2. 删掉插件目录：`rm -rf ~/.minimax/plugins/ponytail`
3. 想连状态一起清掉：`rm -rf ~/.minimax/v2/plugin-data/hooks/ponytail`

状态目录里只有强度设置和一份上游镜像，删了会重新拉，不影响任何用户数据。

## 目录结构

```
ponytail/
  .minimax-plugin/plugin.json     插件清单
  icon.png / icon-dark.png        明暗图标（本仓库原创，512×512 RGBA）
  hooks/hooks.json                SessionStart：每日更新检查 + 一行指针
  skills/                         7 个 MiniMax 技能（薄路由层，不复述规则）
  scripts/
    ponytail.mjs                  CLI：rules / skill / mode / status / update
    session-start.mjs             钩子入口
    lib/{paths,sync,ruleset,emit}.mjs
  vendor/                         上游 v4.10.0 钉版快照（离线回退，永不被改写）
tools/validate-package.mjs        安装自检
```

`vendor/` 是打包时的钉版快照，只在同步尚未跑过或处于只读模式时生效。日常用的是 `PLUGIN_DATA/upstream/<tag>/` 下由 `scripts/lib/sync.mjs` 同步的版本。同步**只写数据目录，永远不改插件包**。

## 许可

本仓库的适配层代码与文档以 MIT 发布，许可文本见 [`LICENSE`](LICENSE)。第三方归属集中列在 [`NOTICE`](NOTICE)。

上游 Ponytail 项目同样以 MIT 发布，Copyright © Dietrich Gebert，许可文本见 [`ponytail/vendor/LICENSE`](ponytail/vendor/LICENSE)。规则集的强度裁剪逻辑移植自上游 `hooks/ponytail-instructions.js`。

图标为本仓库原创：一笔马尾从顶端的结一路收到尾端的尖，横档是阶梯。收尖那段就是概念本身——阶梯往下走代码越来越少，少到末端只剩一个点。明暗两版是同一个形状换色，不是两张各画各的图。

`LICENSE` 保持 SPDX 原文不加附属说明，是为了让 GitHub 与各类许可证工具能正确识别为 MIT；早期版本把上面的归属声明追加在 `LICENSE` 末尾，仓库因此被标成 `Other`。
