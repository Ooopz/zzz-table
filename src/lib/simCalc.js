// src/lib/simCalc.js —— 驱动盘成长极限模拟：S 级满级盘（4 词条槽、总强化 9 次）的副词条强化次数在两个面板属性间分配，求两属性帕累托有效前沿（纯逻辑无 DOM/Node 依赖，双端共用）。
// 口径：同副词条类型每盘最多一次、不与主词条重复、单条最多 6 次强化；轴外词条一律按「废词条」填 1 次（不承诺三属性同时最优）。
// 4 件套条件效果与音擎被动不计入（与「推算未计 4 件套条件效果」口径一致），2 件套按 4+2 配装实际生效计入。

import { resolveEntry, CATEGORY } from './names.js';
import { panelBonus, coreSkillBoostAt, substatGrowthTable, accumulateBonus } from './calc.js';
import { PANEL_ORDER, STAT, SUBSTAT } from './constants.js';
import { statEntries, pierceStat } from './util.js';

const S = substatGrowthTable.S;

/** S 级满级驱动盘主词条数值（456 号位的百分比/特殊词条均为内部小数口径） */
const MAIN_STAT_S = {
  1: { [STAT.HP]: 2200 },
  2: { [STAT.ATK]: 316 },
  3: { [STAT.DEF]: 184 },
  4: {
    [SUBSTAT.HP_PCT]: 0.3,
    [SUBSTAT.ATK_PCT]: 0.3,
    [SUBSTAT.DEF_PCT]: 0.48,
    [STAT.ANOMALY_PROF]: 92,
    [STAT.CR]: 0.24,
    [STAT.CD]: 0.48,
  },
  5: {
    [SUBSTAT.HP_PCT]: 0.3,
    [SUBSTAT.ATK_PCT]: 0.3,
    [SUBSTAT.DEF_PCT]: 0.48,
    [STAT.PEN_RATE]: 0.24,
    物理伤害加成: 0.3,
    火属性伤害加成: 0.3,
    冰属性伤害加成: 0.3,
    电属性伤害加成: 0.3,
    以太伤害加成: 0.3,
    风属性伤害加成: 0.3,
  },
  6: {
    [SUBSTAT.HP_PCT]: 0.3,
    [SUBSTAT.ATK_PCT]: 0.3,
    [SUBSTAT.DEF_PCT]: 0.48,
    [STAT.IMPACT]: 0.18,
    [STAT.ANOMALY_CTRL]: 0.3,
    [STAT.ENERGY]: 0.6,
  },
};

/** 面板属性 -> 能影响它的副词条类型。攻击/生命/防御有 % 与固定值两种形态。 */
const SUBSTAT_SOURCES = {
  [STAT.ATK]: [
    { type: SUBSTAT.ATK_PCT, kind: 'pct', stat: STAT.ATK, value: S[SUBSTAT.ATK_PCT] },
    { type: SUBSTAT.ATK, kind: 'flat', stat: STAT.ATK, value: S[SUBSTAT.ATK] },
  ],
  [STAT.HP]: [
    { type: SUBSTAT.HP_PCT, kind: 'pct', stat: STAT.HP, value: S[SUBSTAT.HP_PCT] },
    { type: SUBSTAT.HP, kind: 'flat', stat: STAT.HP, value: S[SUBSTAT.HP] },
  ],
  [STAT.DEF]: [
    { type: SUBSTAT.DEF_PCT, kind: 'pct', stat: STAT.DEF, value: S[SUBSTAT.DEF_PCT] },
    { type: SUBSTAT.DEF, kind: 'flat', stat: STAT.DEF, value: S[SUBSTAT.DEF] },
  ],
  [STAT.CR]: [{ type: STAT.CR, kind: 'add', stat: STAT.CR, value: S[STAT.CR] }],
  [STAT.CD]: [{ type: STAT.CD, kind: 'add', stat: STAT.CD, value: S[STAT.CD] }],
  [STAT.ANOMALY_PROF]: [{ type: STAT.ANOMALY_PROF, kind: 'add', stat: STAT.ANOMALY_PROF, value: S[STAT.ANOMALY_PROF] }],
  [STAT.PEN_VALUE]: [{ type: STAT.PEN_VALUE, kind: 'add', stat: STAT.PEN_VALUE, value: S[STAT.PEN_VALUE] }],
};

