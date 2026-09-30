// 路径解析 + 状态读写。
//
// 为什么单独一层：钩子（拿到 PLUGIN_DATA）和技能（没有这个环境变量）必须落到
// 同一份状态上，否则「切了强度」在另一个入口读不到。顺序是
//   1. 显式 --root   —— 技能从会话里那行 PONYTAIL 指针拿到的绝对路径，最可靠
//   2. PLUGIN_DATA   —— 规范保证钩子一定有，是权威来源
//   3. 少量探测      —— 两条最可能的全局落点，命中即用
//   4. null          —— 只读模式，一切退回包内 vendor 快照（首次安装 / 钩子没跑过）
// 三条纪律：包体只读，状态只写 PLUGIN_DATA；探测失败不报错（当只读处理）；
// 状态文件原子替换，断电/并发不会读出半个 JSON。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 插件包根（不可写，只读）。脚本自推，不依赖调用方传对。 */
export const PACKAGE_ROOT = path.resolve(HERE, '..', '..');
export const VENDOR_DIR = path.join(PACKAGE_ROOT, 'vendor');
export const STATE_FILE = 'state.json';
export const UPSTREAM_DIR = 'upstream';

/** 上游固定的 6 个技能。写死而不是从远端响应里取名，远端不能决定我们写哪些路径。 */
export const SKILL_NAMES = [
  'ponytail',
  'ponytail-review',
  'ponytail-audit',
  'ponytail-debt',
  'ponytail-gain',
  'ponytail-help',
];

export const MODES = ['lite', 'full', 'ultra', 'off'];
export const DEFAULT_MODE = 'full';

// 探测落点用 USERPROFILE/HOME，不用 homedir：GUI 程序从访达启动时 homedir 偶尔不可靠。
// 实测 Desktop 注入的 PLUGIN_DATA 形状是 <dataDir>/v2/plugin-data/hooks/<plugin-id>，
// 且 dataDir 可由 MINIMAX_DATA_DIR 改；前两条按这个实测形状排，后两条是更早期的猜测，
// 留着不花钱（探测失败只当没命中，退回只读），但**别再新增拍脑袋的路径**。
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const DATA_DIR = process.env.MINIMAX_DATA_DIR || (HOME ? path.join(HOME, '.minimax') : '');
const PROBES = [
  ...(DATA_DIR ? [path.join(DATA_DIR, 'v2', 'plugin-data', 'hooks', 'ponytail')] : []),
  ...(HOME ? [path.join(HOME, '.minimax', 'v2', 'plugin-data', 'hooks', 'ponytail')] : []),
  ...(HOME ? [path.join(HOME, '.minimax', 'plugin-data', 'ponytail')] : []),
  ...(HOME ? [path.join(HOME, '.minimax', 'plugins', '.data', 'ponytail')] : []),
];

/** 读包内钉版元数据（vendor/UPSTREAM.json）。 */
export function readPinned() {
  try {
    return JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, 'UPSTREAM.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 解析本插件的可写数据根。返回 null 表示只读模式。
 * @param {string} [explicit] 调用方显式传入的根（技能从会话指针拿到的绝对路径）
 */
export function resolveDataRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  const env = process.env.PLUGIN_DATA || process.env.MINIMAX_PLUGIN_DATA;
  if (env) return path.resolve(env);
  for (const p of PROBES) {
    try {
      if (fs.existsSync(path.join(p, STATE_FILE))) return p;
    } catch {
      /* 探测失败按没命中处理 */
    }
  }
  return null;
}

const DEFAULT_STATE = {
  schema: 1,
  mode: DEFAULT_MODE,
  version: null, // 上游 tag，例如 "v4.10.0"
  activeDir: null, // 相对 dataRoot 的路径，例如 "upstream/v4.10.0"
  lastCheck: 0, // 上次**成功**检查的 epoch ms
  lastFail: 0, // 上次失败尝试的 epoch ms，只用于短退避
  versionSource: null, // 版本号是从哪问到的：github-releases / npmjs / npmmirror
  lastError: null,
};

/** 读状态。文件缺失/损坏都回落到默认值，绝不因为状态坏掉就让功能整体瘫。 */
export function readState(dataRoot) {
  if (!dataRoot) return { ...DEFAULT_STATE };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataRoot, STATE_FILE), 'utf8'));
    return { ...DEFAULT_STATE, ...raw, mode: normalizeMode(raw.mode) || DEFAULT_MODE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** 原子写：先写同目录临时文件再 rename，避免读到写了一半的 JSON。 */
export function writeState(dataRoot, patch) {
  if (!dataRoot) return false;
  try {
    fs.mkdirSync(dataRoot, { recursive: true });
    const next = { ...readState(dataRoot), ...patch };
    const target = path.join(dataRoot, STATE_FILE);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

export function normalizeMode(m) {
  const s = String(m ?? '').trim().toLowerCase();
  return MODES.includes(s) ? s : null;
}

/**
 * 校验上游 tag 再让它进路径拼接。
 * tag 会变成目录名，不校验就等于让远端决定我们写到哪 —— 必须只收 vX.Y.Z。
 * 前导零也拒（v01.2.3），它进目录名只会制造两个长得几乎一样的版本目录。
 */
export function safeTag(tag) {
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(tag ?? '').trim());
  if (!m) return null;
  return `v${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * 取源地址。国内网络下 github.com / api.github.com 延迟极不稳定（实测 5 次里有 2 次
 * 接近 8 秒），而 raw.githubusercontent.com 与 npm registry 稳定在 0.2~2 秒。
 * 允许用环境变量换镜像；不设就用官方地址。换源只影响「从哪问版本号」，不影响
 * tag 校验与逐文件落盘，不会因此放宽任何安全判据。
 */
const env = (k, d) => (process.env[k] || d).replace(/\/+$/, '');

export const GITHUB_WEB = env('PONYTAIL_GITHUB_WEB', 'https://github.com');
export const GITHUB_RAW = env('PONYTAIL_GITHUB_RAW', 'https://raw.githubusercontent.com');
export const NPM_REGISTRY = env('PONYTAIL_NPM_REGISTRY', 'https://registry.npmjs.org');
export const NPM_MIRROR = env('PONYTAIL_NPM_MIRROR', 'https://registry.npmmirror.com');
