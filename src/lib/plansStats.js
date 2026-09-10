// src/lib/plansStats.js —— plans.json 对标统计：每角色 Top 音擎/驱动盘套装 + 推荐方案三档（low/mid/high）统计，纯函数（Node 与浏览器共用）
// 用途：角色面板「角色配装对标」卡片里与 workshop-grad（全服实况）并排对比「方案推荐」侧数据，并分析差异；
//       三档统计（computeRecTierStats）供 wsRoles.js → goalView/metaOverview，并作为目标合成 synthTarget 的 tierStat 输入。
// （2026-09 并入 panelBench.js——同源 plans.json 的统计函数一家。）
import { sd, median, cv, quantileSorted } from './distStats.js';

/** 组合内套装件数（num/cnt 字段兼容） */
const setCount = (s) => Number(s?.num ?? s?.cnt ?? 0);

/**
 * 套装组合文本顺序归一化：件数降序（4 件套在前、2 件套在后，同件数按名称排序）。
 * 工坊（set_info 顺序不固定）与方案（原件数升序）两源经此归一后同名组合文本一致；sets 输出均带 num 字段。
 */
export function orderComboSets4First(sets) {
  const sorted = [...(sets || [])].sort(
    (a, b) => setCount(b) - setCount(a) || String(a.name ?? '').localeCompare(String(b.name ?? ''))
  );
  return {
    name: sorted.map((s) => `${s.name}${setCount(s)}`).join('+'),
    sets: sorted.map((s) => ({ ...s, num: setCount(s) })),
  };
}

/**
 * 每角色 Top 3 音擎 / 套装组合及占比（按方案出现次数计，percent 保留 1 位小数）。
 * relics 按「套装组合」统计（与 workshop-grad 结构一致，组合内 4 件套在前、2 件套在后）。
 */
export function computeRoleBuildsFromPlans(plans) {
  const out = {};
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name) continue;
    const wCount = {};
    const rCount = {}; // 组合名 -> {count, sets}
    for (const p of v.plans || []) {
      if (p.weapon?.main) wCount[p.weapon.main] = (wCount[p.weapon.main] || 0) + 1;
      if (p.weapon?.backup) wCount[p.weapon.backup] = (wCount[p.weapon.backup] || 0) + 1;
      // 组合顺序归一：同组合不同顺序视为同一
      const sets = (p.sets || []).filter((s) => s && s.name);
      if (!sets.length) continue;
      const { name: comboName, sets: sortedSets } = orderComboSets4First(sets);
      if (!rCount[comboName])
        rCount[comboName] = { count: 0, sets: sortedSets.map((s) => ({ name: s.name, num: s.num })) };
      rCount[comboName].count++;
    }
    const top = (count, n) => {
      const total = Object.values(count).reduce((s, c) => s + c, 0);
      return Object.entries(count)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([name, c]) => ({ name, percent: total ? Math.round((c / total) * 1000) / 10 : 0 }));
    };
    const topRelics = (n) => {
      const total = Object.values(rCount).reduce((s, r) => s + r.count, 0);
      return Object.entries(rCount)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, n)
        .map(([name, r]) => ({ name, sets: r.sets, percent: total ? Math.round((r.count / total) * 1000) / 10 : 0 }));
    };
    out[v.name] = { wengines: top(wCount, 3), relics: topRelics(3) };
  }
  return out;
}

// ---------- 角色配装对标（我的 | 推荐 | 真实玩家，自旧 buildBench.js 并入） ----------
// 纯函数、依赖注入（Node 与浏览器共用）：推荐侧 = computeRoleBuildsFromPlans 单角色结果、
// 真实玩家侧 = workshop-grad 单角色实况，「我的」侧由账号角色模型派生。
// 只产出结构化对照数据（原始名/占比/套装组合），图标与规范名解析是 web 层职责（findLibraryWengine 等）。

/** 玩家当前套装组合：6 盘按 set 计数推导（≥4 = 4 件套、≥2 = 2 件套、1 件不计），组合顺序归一（4 件套在前）。 */
export function mySetCombo(discs) {
  const count = {};
  for (const d of discs || []) {
    if (!d || !d.set) continue;
    count[d.set] = (count[d.set] || 0) + 1;
  }
  const combo = Object.entries(count)
    .map(([name, c]) => ({ name, num: c >= 4 ? 4 : c >= 2 ? 2 : 0 }))
    .filter((x) => x.num > 0);
  if (!combo.length) return null;
  return orderComboSets4First(combo);
}

