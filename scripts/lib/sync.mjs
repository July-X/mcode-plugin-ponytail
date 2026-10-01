// 上游同步引擎。
//
// 语义：把上游 DietrichGebert/ponytail 的 6 个技能镜像到 PLUGIN_DATA/upstream/<tag>/，
// 检出新 tag 就原子切换活动版本。包体 vendor/ 永远保持钉版快照，不被改写。
//
// 三条安全纪律：
//  1. tag 进路径前必须过 safeTag —— 不校验等于让远端决定我们写到哪里。
//  2. 先写临时目录、6 个文件全部就位且校验通过才 rename 切换 —— 半截镜像绝不生效。
//  3. 每个网络请求都有硬超时，整体 try/catch 失败即静默 —— 钩子不能因为断网报错。
//
// 降级：主规则集（skills/ponytail）是核心，缺了整次更新放弃；其余 5 个附属技能
// 上游若改名/删除，用包内快照补位并记进 state.partial，由 status 如实报出来。

import fs from 'node:fs';
import path from 'node:path';
import {
  GITHUB_RAW, GITHUB_WEB, NPM_MIRROR, NPM_REGISTRY,
  SKILL_NAMES, UPSTREAM_DIR, VENDOR_DIR, readState, safeTag, writeState,
} from './paths.mjs';

const REPO = 'DietrichGebert/ponytail';
const NPM_PKG = '@dietrichgebert%2Fponytail';
const RAW = (tag, rel) => `${GITHUB_RAW}/${REPO}/${tag}/${rel}`;
const UA = 'minimax-code-local-plugin-ponytail';
const KEEP_VERSIONS = 3;

// 问版本号的降级链。三条都指向同一个事实——实测 npm dist-tags.latest = 4.10.0
// 与 GitHub release v4.10.0 锁步，只是快慢差一个数量级。
// 每条给的时间片之和不超过总预算，所以「最坏情况」也是有限的几秒，不会拖死钩子。
const VERSION_SOURCES = [
  { name: 'github-releases', slice: 2500, run: (t) => viaGithubRedirect(t) },
  { name: 'npmjs', slice: 2000, run: (t) => viaRegistry(NPM_REGISTRY, t) },
  { name: 'npmmirror', slice: 2000, run: (t) => viaRegistry(NPM_MIRROR, t) },
];
// 收尾要留的时间：staging 校验 + rename 切换 + 写 state.json。
// 下载阶段的超时必须从这个余量里扣，不能「最低给 1500ms」——那会在 deadline 快到时
// 反而越过它，实测把冷启动推到 11.1s，超出钩子声明的 10s，运行时会把命令杀掉。
const TAIL_RESERVE_MS = 400;

// PONYTAIL_TRACE=1 时把各阶段耗时打到 **stderr**（不是 stdout——stdout 只留给钩子 JSON）。
// 取源站点延迟差异极大（实测 github.com 有 8s 长尾、npmmirror 常年 <150ms），
// 「更新到底卡在哪一步」不量一下是猜不出来的。
const TRACE = process.env.PONYTAIL_TRACE === '1';
const T0 = Date.now();
const trace = (msg) => {
  if (TRACE) process.stderr.write(`[ponytail +${String(Date.now() - T0).padStart(5)}ms] ${msg}\n`);
};

