#!/usr/bin/env node
// 安装自检：校验一个 MiniMax Plugin V1 本地包的清单与能力声明。
// 自包含单文件，可随仓库分发，用户装完跑一次确认没装坏。
//
//   node tools/validate-package.mjs [插件目录]
//
// 退出码 0 = 通过；1 = 有失败项。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'ponytail'));
const CATEGORIES = new Set([
  'Office', 'Studio', 'Design & Sites', 'Code', 'Business', 'Sales',
  'Productivity', 'Science & Healthcare', 'Education', 'Other',
]);
const NAME_RE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SEG_RE = /^[A-Za-z0-9._-]+$/;
const EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop', 'PreCompact', 'PostCompact',
]);
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

const errors = [];
const ok = [];
const fail = (m) => errors.push(m);

// ── 严格 JSON：JSON.parse 静默接受重复键与尾逗号，规范要求都拒掉 ──
function parseJsonStrict(text, where) {
  let i = 0;
  const dup = [];
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i += 1; };
  const die = (m) => { throw new Error(`${where}: ${m} (第 ${text.slice(0, i).split('\n').length} 行)`); };
  const str = () => {
    if (text[i] !== '"') die('期望字符串');
    i += 1;
    let out = '';
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        const c = text[i + 1];
        const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
        if (c === 'u') { out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)); i += 6; continue; }
        if (!(c in map)) die(`非法转义 \\${c}`);
        out += map[c]; i += 2; continue;
      }
      if (text[i] === '\n') die('字符串里出现裸换行');
      out += text[i]; i += 1;
    }
    if (i >= text.length) die('字符串未闭合');
    i += 1;
    return out;
  };
  const val = () => {
    ws();
    const c = text[i];
    if (c === '{') {
      i += 1; const o = {}; const seen = new Set(); ws();
      if (text[i] === '}') { i += 1; return o; }
      for (;;) {
        ws();
        const k = str();
        if (seen.has(k)) dup.push(k);
        seen.add(k);
        ws();
        if (text[i] !== ':') die('期望冒号');
        i += 1;
        o[k] = val();
        ws();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === '}') { i += 1; return o; }
        die('期望逗号或右花括号');
      }
    }
    if (c === '[') {
      i += 1; const a = []; ws();
      if (text[i] === ']') { i += 1; return a; }
      for (;;) {
        a.push(val());
        ws();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === ']') { i += 1; return a; }
        die('期望逗号或右方括号');
      }
    }
    if (c === '"') return str();
    for (const [lit, v] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(lit, i)) { i += lit.length; return v; }
    }
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (m) { i += m[0].length; return Number(m[0]); }
    die(`非法 token ${JSON.stringify(c)}`);
    return undefined;
  };
  const root = val();
  ws();
  if (i !== text.length) die('根之后有多余内容');
  return { root, dup };
}

// YAML 块标量 description: > / | 的正文是后续所有缩进行。
// 用 /^description:.*$/m 抓会因非贪婪只截到 ">"，所以按行解析。
function extractDescription(fm) {
  const lines = fm.split(/\r?\n/);
  const i = lines.findIndex((l) => /^description\s*:/.test(l));
  if (i < 0) return null;
  const head = lines[i].replace(/^description\s*:\s*/, '').trim();
  if (head && !/^[>|][-+]?$/.test(head)) return head;
  const out = [];
  for (let j = i + 1; j < lines.length; j += 1) {
    if (lines[j].trim() === '') { out.push(''); continue; }
    if (!/^\s/.test(lines[j])) break;
    out.push(lines[j].trim());
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

// 目录也要校验：只看文件的话，「空目录 + 非法目录名」能整段溜过去
function walk(dir, files = [], dirs = []) {
  if (!fs.existsSync(dir)) return { files, dirs };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) fail(`符号链接不允许: ${path.relative(ROOT, p)}`);
    else if (e.isDirectory()) { dirs.push(p); walk(p, files, dirs); }
    else if (e.isFile()) files.push(p);
    else fail(`非常规文件不允许: ${path.relative(ROOT, p)}`);
  }
  return { files, dirs };
}

if (!fs.existsSync(ROOT)) {
  console.error(`目录不存在: ${ROOT}`);
  process.exit(1);
}

const { files: allFiles, dirs: allDirs } = walk(ROOT);

// ── 规模上限 ──
if (allFiles.length > 1024) fail(`常规文件 ${allFiles.length} > 1024`);
let bytes = 0;
for (const f of allFiles) {
  const st = fs.statSync(f);
  bytes += st.size;
  if (st.size > 16 * 1024 * 1024) fail(`单文件超 16MiB: ${path.relative(ROOT, f)}`);
}
if (bytes > 64 * 1024 * 1024) fail(`总字节超 64MiB`);
ok.push(`文件 ${allFiles.length} 个 / ${(bytes / 1024).toFixed(0)} KiB`);

