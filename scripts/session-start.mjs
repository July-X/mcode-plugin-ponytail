#!/usr/bin/env node
// SessionStart 钩子。
//
// 你选了「不常驻注入」——规则集不进每轮上下文。这个钩子因此**不注入规则集**，
// 它只做两件事：
//   1. 每天最多一次检查上游更新（24h 节流，写在 PLUGIN_DATA/state.json）；
//   2. 注入**一行**指针：活动版本 + 数据根 + CLI 路径。
//
// 第 2 条是自动更新能被技能用起来的前提：技能本身是 markdown，拿不到环境变量，
// 不知道 PLUGIN_DATA 在哪；没有这行它就只能读包内快照，「自动更新」形同虚设。
// 一行 ≈ 40 token，每个会话一次，和「每轮注入」不是一个量级。
//
// 失败纪律：钩子失败必须静默放行。断网、GitHub 限流、PLUGIN_DATA 不可写，
// 都只影响更新，不影响会话——所以整体兜 try/catch，且绝不给 stdout 吐非 JSON 内容。

import process from 'node:process';
import path from 'node:path';
import { PACKAGE_ROOT, VENDOR_DIR, readState, resolveDataRoot } from './lib/paths.mjs';
import { sourceInfo } from './lib/ruleset.mjs';
import { sync, throttled } from './lib/sync.mjs';
import { armWatchdog, writeAndExit } from './lib/emit.mjs';

// 读掉 stdin。规范说每条命令都会收到一个 JSON 对象，这里不依赖它的内容，
// 但必须消费掉，否则管道写端可能收到 EPIPE。
try {
  process.stdin.resume();
  process.stdin.on('data', () => {});
} catch {
  /* 忽略 */
}

const CLI = path.join(PACKAGE_ROOT, 'scripts', 'ponytail.mjs');

function pointerLine(info) {
  // 每个路径只出现一次：重复写三遍会让这行从 ~200 涨到 900+ 字符，而它每会话都进上下文。
  // 散文部分也压到最短——两个绝对路径约 130 字符是省不掉的地板，其余能省都省。
  const dataArg = info.dataRoot ? ` --root "${info.dataRoot}"` : '（只读，本次不带 --root）';
  return (
    `PONYTAIL ${info.version ?? '未知版本'} 已就绪｜强度 ${info.mode}｜` +
    `${info.live === VENDOR_DIR ? '包内快照' : '已同步上游'}｜规则集需显式调用技能，不自动注入。` +
    `CLI: node "${CLI}"${dataArg}（子命令 rules|skill|mode|status|update）`
  );
}

async function main() {
  const dataRoot = resolveDataRoot();
  const st = readState(dataRoot);

  // 节流：24h 内成功查过就不发网络请求；失败过则 30min 短退避（由 sync 内部判定）。
  // 首次安装 lastCheck=0，必定查一次。
  if (!throttled(st)) {
    // 预算 8s，钩子声明 timeout=10 —— 留 2s 给启动与收尾抖动。
    await sync(dataRoot, { force: false, budgetMs: 8000 });
  }

  const info = sourceInfo();
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: pointerLine(info) },
  });
}

armWatchdog(9500, 'session-start');

main()
  .then((payload) => writeAndExit(payload))
  .catch(() => {
    // 最后一道：任何意外都不给用户看错误，只放行会话。
    try {
      writeAndExit(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `PONYTAIL 已加载（规则集需显式调用技能；状态: \`node "${CLI}" status\`）。`,
          },
        }),
      );
    } catch {
      process.exit(0); // stdout 不可写就彻底放弃，钩子失败放行
    }
  });
