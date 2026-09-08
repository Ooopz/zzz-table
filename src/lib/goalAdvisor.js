// src/lib/goalAdvisor.js —— 练度规划纯逻辑（Node 与浏览器共用）：
// 目标值合成：方案档位 median × 玩家样本分布，P20 单边地板（只托底不封顶），逐属性回退链。
// （原 ② 缺口合并 / 逐槽刷盘规划 / 补齐路线已随「提升规划」区块下线删除。）
import { TARGET_PERCENTS } from '../game/index.js';
import { approxPercentile, DIST_Q_KEYS, DIST_Q_FRACS } from './distStats.js';

/** 目标合成默认参数：可达性地板分位（低于它的方案意图值提到该分位）与单盘命中理论上限 */
export const GOAL_FLOOR_Q = 0.2;

/** 从压缩分布的已知分位点线性插值任意分位值（q∈[0,1]；分位键缺失时跳过；无可用点返回 null）。
 *  dist 只有 p10/p25/p50/p75/p90/p95/p99 等离散点（键序单一权威 = distStats.DIST_Q_KEYS），
 *  P20 等任意分位由相邻点插值近似。 */
export function percentileAt(dist, q) {
  if (!dist || !Number.isFinite(q)) return null;
  const known = DIST_Q_KEYS.map((k, i) => [DIST_Q_FRACS[i], dist[k]]).filter(([, v]) => v != null);
  if (!known.length) return null;
  if (q <= known[0][0]) return known[0][1];
  if (q >= known[known.length - 1][0]) return known[known.length - 1][1];
  for (let i = 0; i < known.length - 1; i++) {
    const [q0, v0] = known[i];
    const [q1, v1] = known[i + 1];
    if (q >= q0 && q <= q1) return v0 + ((v1 - v0) * (q - q0)) / (q1 - q0);
  }
  return null;
}

/**
 * 单属性目标合成。tierStat = 方案三档统计行（{low,mid,high:{median}}），dist = 玩家样本分布，current = 我的当前值。
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