/**
 * 三方配装对标：我的 vs 方案推荐 Top3 vs 真实玩家 Top3（音擎 + 套装组合）。
 * 输出原始名（不含图标/规范名解析——那是 web 层职责）；真实玩家侧跳过「其他」占位项。
 * 我的为单条，推荐/真实玩家为 Top3 数组（缺则空数组，web 层渲染「—」）。
 */
export function computeBuildBench({ my, planBuild, gradRole }) {
  const planW = (planBuild?.wengines || []).slice(0, 3);
  const planR = (planBuild?.relics || []).slice(0, 3);
  const gradWeapons = (gradRole?.weapons || []).filter((w) => w && w.name !== '其他').slice(0, 3);
  const gradRelics = (gradRole?.relics || []).filter((r) => r && r.name !== '其他').slice(0, 3);
  const myW = my?.wengine?.name ? { name: my.wengine.name, refinement: my.wengine.refinement || 0 } : null;
  const myR = mySetCombo(my?.discs);
  return {
    wengine: {
      mine: myW,
      rec: planW.map((w) => ({ name: w.name, percent: w.percent })),
      live: gradWeapons.map((w) => ({ name: w.name, percent: w.percent })),
    },
    sets: {
      mine: myR ? { name: myR.name, sets: myR.sets } : null,
      rec: planR.map((r) => ({ name: r.name, sets: r.sets, percent: r.percent })),
      live: gradRelics.map((r) => ({ name: r.name, sets: r.sets, percent: r.percent })),
    },
  };
}

// ---------- 推荐方案三档统计（原 panelBench.js，2026-09 并入） ----------

/** 一档值的统计：MAD 排除离群（哨兵值/异常方案）后算 mean/median/sd/cv；排除后样本 <3 视为该档不可靠返回 null */
function tierStat(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = quantileSorted(s, 0.5); // s 已排序 → 直接取分位，别再让 median() 内部重新拷贝排序
  // MAD（中位数绝对偏差）离群排除：|v-median| > 3×1.4826×MAD 视为离群（对偏态稳健，可排除哨兵如生命 100000/攻击 10000）
  const absDev = s.map((v) => Math.abs(v - m)); // 不单调，未排序 → 交给 median() 排序
  const mad = median(absDev) * 1.4826;
  const threshold = mad ? 3 * mad : Infinity;
  const clean = s.filter((v) => Math.abs(v - m) <= threshold);
  if (clean.length < 3) return null;
  const mean = clean.reduce((a, v) => a + v, 0) / clean.length;
  const sdv = sd(clean, mean);
  return {
    count: clean.length,
    mean,
    median: quantileSorted(clean, 0.5),
    sd: sdv,
    cv: cv(clean, mean),
    outliers: s.length - clean.length,
  };
}

/**
 * 推荐三档统计：每角色每属性 low/mid/high 的 mean/median/sd/CV。
 * 过滤 low=mid=0 的占位属性（冲击力/异常掌控等方案里只有 high 有值或无值，三档统计无意义）→ low/mid 置 null。
 * cv 用于「共识度」（推荐体系指标）。
 */
export function computeRecTierStats(plans) {
  const acc = {}; // 角色名 -> {属性: {low:[], mid:[], high:[]}}
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name) continue;
    const byAttr = (acc[v.name] ??= {});
    for (const p of v.plans || []) {
      for (const q of p.panel || []) {
        if (!q || q.name == null) continue;
        const t = (byAttr[q.name] ??= { low: [], mid: [], high: [] });
        if (q.low != null) t.low.push(q.low);
        if (q.mid != null) t.mid.push(q.mid);
        if (q.high != null) t.high.push(q.high);
      }
    }
  }
  const out = {};
  for (const [name, byAttr] of Object.entries(acc)) {
    out[name] = {};
    for (const [attr, tiers] of Object.entries(byAttr)) {
      const low = tierStat(tiers.low);
      const mid = tierStat(tiers.mid);
      const high = tierStat(tiers.high);
      if (low && low.median === 0 && mid && mid.median === 0) {
        out[name][attr] = { low: null, mid: null, high };
      } else {
        out[name][attr] = { low, mid, high };
      }
    }
  }
  return out;
}
