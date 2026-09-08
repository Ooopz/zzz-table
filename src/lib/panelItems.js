// src/lib/panelItems.js —— 角色面板分布/推荐三档 items 的唯一构建源（纯函数，Node 与浏览器共用）。
// 手风琴底部「面板分布」整合图用（buildPanelItems）；诊断侧的 violin/tier items 构建已随角色诊断删除。
// 依赖注入：dist = 每属性玩家分布 map（workshop-stats.panels[role]）、rec = 每属性推荐三档 map、
//           myFinal = 我的面板 final、targets = 已设目标 map（内部值口径，未设属性缺席）。
import { approxPercentile, histCumPct } from './distStats.js';

/** 有玩家样本（count ≥ minCount）的属性名列表 */
const attrsWithSample = (dist, minCount) => Object.keys(dist || {}).filter((a) => dist[a]?.count >= (minCount ?? 30));

/** 组合项：每属性含 玩家分布 / 推荐三档(median±sd) / 我的值+百分位 / 目标值+百分位——消费方按需取用。
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
