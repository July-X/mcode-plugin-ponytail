// 钩子与 CLI 的收尾。
//
// 为什么需要显式退出：网络请求被 AbortSignal.timeout() 中止后，undici 的连接收尾
// 不一定立即完成，事件循环会被吊住。实测一次同步「脚本逻辑 5.5s 完成、进程 9.4s 才退出」，
// 多出的 ~4s 全部花在等 socket 上——足以把钩子顶穿它自己声明的 10s 上限，
// 运行时会把命令杀掉，表现为「会话启动莫名其妙很慢」，而且只在有请求被中止时出现。
//
// 两条纪律：
//  1. stdout 写完再退，且要等 drain，否则管道场景下 JSON 会被截断成半个对象。
//  2. 看门狗用绝对墙钟兜底，不依赖任何一条 await 路径都能正常返回。

/** 在 ms 毫秒后强制退出，防止任何路径把钩子拖过它声明的 timeout。返回取消函数。 */
export function armWatchdog(ms, label) {
  const t = setTimeout(() => {
    process.stderr.write(`[ponytail] 看门狗触发：超过 ${ms}ms 未收尾，强制退出（${label}）\n`);
    process.exit(0);
  }, ms);
  return () => clearTimeout(t);
}

/** 写出 payload（缺省补换行）并安全退出。 */
export function writeAndExit(payload) {
  const text = payload.endsWith('\n') ? payload : `${payload}\n`;
  if (process.stdout.write(text)) process.exit(0);
  process.stdout.once('drain', () => process.exit(0));
}