// ── 路径段 + 大小写不敏感碰撞 ──
const seen = new Map();
for (const p of [...allFiles, ...allDirs]) {
  const rel = path.relative(ROOT, p);
  if (rel.includes('\\')) fail(`反斜杠路径: ${rel}`);
  const segs = rel.split(path.sep);
  if (segs.length > 16) fail(`路径段数 > 16: ${rel}`);
  for (const s of segs) {
    if (!SEG_RE.test(s)) fail(`路径段不合法 "${s}": ${rel}`);
    if (s.endsWith('.')) fail(`路径段以点结尾 "${s}": ${rel}`);
    if (RESERVED.test(s)) fail(`Windows 保留名 "${s}": ${rel}`);
  }
  const low = rel.toLowerCase();
  if (seen.has(low)) fail(`大小写不敏感路径冲突: ${rel} vs ${seen.get(low)}`);
  seen.set(low, rel);
}

// ── 清单 ──
let m = null;
const manifestPath = path.join(ROOT, '.minimax-plugin', 'plugin.json');
if (!fs.existsSync(manifestPath)) {
  fail('缺 .minimax-plugin/plugin.json');
} else {
  const text = fs.readFileSync(manifestPath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) fail('plugin.json 带 BOM');
  if (!text.endsWith('\n')) fail('plugin.json 未以换行结尾');
  let dup = [];
  try {
    ({ root: m, dup } = parseJsonStrict(text, '.minimax-plugin/plugin.json'));
  } catch (e) {
    fail(`plugin.json 不是合法 JSON: ${e.message}`);
  }
  for (const d of dup) fail(`JSON 重复键: "${d}"`);
  if (m && !dup.length) ok.push('plugin.json 严格 JSON 解析通过（无重复键/无尾逗号/无注释）');
}

