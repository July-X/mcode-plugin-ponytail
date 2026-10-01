#!/usr/bin/env node
// Ponytail 本地 CLI —— 技能层唯一的执行入口。
//
//   rules  [--mode lite|full|ultra|off] [--root DIR]   打印当前强度的规则集
//   skill  <name> [--root DIR]                          打印指定技能正文
//   mode   get | set <level> [--root DIR]               读/写强度（写需要 --root 或 PLUGIN_DATA）
//   status                                              版本 / 来源 / 上次检查
//   update [--force] [--root DIR]                       立刻检查上游（默认 24h 节流）
//
// --root 是关键：钩子有 PLUGIN_DATA，技能没有。让技能把会话里那行 PONYTAIL 指针
// 里的数据根传进来，两边就落在同一份状态上；不给就只读退回包内快照。
//
// 风格：任何路径都自己解析（脚本可能被从任意 cwd 调用），不假设调用方给对了目录。

import process from 'node:process';
import { buildRuleset, loadSkillBody, sourceInfo } from './lib/ruleset.mjs';
import { sync } from './lib/sync.mjs';
import { MODES, SKILL_NAMES, VENDOR_DIR, normalizeMode, readState, resolveDataRoot, writeState } from './lib/paths.mjs';

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root' || a === '--mode') {
      flags[a.slice(2)] = argv[++i];
    } else if (a === '--force') {
      flags.force = true;
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

const out = (s) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);

function cmdRules(flags) {
  out(buildRuleset(flags.mode, flags.root));
}

function cmdSkill(flags, pos) {
  const name = pos[0];
  if (!SKILL_NAMES.includes(name)) {
    process.stderr.write(`未知技能 ${name || '(空)'}；可选: ${SKILL_NAMES.join(', ')}\n`);
    process.exit(2);
  }
  out(loadSkillBody(name, flags.root));
}

function cmdMode(flags, pos) {
  const dataRoot = resolveDataRoot(flags.root);
  const action = pos[0] || 'get';

  if (action === 'get') {
    out(readState(dataRoot).mode);
    return;
  }
  if (action !== 'set') {
    process.stderr.write(`mode 子命令只有 get / set；可选强度: ${MODES.join(', ')}\n`);
    process.exit(2);
  }

  const level = normalizeMode(pos[1]);
  if (!level) {
    process.stderr.write(`强度必须是 ${MODES.join(' | ')} 之一\n`);
    process.exit(2);
  }
  if (!dataRoot) {
    process.stderr.write('无法持久化：没有可写数据目录（缺 --root，且 PLUGIN_DATA 未设置）\n');
    process.exit(3);
  }
  writeState(dataRoot, { mode: level });
  out(level);
}

function cmdStatus(flags) {
  const info = sourceInfo(flags.root);
  const live = info.live === VENDOR_DIR
    ? '包内快照 vendor/（尚未同步，或处于只读模式）'
    : `已同步上游 ${info.version}`;
  const lines = [
    `上游版本    ${info.version ?? '未知'}${info.pinnedVersion ? `（包内钉版 ${info.pinnedVersion}）` : ''}`,
    `内容来源    ${live}`,
    `当前强度    ${info.mode}`,
    `可写数据根  ${info.dataRoot ?? '无（只读模式）'}`,
    `上次检查    ${info.lastCheck ? new Date(info.lastCheck).toLocaleString('zh-CN') : '从未'}`,
  ];
  if (info.lastError) lines.push(`上次异常    ${info.lastError}`);
  out(lines.join('\n'));
}

async function cmdUpdate(flags) {
  const dataRoot = resolveDataRoot(flags.root);
  const r = await sync(dataRoot, { force: flags.force === true });
  if (!r.ok) {
    process.stderr.write(`同步未完成: ${r.reason}\n`);
    process.exit(1);
  }
  const zh = { updated: '已更新', 'already-latest': '已是最新', throttled: '24h 内已检查，已跳过' };
  out(`${zh[r.reason] ?? r.reason}${r.version ? `：${r.version}` : ''}`);
}

async function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const cmd = pos.shift();
  switch (cmd) {
    case 'rules': return cmdRules(flags);
    case 'skill': return cmdSkill(flags, pos);
    case 'mode': return cmdMode(flags, pos);
    case 'status': return cmdStatus(flags);
    case 'update': return await cmdUpdate(flags);
    default:
      process.stderr.write(
        '用法: ponytail.mjs <rules|skill|mode|status|update> [选项]\n' +
          `  rules [--mode <${MODES.join('|')}>] [--root DIR]\n` +
          `  skill <${SKILL_NAMES.join('|')}> [--root DIR]\n` +
          '  mode get | mode set <level> [--root DIR]\n' +
          '  status [--root DIR]\n' +
          '  update [--force] [--root DIR]\n',
      );
      process.exit(2);
  }
}

main()
  .catch((e) => {
    process.stderr.write(`${e?.message || e}\n`);
    process.exit(1);
  })
  // 干完就退。update 走网络，被中止的请求会让 undici 的连接收尾拖住事件循环，
  // 实测多等约 4s——对交互式命令是白等。命令都是短命的，没有留着的理由。
  .finally(() => {
    setImmediate(() => process.exit(process.exitCode ?? 0));
  });
