// scripts/workshop-cli.mjs —— 工坊数据更新命令行入口（函数实现见 src/sync/workshop.js 与 workshop-stats.js，供 server.js 按钮复用）
// 用法（全命名参数）：
//   node scripts/workshop-cli.mjs [--mode=rank|chars|grad|weights|stats|normalize|full] [--concurrency=N] [--proxy=URL]
//     rank      只更新 uid：全角色×7影画×300 排名收集 → data/workshop-uids.json（不下载角色信息，快）
//     chars     批量下载角色信息：读 workshop-uids.json（缺则报错提示先跑 --mode=rank）→ workshop.json（断点续爬）
//     grad      只更新全角色配装统计（grad_stat 独立接口）→ workshop-grad.json
//     weights   只更新全角色默认副词条权重 → workshop-weights.json（并同步 stats.weightJson）
//     stats     只重算 workshop-stats.json（读现有 grad/weights，不爬取、不重跑 grad，~2-4 分钟；改聚合代码后验证用）
//     normalize 一次性迁移：把现有 workshop.json（旧双格式）重写为规范格式（source 按 equips rarity 类型回填、值×100、删 rarity）
//     full      默认：grad → weights → rank → chars（chars 末尾自动重算 stats）
//   --proxy=URL 防封 IP（写入 HTTPS_PROXY 后以 --use-env-proxy 重拉自身；亦可直接设 HTTPS_PROXY 环境变量，二者都走 Node24 原生 env-proxy，进程内所有 fetch 生效）
// 按模式动态 import：stats/grad 只加载聚合侧（不加载 workshop.js 下载侧与 69KB 静态表），其余模式加载下载侧。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, writeJsonAtomic, tryAcquireDataLock } from '../src/lib/nodeUtil.js';