/** 主词条 UI 名 -> 面板属性名（456 的 攻击力%/生命值%/防御力% 累加到对应面板属性乘区）。 */
function mainStatForPanel(name) {
  if (name === SUBSTAT.ATK_PCT) return STAT.ATK;
  if (name === SUBSTAT.HP_PCT) return STAT.HP;
  if (name === SUBSTAT.DEF_PCT) return STAT.DEF;
  return name;
}
function canonMain(name) {
  if (name === STAT.ATK) return SUBSTAT.ATK_PCT;
  if (name === STAT.HP) return SUBSTAT.HP_PCT;
  if (name === STAT.DEF) return SUBSTAT.DEF_PCT;
  return name;
}

/** 固定面板（角色满级基础 + 音擎 + 456 主词条，不含 2 件套与副词条）。 */
function fixedPanel(libChar, libWengine, mains) {
  const max = libChar?.maxLevel || {};
  const coreFlat = (s) => coreSkillBoostAt(libChar, s, 7);
  const base = {};
  for (const s of PANEL_ORDER) base[s] = null;
  base[STAT.ATK] = (max[STAT.ATK] ?? libChar?.[STAT.ATK] ?? 0) + (libWengine?.baseAtk ?? 0) + coreFlat(STAT.ATK);
  base[STAT.HP] = (max[STAT.HP] ?? libChar?.[STAT.HP] ?? 0) + coreFlat(STAT.HP);
  base[STAT.DEF] = (max[STAT.DEF] ?? libChar?.[STAT.DEF] ?? 0) + coreFlat(STAT.DEF);
  for (const s of PANEL_ORDER) {
    if (base[s] != null || s === STAT.PEN_VALUE) continue;
    base[s] = (libChar?.[s] ?? 0) + coreFlat(s);
  }
  base[STAT.PEN_VALUE] = 0;

  const pct = {};
  const flat = {};
  const damage = {};
  const accumulate = (name, value) => accumulateBonus({ damage, flat, pct }, name, value);

  for (const t of statEntries(libWengine?.subStats)) accumulate(t.name, t.value);

  // 核心技百分比提升（攻击力%/生命值%/防御力%/冲击力%）进入对应乘区。
  for (const baseName of [STAT.ATK, STAT.HP, STAT.DEF, STAT.IMPACT]) {
    const v = coreSkillBoostAt(libChar, baseName + '%', 7);
    if (v) accumulate(baseName, v);
  }

  const slots = [
    { slot: 1, name: STAT.HP },
    { slot: 2, name: STAT.ATK },
    { slot: 3, name: STAT.DEF },
    { slot: 4, name: mains[4] },
    { slot: 5, name: mains[5] },
    { slot: 6, name: mains[6] },
  ];
  for (const { slot, name } of slots) {
    if (!name) continue;
    const table = MAIN_STAT_S[slot] || {};
    const value = table[canonMain(name)] ?? table[name];
    if (value != null) accumulate(mainStatForPanel(canonMain(name)), value);
  }

  const final = {};
  for (const s of PANEL_ORDER) {
    if (base[s] == null) continue;
    final[s] = panelBonus(s, base[s], pct[s] || 0, flat[s] || 0).final;
  }
  for (const [name, value] of Object.entries(damage)) final[name] = value;

  if (libChar?.trait === '命破' && final[STAT.ATK] != null && final[STAT.HP] != null) {
    base[STAT.PIERCE] = pierceStat(base[STAT.ATK], base[STAT.HP]);
    final[STAT.PIERCE] = pierceStat(final[STAT.ATK], final[STAT.HP]);
    base[STAT.PEN_RATE] = null;
    final[STAT.PEN_RATE] = null;
  }

  return { base, final, pct, flat, damage };
}

/** 在 fixedPanel 基础上补 2 件套后合成最终固定面板。 */
function fixedPanelWithSets(fixed, libChar, setBonuses) {
  const base = { ...fixed.base };
  const pct = { ...fixed.pct };
  const flat = { ...fixed.flat };
  const damage = { ...(fixed.damage || {}) };
  for (const [name, value] of Object.entries(setBonuses)) {
    accumulateBonus({ damage, pct, flat }, name, value);
  }
  const final = {};
  for (const s of PANEL_ORDER) {
    if (base[s] == null) continue;
    final[s] = panelBonus(s, base[s], pct[s] || 0, flat[s] || 0).final;
  }
  for (const [name, value] of Object.entries(damage)) final[name] = value;
  if (libChar?.trait === '命破' && final[STAT.ATK] != null && final[STAT.HP] != null) {
    base[STAT.PIERCE] = pierceStat(base[STAT.ATK], base[STAT.HP]);
    final[STAT.PIERCE] = pierceStat(final[STAT.ATK], final[STAT.HP]);
    base[STAT.PEN_RATE] = null;
    final[STAT.PEN_RATE] = null;
  }
  return { base, final };
}