async function get(url, timeoutMs, redirect = 'follow') {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function getText(url, timeoutMs) {
  return (await get(url, timeoutMs)).text();
}

// 从 302 的 Location 头里取 tag：/releases/tag/v4.10.0
// 注意不能走 get()：它按 res.ok 判失败，而 302 的 ok 是 false，
// 会把成功拿到 Location 的响应当成 HTTP 302 失败抛掉 —— GitHub 这条权威源就永远用不上。
async function viaGithubRedirect(timeoutMs) {
  const res = await fetch(`${GITHUB_WEB}/${REPO}/releases/latest`, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const loc = res.headers.get('location') || '';
  if (res.status >= 300 && res.status < 400) {
    const tag = safeTag(/\/releases\/tag\/(.+)$/.exec(loc)?.[1]);
    if (!tag) throw new Error(`github 重定向里没有合法 tag: ${loc || '(空)'}`);
    return tag;
  }
  // 偶尔 github 会直接 200（不发重定向），那就退回 API
  if (res.ok) {
    const tag = safeTag(JSON.parse(await res.text())?.tag_name);
    if (tag) return tag;
  }
  throw new Error(`HTTP ${res.status}`);
}

async function viaRegistry(base, timeoutMs) {
  const body = await getText(`${base}/${NPM_PKG}`, timeoutMs);
  const tag = safeTag(JSON.parse(body)?.['dist-tags']?.latest);
  if (!tag) throw new Error('registry dist-tags.latest 不是合法 vX.Y.Z');
  return tag;
}

/**
 * 问上游要最新版本号。GitHub release 是权威（用户明确选的就是它），但给它的时间片
 * 刻意压到 3s：实测 github.com 从本机访问有 ~8s 的长尾，卡满整个预算会让每日更新
 * 经常失败。答不上就退到 npm 系——两者版本号锁步，是同一个事实的更快传输。
 */
export async function fetchLatestTag(deadline) {
  const tried = [];
  for (const src of VERSION_SOURCES) {
    const left = deadline - Date.now();
    if (left < 700) break;
    const slice = Math.min(src.slice, left);
    const s0 = Date.now();
    try {
      const tag = await src.run(slice);
      trace(`取源 ${src.name} 成功 ${tag} (${Date.now() - s0}ms)`);
      return { tag, via: src.name };
    } catch (e) {
      tried.push(`${src.name}: ${e.message}`);
      trace(`取源 ${src.name} 失败 (${Date.now() - s0}ms) ${e.message}`);
    }
  }
  throw new Error(`所有取源都不可用 — ${tried.join('; ') || '剩余时间不足'}`);
}

function skillInstalled(dir, name) {
  try {
    return fs.statSync(path.join(dir, 'skills', name, 'SKILL.md')).size > 0;
  } catch {
    return false;
  }
}

/** 只保留最近 KEEP_VERSIONS 个版本目录，活动版本永不删。 */
function prune(dataRoot, keepDir) {
  const root = path.join(dataRoot, UPSTREAM_DIR);
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  const dirs = names
    .filter((d) => d.isDirectory())
    .map((d) => {
      let mtime = 0;
      try {
        mtime = fs.statSync(path.join(root, d.name)).mtimeMs;
      } catch {
        /* 读不到就当最旧 */
      }
      return { name: d.name, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const d of dirs.slice(KEEP_VERSIONS)) {
    if (path.join(root, d.name) === keepDir) continue;
    try {
      fs.rmSync(path.join(root, d.name), { recursive: true, force: true });
    } catch {
      /* 清理失败不影响主流程 */
    }
  }
}

const DAY_MS = 24 * 3600 * 1000;
const FAIL_BACKOFF_MS = 30 * 60 * 1000;

/**
 * 是否该跳过这次检查。
 * 成功过一次 → 24h 内不再打扰上游。
 * 失败过 → 只退避 30min。**失败不能消耗每日额度**：否则一次网络抖动就意味着
 * 接下来一整天都不会再试，「每日自动更新」会静默失效一整天。
 */
export function throttled(st) {
  const now = Date.now();
  if (st.lastCheck && now - st.lastCheck < DAY_MS) return true;
  if (st.lastFail && now - st.lastFail < FAIL_BACKOFF_MS) return true;
  return false;
}

/** 记录一次失败：只记 lastFail，绝不动 lastCheck（见 throttled 的说明）。 */
function fail(dataRoot, message) {
  writeState(dataRoot, { lastFail: Date.now(), lastError: message });
}

/**
 * 同步到最新版本。
 * @param {string} dataRoot 可写数据根；为 null 表示只读模式，直接拒绝写入
 * @param {object} opts force=true 跳过「24h 内已查过」的节流
 * @returns {Promise<{ok:boolean,reason:string,version?:string,updated?:boolean}>}
 */
export async function sync(dataRoot, opts = {}) {
  if (!dataRoot) return { ok: false, reason: '只读模式：没有可写的数据目录' };
  const force = opts.force === true;
  // 总预算 8s：钩子声明 timeout=10（规范上限），普通事件共享预算 15s。
  // 留 2s 给 node 启动、收尾换名、写状态，以及网络超时不精确的抖动。
  // 实测取源最坏 ~6.5s + 下载 ~1.1s = 7.6s，加壳后仍在 10s 内。
  const budgetMs = opts.budgetMs ?? 8000;
  const deadline = Date.now() + budgetMs;

  try {
    const st = readState(dataRoot);
    const currentOk =
      st.activeDir && fs.existsSync(path.join(dataRoot, st.activeDir, 'skills')) && st.version;
    if (!force && throttled(st)) {
      return { ok: true, reason: 'throttled', version: st.version, updated: false };
    }
    // 已是最新且镜像完整 —— 只刷新检查时间，不重复下载
    const { tag, via } = await fetchLatestTag(deadline);
    if (currentOk && st.version === tag) {
      writeState(dataRoot, { lastCheck: Date.now(), lastError: null, versionSource: via });
      return { ok: true, reason: 'already-latest', version: tag, updated: false, via };
    }

    const versionDir = path.join(dataRoot, UPSTREAM_DIR, tag);
    const staging = `${versionDir}.staging-${process.pid}`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });

    const partial = [];
    // 6 个技能并发拉，不串行。串行时总耗时是 6 次往返之和，实测能把 5.9s 顶到预算上限
    // 直接超时；并发后只剩一次往返。单次超时严格从「deadline 减去收尾余量」里扣。
    const perFile = Math.max(200, Math.min(6000, deadline - Date.now() - TAIL_RESERVE_MS));
    const results = await Promise.all(
      SKILL_NAMES.map(async (name) => {
        const rel = `skills/${name}/SKILL.md`;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const body = await getText(RAW(tag, rel), perFile);
            if (!body.trim()) throw new Error('空文件');
            return { name, body };
          } catch (e) {
            if (attempt === 0 && /HTTP (403|429)/.test(String(e.message))) {
              trace(`raw ${name} 被限流，退避后重试`);
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
            return { name, error: e };
          }
        }
        return { name, error: new Error('重试耗尽') };
      }),
    );
    trace(`6 个技能下载完成 (单次超时 ${perFile}ms)`);

    for (const r of results) {
      const dest = path.join(staging, 'skills', r.name);
      fs.mkdirSync(dest, { recursive: true });
      if (r.body !== undefined) {
        fs.writeFileSync(path.join(dest, 'SKILL.md'), r.body, 'utf8');
        continue;
      }
      if (r.name === 'ponytail') {
        // 主规则集拿不到 = 这次更新没有意义，保持现有版本不动
        fs.rmSync(staging, { recursive: true, force: true });
        const msg = `主规则集拉取失败: ${r.error.message}`;
        fail(dataRoot, msg);
        return { ok: false, reason: msg, version: st.version, updated: false };
      }
      // 附属技能上游改名/删除：拿包内快照补位，缺口如实记账
      fs.copyFileSync(path.join(VENDOR_DIR, 'skills', r.name, 'SKILL.md'), path.join(dest, 'SKILL.md'));
      partial.push(r.name);
    }

    // 全部就位才切换：先删旧 staging，再把 staging 改名成正式目录
    if (fs.existsSync(versionDir)) fs.rmSync(versionDir, { recursive: true, force: true });
    fs.renameSync(staging, versionDir);

    for (const name of SKILL_NAMES) {
      if (!skillInstalled(versionDir, name)) {
        fail(dataRoot, '镜像校验失败');
        return { ok: false, reason: '镜像校验失败', version: st.version, updated: false };
      }
    }

    writeState(dataRoot, {
      version: tag,
      activeDir: path.join(UPSTREAM_DIR, tag),
      lastCheck: Date.now(),
      lastFail: 0,
      versionSource: via,
      lastError: partial.length ? `附属技能用包内快照补位: ${partial.join(', ')}` : null,
    });
    prune(dataRoot, versionDir);
    trace(`已切换到 ${tag}（附属技能补位: ${partial.join(', ') || '无'}）`);
    return { ok: true, reason: 'updated', version: tag, updated: true, partial, via };
  } catch (e) {
    // 断网 / 限流 / 超时 —— 全部按「继续用现有版本」处理
    fail(dataRoot, String(e.message || e));
    return { ok: false, reason: String(e.message || e), updated: false };
  }
}
