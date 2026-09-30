// 规则集读取 + 强度裁剪。
//
// 裁剪逻辑移植自上游 hooks/ponytail-instructions.js（MIT, Dietrich Gebert），
// 逐条保持同样的语义：只按「以模式名做标签的行」过滤，其余行原样保留。
// 这一点很容易做错——上游的注释专门警告过：以模式词开头的普通规则行
// （例如 "- Full: ..."）看起来像示例，其实是正文，误判会在别的模式下被整行删掉。
// 所以下面两处都要求标签出现在结构位置（表格首列 / 冒号前的引号值）上。

import fs from 'node:fs';
import path from 'node:path';
import {
  PACKAGE_ROOT,
  SKILL_NAMES,
  VENDOR_DIR,
  normalizeMode,
  readPinned,
  readState,
  resolveDataRoot,
  DEFAULT_MODE,
} from './paths.mjs';

function stripFrontmatter(body) {
  return String(body || '').replace(/^---[\s\S]*?---\s*/, '');
}

/** 按强度裁剪规则集正文。mode 非法时回落到默认强度，不抛错。 */
export function filterSkillBodyForMode(body, mode) {
  const effective = normalizeMode(mode) || DEFAULT_MODE;
  return stripFrontmatter(body)
    .split(/\r?\n/)
    .filter((line) => {
      // 强度表的行：| **full** | ... |
      const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
      if (tableLabel) {
        const labelMode = normalizeMode(tableLabel[1].trim());
        if (labelMode) return labelMode === effective;
      }
      // 示范行：- full: "..."（必须有引号，否则会误伤普通正文行）
      const exampleLabel = line.match(/^-\s*([^:]+):\s*"/);
      if (exampleLabel) {
        const labelMode = normalizeMode(exampleLabel[1].trim());
        if (labelMode) return labelMode === effective;
      }
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 活动技能根：优先已同步的上游版本，没有就退回包内 vendor 快照。 */
export function contentRoot(rootArg) {
  const dataRoot = resolveDataRoot(rootArg);
  if (dataRoot) {
    const st = readState(dataRoot);
    if (st.activeDir) {
      const abs = path.join(dataRoot, st.activeDir);
      if (fs.existsSync(path.join(abs, 'skills', 'ponytail', 'SKILL.md'))) return abs;
    }
  }
  return VENDOR_DIR;
}

/** 当前生效的来源说明，用于状态查询和技能里的「数据从哪来」交代。 */
export function sourceInfo(rootArg) {
  const dataRoot = resolveDataRoot(rootArg);
  const st = readState(dataRoot);
  const live = contentRoot(rootArg);
  const pinned = readPinned();
  return {
    dataRoot,
    readOnly: !dataRoot,
    version: live === VENDOR_DIR ? pinned?.version ?? null : st.version,
    mode: st.mode,
    live,
    pinnedVersion: pinned?.version ?? null,
    lastCheck: st.lastCheck,
    lastError: st.lastError,
  };
}

/** 读单个技能的正文（去 frontmatter）。 */
export function loadSkillBody(name, rootArg) {
  if (!SKILL_NAMES.includes(name)) throw new Error(`未知技能: ${name}`);
  return stripFrontmatter(
    fs.readFileSync(path.join(contentRoot(rootArg), 'skills', name, 'SKILL.md'), 'utf8'),
  ).trim();
}

/**
 * 产出「当前强度的规则集」——技能拿到这段就等于拿到上游激活内容。
 * 拼上头部声明，让模型知道档位与切换方式。
 */
export function buildRuleset(mode, rootArg) {
  const effective = normalizeMode(mode) || readState(resolveDataRoot(rootArg)).mode || DEFAULT_MODE;
  const info = sourceInfo(rootArg);
  const header =
    `PONYTAIL ACTIVE — level: ${effective}` +
    `（上游 ${info.version ?? '未知版本'}，来源 ${info.live === VENDOR_DIR ? '包内钉版快照' : '已同步上游'}）\n` +
    `Switch: \`ponytail lite|full|ultra|off\`. Off only on explicit request.\n`;
  return `${header}\n${filterSkillBodyForMode(loadSkillBody('ponytail', rootArg), effective)}`;
}

export { PACKAGE_ROOT };