/** 单个副词条源在给定白值下的每强化次数收益。 */
function rollContribution(def, base) {
  if (def.kind === 'pct') return (base[def.stat] ?? 0) * def.value;
  return def.value;
}

/** 生成单枚驱动盘的全部帕累托副词条分配方案（仅关心两个轴属性的收益）。
 *  bannedType 为该盘主词条对应的副词条类型（副词条不能与主词条重复）。 */
/** 组合：从 arr 里取 k 个（按下标序），返回下标数组的集合。discOptions/discOptionsND 共用（曾逐字复制两份） */
function combinations(arr, k) {
  const out = [];
  const walk = (start, cur) => {
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      walk(i + 1, cur);
      cur.pop();
    }
  };
  walk(0, []);
  return out;
}
/** 整数分拆：k 个在 [1,6] 的整数和为 total 的全部有序组合（副词条强化次数分配到 k 个词条，各 1..6）。 */
function compositions(k, total) {
  const out = [];
  const rec = (k, total, prefix) => {
    if (k === 1) {
      if (total >= 1 && total <= 6) out.push([...prefix, total]);
      return;
    }
    for (let r = 1; r <= Math.min(6, total - (k - 1)); r++) {
      prefix.push(r);
      rec(k - 1, total - r, prefix);
      prefix.pop();
    }
  };
  rec(k, total, []);
  return out;
}

function discOptions(relevant, bannedType) {
  const allowedIdx = relevant.map((_, i) => i).filter((i) => relevant[i].type !== bannedType);
  if (!allowedIdx.length) return [{ dx: 0, dy: 0, detail: '无可用词条' }];
  const m = allowedIdx.length;
  const raw = [];
  const maxK = Math.min(4, m);

  for (let k = 1; k <= maxK; k++) {
    for (const idx of combinations(allowedIdx, k)) {
      for (const rolls of compositions(k, 5 + k)) {
        let dx = 0;
        let dy = 0;
        const detail = [];
        idx.forEach((ri, pos) => {
          const src = relevant[ri];
          dx += rolls[pos] * src.dx;
          dy += rolls[pos] * src.dy;
          detail.push(src.type + '×' + rolls[pos]);
        });
        raw.push({ dx, dy, detail: detail.join('、') });
      }
    }
  }
  return paretoPoints(raw);
}

/** 二维最大化帕累托过滤：按 x 升序、y 降序，保留 y 严格递增的点。 */
function paretoPoints(points) {
  const arr = points.map((p) => ({ dx: p.dx, dy: p.dy, detail: p.detail })).sort((a, b) => b.dx - a.dx || b.dy - a.dy);
  const out = [];
  let maxY = -Infinity;
  for (const p of arr) {
    if (p.dy > maxY + 1e-9) {
      out.push(p);
      maxY = p.dy;
    }
  }
  return out.reverse();
}

/** 把六枚盘各自的分配方案做动态规划卷积，得到两轴总收益前沿。 */
function combineDiscOptions(optionsBySlot) {
  let states = [{ dx: 0, dy: 0 }];
  for (const options of optionsBySlot) {
    const next = [];
    for (const s of states) {
      for (const o of options) {
        next.push({ dx: s.dx + o.dx, dy: s.dy + o.dy });
      }
    }
    states = paretoPoints(next);
  }
  return states;
}

