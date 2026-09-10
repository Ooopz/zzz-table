// src/lib/panelAdvice.js —— 角色面板视图派生数据：目标合成 + 面板分布/推荐三档 items（纯函数，浏览器 + 测试消费）。
// 唯一消费方 web/goalView.js（手风琴「目标建议」与底部「面板分布」整合图）。
// 2026-09 整理：由 goalAdvisor.js + panelItems.js 合并（同消费方同域）；percentileAt 在 distStats.js（approxPercentile 的逆运算）。
import { TARGET_PERCENTS } from '../game/index.js';
import { approxPercentile, percentileAt, histCumPct } from './distStats.js';

/** 目标合成默认参数：可达性地板分位（低于它的方案意图值提到该分位）与单盘命中理论上限 */
export const GOAL_FLOOR_Q = 0.2;

/**
 * 单属性目标合成。tierStat = 方案三档统计行（{low,mid,high:{median}}，plansStats.computeRecTierStats 产物），
 * dist = 玩家样本分布，current = 我的当前值。
 * 规则：意图值 = 方案 tier 档 median；地板 = 玩家样本 P20（`max(意图, P20)`，只托底不封顶）。
 * 回退链：方案缺该档 → 用玩家中位（source='p50'）；分布也缺 → 用方案值；两源都缺 → 返回 null（不编数）。
 */
export function synthTarget(attr, tierStat, dist, current, tier = 'high') {
  const plan = tierStat?.[tier]?.median ?? null;
  const p50 = dist?.p50 ?? null;
  if (plan == null && p50 == null) return null;
  const fromPlan = plan != null;
  const suggestion = fromPlan ? plan : p50;
  const floor = fromPlan ? percentileAt(dist, GOAL_FLOOR_Q) : null;
  const floorApplied = floor != null && suggestion < floor;
  const value = floorApplied ? floor : suggestion;
  return {
    attr,
    current: current ?? null,
    suggestion: value,
    plan, // 方案意图值（可能未修正）
    tier: fromPlan ? tier : null,
    floorApplied,
    percentile: dist ? approxPercentile(value, dist) : null, // 建议值在玩家样本的分位（0-100）
    source: fromPlan ? 'plan' : 'p50',
  };
}

/** 面板内部值 → user-config 整数口径（暴击/暴伤/穿透率/伤加按 % 存整数：0.6 → 60）。非有限值返回 null。 */
export function toTargetDisplay(attr, value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(TARGET_PERCENTS.has(attr) ? value * 100 : value);
}

// ---------- 面板分布 items ----------

/** 有玩家样本（count ≥ minCount）的属性名列表 */
const attrsWithSample = (dist, minCount) => Object.keys(dist || {}).filter((a) => dist[a]?.count >= (minCount ?? 30));

/** 组合项：每属性含 玩家分布 / 推荐三档(median±sd) / 我的值+百分位 / 目标值+百分位——消费方按需取用。
 *  依赖注入：dist = 每属性玩家分布 map（workshop-stats.panels[role]）、rec = 每属性推荐三档 map、
 *           myFinal = 我的面板 final、targets = 已设目标 map（内部值口径，未设属性缺席）。
 *  与原 violinAttrs 同口径（全部 count≥minCount 的属性）。 */
export function buildPanelItems({ dist, rec, myFinal, targets, minCount = 30 }) {
  return attrsWithSample(dist, minCount).map((a) => {
    const recA = rec?.[a];
    const d = dist[a];
    const t = targets?.[a];
    const tVal = Number.isFinite(t) ? t : null;
    return {
      attr: a,
      dist: d,
      player: { p10: d?.p10 ?? null, p90: d?.p90 ?? null },
      low: recA?.low ? { median: recA.low.median, sd: recA.low.sd } : null,
      mid: recA?.mid ? { median: recA.mid.median, sd: recA.mid.sd } : null,
      high: recA?.high ? { median: recA.high.median, sd: recA.high.sd } : null,
      mine: myFinal?.[a] ?? null,
      // 直方图累计分位（面板分布图分位轴定位用，与密度同口径）；缺 hist 回退五档锚点近似
      minePct: histCumPct(myFinal?.[a], d?.hist) ?? approxPercentile(myFinal?.[a], d),
      // 已设目标（内部值）+ 其玩家分位（面板分布图目标标记定位用）；未设目标 = null
      target: tVal,
      targetPct: tVal != null ? (histCumPct(tVal, d?.hist) ?? approxPercentile(tVal, d)) : null,
    };
  });
}