if (m) {
  const allowed = new Set([
    'schemaVersion', 'name', 'displayName', 'version', 'description', 'author',
    'icon', 'darkIcon', 'category', 'exampleQueries', 'apps', 'mcpServers', 'skills', 'hooks', '$schema',
  ]);
  for (const k of Object.keys(m)) if (!allowed.has(k)) fail(`清单未知字段: ${k}`);
  for (const r of ['schemaVersion', 'name', 'version', 'description', 'author', 'icon', 'category', 'exampleQueries', 'apps', 'mcpServers', 'skills']) {
    if (!(r in m)) fail(`清单缺必填字段: ${r}`);
  }
  if (m.schemaVersion !== 1) fail(`schemaVersion 必须是 1，实为 ${m.schemaVersion}`);
  if (!NAME_RE.test(m.name ?? '')) fail(`name 不合法: ${m.name}`);
  if (m.name !== path.basename(ROOT)) fail(`name (${m.name}) 与目录名 (${path.basename(ROOT)}) 不一致`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(m.version ?? '')) fail(`version 非 SemVer: ${m.version}`);
  if (!CATEGORIES.has(m.category)) fail(`category 非法: ${m.category}`);
  if (!Array.isArray(m.exampleQueries) || !m.exampleQueries.length) fail('exampleQueries 必须是非空数组');
  else m.exampleQueries.forEach((q, i) => { if (typeof q !== 'string' || !q.trim()) fail(`exampleQueries[${i}] 无非空白文本`); });
  if (!Array.isArray(m.apps) || m.apps.length) fail('apps 必须为空数组（本地 App 能力被忽略）');

  for (const field of ['icon', 'darkIcon']) {
    const rel = m[field];
    if (!rel) continue;
    if (path.isAbsolute(rel) || rel.includes('..') || rel.includes('\\')) { fail(`${field} 路径不合法: ${rel}`); continue; }
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { fail(`${field} 指向的文件不存在: ${rel}`); continue; }
    const ext = path.extname(rel).toLowerCase();
    const b = fs.readFileSync(abs);
    const magicOk =
      (ext === '.png' && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') ||
      (['.jpg', '.jpeg'].includes(ext) && b[0] === 0xff && b[1] === 0xd8) ||
      (ext === '.webp' && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP');
    if (!magicOk) fail(`${field} 字节与扩展名不符: ${rel}`);
    else ok.push(`${field} = ${rel} (${b.length} 字节)`);
  }

  let n = 0;
  for (const rel of m.skills ?? []) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { fail(`技能文件不存在: ${rel}`); continue; }
    const mm = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    if (!mm) { fail(`技能路径必须是 skills/<name>/SKILL.md: ${rel}`); continue; }
    const text = fs.readFileSync(abs, 'utf8');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    if (!fm) { fail(`${rel} 缺 YAML frontmatter`); continue; }
    const nameM = /^name:\s*(.+)$/m.exec(fm[1]);
    if (!nameM) fail(`${rel} frontmatter 缺 name`);
    else if (nameM[1].trim() !== mm[1]) fail(`${rel} name (${nameM[1].trim()}) ≠ 目录名 (${mm[1]})`);
    const d = extractDescription(fm[1]);
    if (d === null) fail(`${rel} frontmatter 缺 description`);
    else if (d.length < 20) fail(`${rel} description 过短，可能没说明触发条件`);
    n += 1;
  }
  if (n) ok.push(`技能 ${n} 个，frontmatter name 与目录名一致`);

  for (const key of ['skills', 'hooks', 'mcpServers']) {
    for (const rel of m[key] ?? []) {
      if (path.isAbsolute(rel) || rel.includes('..') || rel.includes('\\')) fail(`${key} 引用越界: ${rel}`);
      else if (!fs.existsSync(path.join(ROOT, rel))) fail(`${key} 引用不存在: ${rel}`);
    }
  }

  // 至少一项有效能力
  const hasMcp = Array.isArray(m.mcpServers) && m.mcpServers.length > 0;
  let hasSkills = false;
  try { hasSkills = fs.readdirSync(path.join(ROOT, 'skills')).length > 0; } catch { /* 无 skills 目录 */ }
  const hasHooks = fs.existsSync(path.join(ROOT, 'hooks/hooks.json'));
  if (!hasMcp && !hasSkills && !hasHooks) fail('没有有效能力（MCP/Skill/Hook）');
  else ok.push(`有效能力: skills=${hasSkills} hooks=${hasHooks} mcp=${hasMcp}`);
}

// ── Hook 文档 ──
const hookPath = path.join(ROOT, 'hooks/hooks.json');
if (fs.existsSync(hookPath)) {
  const h = path.relative(ROOT, hookPath);
  let doc = null;
  try {
    const p = parseJsonStrict(fs.readFileSync(hookPath, 'utf8'), h);
    doc = p.root;
    for (const d of p.dup) fail(`${h} 重复键 ${d}`);
  } catch (e) {
    fail(`${h} 不是合法 JSON: ${e.message}`);
  }
  if (doc) {
    let total = 0;
    for (const [ev, groups] of Object.entries(doc.hooks ?? {})) {
      if (!EVENTS.has(ev)) { fail(`${h}: 不支持的事件 ${ev}`); continue; }
      for (const g of groups) {
        if (g.matcher !== undefined && (typeof g.matcher !== 'string' || g.matcher.length > 256)) {
          fail(`${h}/${ev} matcher 非法`);
        }
        for (const hd of g.hooks ?? []) {
          total += 1;
          for (const k of Object.keys(hd)) {
            if (!['type', 'command', 'commandWindows', 'timeout'].includes(k)) fail(`${h}/${ev} 不支持的 handler 字段 ${k}`);
          }
          if (hd.type !== 'command') fail(`${h}/${ev} 必须是同步 type=command，实为 ${hd.type}`);
          if (!hd.command || !hd.command.trim()) fail(`${h}/${ev} command 为空`);
          if (hd.timeout !== undefined && (!Number.isInteger(hd.timeout) || hd.timeout < 1 || hd.timeout > 10)) {
            fail(`${h}/${ev} timeout 必须在 1..10 整数`);
          }
          if (!/\$\{PLUGIN_ROOT\}/.test(hd.command ?? '')) fail(`${h}/${ev} command 应使用 \${PLUGIN_ROOT}`);
          const ref = /\$\{PLUGIN_ROOT\}[\\/]([\w./-]+)/.exec(hd.command ?? '');
          if (ref && !fs.existsSync(path.join(ROOT, ref[1].split(/[\\/]/).join('/')))) {
            fail(`${h}/${ev} command 引用脚本不存在: ${ref[1]}`);
          }
        }
      }
    }
    if (total > 64) fail(`${h} handler 总数 ${total} > 64`);
    ok.push(`${h}: ${total} 个同步 command handler，事件/字段/超时/路径合规`);
  }
}

console.log(`校验目标: ${ROOT}\n\n通过项:`);
for (const n of ok) console.log('  ✓', n);
if (errors.length) {
  console.log('\n失败项:');
  for (const e of errors) console.log('  ✗', e);
  process.exit(1);
}
console.log('\n全部通过。');