/** 槽位主词条 -> 对应副词条类型（用于「副词条不与主词条重复」约束）。 */
function mainTypeForSlot(slot, mains) {
  if (slot === 1) return STAT.HP;
  if (slot === 2) return STAT.ATK;
  if (slot === 3) return STAT.DEF;
  return canonMain(mains[slot]) || '';
}
/** 解析一次配装，返回固定面板与主词条（2D/3D 共用）。 */
function resolveBuild(ctx, opts) {
  const { charIndex, wengineIndex, discIndex } = ctx;
  const libChar = resolveEntry(CATEGORY.CHAR, charIndex, opts.charName) || {};
  const libWengine = resolveEntry(CATEGORY.WENGINE, wengineIndex, opts.wengineName) || {};
  const setBonuses = {};
  const addSet = (name) => {
    if (!name) return;
    const disc = resolveEntry(CATEGORY.DISC, discIndex, name);
    for (const [k, v] of Object.entries(disc?.set2 || {})) setBonuses[k] = (setBonuses[k] || 0) + v;
  };
  addSet(opts.set2);
  addSet(opts.set4);
  const mains = { 4: canonMain(opts.main4), 5: canonMain(opts.main5), 6: canonMain(opts.main6) };
  const fixed = fixedPanel(libChar, libWengine, mains);
  const withSets = fixedPanelWithSets(fixed, libChar, setBonuses);
  return { libChar, libWengine, withSets, mains };
}

/** 由坐标轴构造副词条来源：每个来源只在所属轴维度上有收益。 */
function buildSourceDefs(axes, base) {
  const nDims = axes.length;
  const sourceDefs = [];
  axes.forEach((stat, ai) => {
    for (const def of SUBSTAT_SOURCES[stat] || []) {
      const gain = rollContribution(def, base);
      if (!Number.isFinite(gain) || gain <= 0) continue;
      const dims = Array(nDims).fill(0);
      dims[ai] = gain;
      sourceDefs.push({ ...def, dims, gain });
    }
  });
  return sourceDefs;
}

/** 生成单枚驱动盘的全部 N 维帕累托副词条分配方案。 */
function discOptionsND(relevant, bannedType, nDims) {
  const allowedIdx = relevant.map((_, i) => i).filter((i) => relevant[i].type !== bannedType);
  if (!allowedIdx.length) return [{ dims: Array(nDims).fill(0), detail: '无可用词条' }];
  const raw = [];
  const maxK = Math.min(4, allowedIdx.length);
  for (let k = 1; k <= maxK; k++) {
    for (const idx of combinations(allowedIdx, k)) {
      for (const rolls of compositions(k, 5 + k)) {
        const dims = Array(nDims).fill(0);
        const detail = [];
        idx.forEach((ri, pos) => {
          const src = relevant[ri];
          for (let d = 0; d < nDims; d++) dims[d] += rolls[pos] * src.dims[d];
          detail.push(src.type + '×' + rolls[pos]);
        });
        raw.push({ dims, detail: detail.join('、') });
      }
    }
  }
  return paretoND(raw);
}

function paretoND(points) {
  if (!points.length) return [];
  const nDims = points[0].dims.length;
  if (nDims === 3) return pareto3(points);
  const eps = 1e-9;
  const arr = points.map((p) => ({ dims: p.dims.slice(), detail: p.detail }));
  let kept = [];
  for (const p of arr) {
    let dominated = false;
    for (const q of kept) {
      if (dominatesND(q.dims, p.dims, eps)) {
        dominated = true;
        break;
      }
    }
    if (dominated) continue;
    kept = kept.filter((q) => !dominatesND(p.dims, q.dims, eps));
    kept.push(p);
  }
  return kept;
}

/** 三维帕累托过滤：按第一维降序，维护后两维的 2D 前沿，避免全量两两比较。 */
function pareto3(points) {
  const eps = 1e-9;
  const arr = points
    .map((p) => ({ dims: p.dims.slice(), detail: p.detail }))
    .sort((a, b) => b.dims[0] - a.dims[0] || b.dims[1] - a.dims[1] || b.dims[2] - a.dims[2]);
  const kept = [];
  let front = [];
  for (const p of arr) {
    let dominated = false;
    for (const f of front) {
      if (f.y >= p.dims[1] - eps && f.z >= p.dims[2] - eps) {
        dominated = true;
        break;
      }
    }
    if (dominated) continue;
    front = front.filter((f) => !(p.dims[1] >= f.y - eps && p.dims[2] >= f.z - eps));
    front.push({ y: p.dims[1], z: p.dims[2] });
    kept.push(p);
  }
  return kept;
}

function dominatesND(a, b, eps) {
  let any = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - eps) return false;
    if (a[i] > b[i] + eps) any = true;
  }
  return any;
}