const argVal = (k) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : undefined;
};
const MODE = argVal('mode') || 'full';
// 并发数校验：Number('abc') = NaN，会静默产出 0 个 worker 白跑 2-4 分钟（曾把限流参数当任务数）
const CONCURRENCY_RAW = Number(argVal('concurrency') || 6);
const CONCURRENCY = Number.isInteger(CONCURRENCY_RAW) && CONCURRENCY_RAW >= 1 ? CONCURRENCY_RAW : 6;
const UIDS_FILE = path.join(DATA_DIR, 'workshop-uids.json');
if (!['rank', 'chars', 'grad', 'weights', 'stats', 'normalize', 'full'].includes(MODE)) {
  throw new Error(`未知 --mode=${MODE}（可选 rank|chars|grad|weights|stats|normalize|full）`);
}
// --proxy=URL：Node24 --use-env-proxy 只在进程启动时快照读 HTTPS_PROXY，进程内赋值无效，
// 故把 --proxy 写入 HTTPS_PROXY（CLI 优先于环境变量）后重拉一个带 --use-env-proxy 的子进程——其启动快照已含代理。
// 无 --proxy 但环境变量已设、且不是经 npm script（自带 flag）启动时，同样重拉一次补上 flag。
const PROXY_ARG = argVal('proxy') || process.argv[5]; // 兼容旧第 5 参
const envHasProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
if (!process.env.ZZZ_PROXY_REEXEC && (PROXY_ARG || (!process.execArgv.includes('--use-env-proxy') && envHasProxy))) {
  if (PROXY_ARG) process.env.HTTPS_PROXY = PROXY_ARG;
  process.env.ZZZ_PROXY_REEXEC = '1';
  const r = spawnSync(
    process.execPath,
    ['--use-env-proxy', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(r.status == null ? 1 : r.status);
}
// 跨进程锁：防止与运行中的 server.js（网页同步按钮）并发写 data/*.json（同名 .tmp 互相截断）。全程持有，结束释放。
const releaseDataLock = tryAcquireDataLock(`cli:${MODE}`);
if (!releaseDataLock) {
  console.error(`✗ 另一进程正在同步（data/.sync.lock 被持有，可能是运行中的服务器）。请等它结束再跑，或确认无残留后删除该文件。`);
  process.exit(1);
}

async function main() {
  if (MODE === 'rank') {
    // 只更新 uid：全角色 × 7 影画 × 300 排名收集 → 落盘 uid 集合（供 --mode=chars 用），不下载角色信息
    const { collectRankings } = await import('../src/sync/workshop.js');
    const { uidMap } = await collectRankings(undefined, CONCURRENCY);
    writeJsonAtomic(UIDS_FILE, { scrapedAt: new Date().toISOString(), uids: [...uidMap.keys()] });
    console.log(`uid 集合 ${uidMap.size} 个已保存到 ${UIDS_FILE}（--mode=chars 将用它批量下载角色信息）`);
    return;
  }
  if (MODE === 'chars') {
    // 批量下载角色信息：读 workshop-uids.json（必须先跑过 --mode=rank），断点续爬写 workshop.json + 权重 + 汇总
    const { buildCtx, fetchBuilds } = await import('../src/sync/workshop.js');
    const { ctx, roles } = await buildCtx();
    let uidList = null;
    if (fs.existsSync(UIDS_FILE)) {
      try {
        uidList = JSON.parse(fs.readFileSync(UIDS_FILE, 'utf8')).uids;
      } catch {
        /* 损坏走报错 */
      }
    }
    if (!uidList || !uidList.length) {
      throw new Error('缺少 data/workshop-uids.json（或为空）：请先运行 --mode=rank 收集 uid');
    }
    await fetchBuilds(ctx, roles, uidList, undefined, CONCURRENCY);
    return;
  }
  if (MODE === 'grad') {
    // 只更新全角色配装统计（grad_stat 独立接口；仅加载聚合侧）
    const { fetchWorkshopGrad } = await import('../src/sync/workshop-stats.js');
    await fetchWorkshopGrad(undefined, 6);
    return;
  }
  if (MODE === 'weights') {
    // 只更新全角色默认副词条权重（system_data.weight_json）→ weights 文件 + 同步 stats.weightJson
    const { buildCtx, buildWeights, syncStatsWeightJson } = await import('../src/sync/workshop.js');
    const { roles } = await buildCtx();
    const weightJson = buildWeights(roles);
    syncStatsWeightJson(weightJson);
    console.log(`全角色默认副词条权重已更新到 ${path.join(DATA_DIR, 'workshop-weights.json')}`);
    return;
  }
  if (MODE === 'normalize') {
    // 一次性迁移：现有 workshop.json（旧双格式）→ 规范格式（normalizeEntry，纯函数）
    // source 按 equips rarity 类型回填（实测 100% 覆盖）；重爬时写盘路径已自动走同一 normalizeEntry，无需再次迁移
    const { normalizeEntry } = await import('../src/sync/workshop.js');
    const { iterWorkshopFile, writeWorkshopFile } = await import('../src/lib/nodeUtil.js');
    const { OUT_FILE } = await import('../src/sync/workshop-stats.js');
    const t0 = Date.now();
    let total = 0;
    let mys = 0;
    let s2025 = 0;
    let unknown = 0;
    const gen = (function* () {
      for (const e of iterWorkshopFile(OUT_FILE)) {
        total++;
        const n = normalizeEntry(e);
        if (n.source === 'mys') mys++;
        else if (n.source === '2025') s2025++;
        else unknown++;
        yield n;
      }
    })();
    // meta 带 entryCount（rebuildWorkshopStats 从文件头读它填 meta.entries；meta 可为函数按实际 count 生成）
    const count = writeWorkshopFile(OUT_FILE, gen, (n) => ({ scrapedAt: new Date().toISOString(), entryCount: n }));
    console.log(
      `workshop.json 归一化完成: ${((Date.now() - t0) / 1000).toFixed(1)}s（${total} 条 | mys=${mys} | 2025=${s2025} | unknown=${unknown}）`
    );
    console.log(count === total ? `写入 ${count} 条，与读取一致 ✓` : `⚠️ 写入 ${count} 条 ≠ 读取 ${total} 条！`);
    return;
  }
  if (MODE === 'stats') {
    // 只重算 workshop-stats.json（不爬取、不重跑 grad；仅加载聚合侧）
    const { rebuildWorkshopStats } = await import('../src/sync/workshop-stats.js');
    const t0 = Date.now();
    const stats = rebuildWorkshopStats();
    console.log(
      `workshop-stats.json 重算完成: ${((Date.now() - t0) / 1000).toFixed(1)}s（panels=${stats.panels.length} | discDetails=${stats.discDetails.length}）`
    );
    return;
  }
  // full（默认）：grad → weights → rank → chars（chars 末尾自动重算 stats）
  const { fetchWorkshopData } = await import('../src/sync/workshop.js');
  await fetchWorkshopData(undefined, { concurrency: CONCURRENCY });
}

try {
  await main();
} finally {
  releaseDataLock();
}