/** 把六枚盘各自的 N 维方案做 DP 卷积。 */
function combineND(optionsBySlot, nDims) {
  let states = [{ dims: Array(nDims).fill(0) }];
  for (const options of optionsBySlot) {
    const next = [];
    for (const s of states) {
      for (const o of options) {
        next.push({ dims: s.dims.map((v, i) => v + o.dims[i]) });
      }
    }
    states = paretoND(next);
  }
  return states;
}

/** 计算二维有效前沿。
 *  ctx = { charIndex, wengineIndex, discIndex }（buildNameIndex 产物）；opts = { charName, wengineName, set2, set4, main4-6, xAxis, yAxis } */
export function simulateFrontier(ctx, opts) {
  const { withSets, mains } = resolveBuild(ctx, opts);
  const axes = [opts.xAxis, opts.yAxis];
  const sourceDefs = buildSourceDefs(axes, withSets.base).map((s) => ({
    ...s,
    dx: s.dims[0],
    dy: s.dims[1],
  }));
  const optionsBySlot = [1, 2, 3, 4, 5, 6].map((slot) => discOptions(sourceDefs, mainTypeForSlot(slot, mains)));
  const combined = combineDiscOptions(optionsBySlot);
  const points = combined
    .map((s) => ({ x: withSets.final[opts.xAxis] + s.dx, y: withSets.final[opts.yAxis] + s.dy }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  return { fixed: withSets.final, base: withSets.base, points, sourceDefs, discOptions: optionsBySlot };
}

/**
 * 计算按有效强化次数预算分层的前沿：完美（100%）、大毕业（80%）、小毕业（70%）。
 * 为控制计算耗时，这里不再做带预算的逐盘 DP，而是把完整二维前沿按固定面板原点做等比缩放。
 */
export function simulateFrontierLevels(ctx, opts, maxRolls, levels = [1, 0.8, 0.7]) {
  const full = simulateFrontier(ctx, opts);
  const fixedX = full.fixed[opts.xAxis];
  const fixedY = full.fixed[opts.yAxis];
  const frontiers = levels.map((level) => ({
    level,
    budget: Math.round(maxRolls * level),
    points: full.points.map((p) => ({
      x: fixedX + (p.x - fixedX) * level,
      y: fixedY + (p.y - fixedY) * level,
    })),
  }));
  return { fixed: full.fixed, base: full.base, frontiers, maxRolls };
}

export function simulateFrontier3D(ctx, opts) {
  const { withSets, mains } = resolveBuild(ctx, opts);
  const axes = [opts.xAxis, opts.yAxis, opts.zAxis];
  const sourceDefs = buildSourceDefs(axes, withSets.base);
  const optionsBySlot = [1, 2, 3, 4, 5, 6].map((slot) =>
    discOptionsND(sourceDefs, mainTypeForSlot(slot, mains), axes.length)
  );
  const combined = combineND(optionsBySlot, axes.length);
  const points = combined
    .map((s) => ({
      x: withSets.final[axes[0]] + s.dims[0],
      y: withSets.final[axes[1]] + s.dims[1],
      z: withSets.final[axes[2]] + s.dims[2],
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));

  return { fixed: withSets.final, base: withSets.base, points, sourceDefs, discOptions: optionsBySlot, axes };
}

/** 坐标轴属性 -> 可提供收益的副词条类型集合。 */
export function axisSubstatTypes(axes) {
  const set = new Set();
  for (const stat of axes || []) {
    for (const def of SUBSTAT_SOURCES[stat] || []) set.add(def.type);
  }
  return set;
}

/** 给定配装与坐标轴属性，计算这套轴的理论最大有效强化次数。 */
export function axisRollCap(ctx, opts, axes) {
  const { withSets, mains } = resolveBuild(ctx, opts);
  const sourceDefs = buildSourceDefs(axes, withSets.base);
  let total = 0;
  for (let slot = 1; slot <= 6; slot++) {
    const allowed = sourceDefs.filter((s) => s.type !== mainTypeForSlot(slot, mains)).length;
    if (allowed) total += 5 + Math.min(4, allowed);
  }
  return total;
}

/** 供 UI 使用：某面板属性能否作为前沿坐标轴（至少存在一个副词条来源）。 */
export function axisAvailable(stat) {
  return !!SUBSTAT_SOURCES[stat];
}

/** 供 UI 展示：该角色满级固定面板（不含副词条）。 */
export function simulateFixedPanel(ctx, opts) {
  const { withSets } = resolveBuild(ctx, opts);
  return withSets.final;
}
