// src/lib/validateWorkshopStats.js —— 工坊聚合出口自检（纯函数，无 node 依赖）
// 消费端（workshop-stats.json 的前端/统计图）假定聚合输出满足若干**必然成立**的不变量：
// 计数非负、分位数随分位点单调不减、mean 落在 [min,max]、各技能档计数合计 == count、拥有率 ∈[0,1] 等。
// 这类不变量被破坏 = 聚合代码回归（缺守卫/脏值混入统计），而非数据本身的问题——buildWorkshopStats 写盘前调用，
// 违规即抛错并保留旧文件，把"静默输出坏统计"提前成"失败并留下现场"。
// ⚠️ skew/kurt（偏度/峰度）可为负，属合法，不在本检查范围。本文件只做数学必然成立的断言，避免对真实数据误报。

/** 宽松相等（浮点） */
const approxEq = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const isInt = (n) => Number.isInteger(n) || (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9);

/** 全局：不允许任何非有限数值（NaN/±Infinity 只能来自回归，永远是 bug） */
function walkFinite(v, path, issues) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) issues.push(`${path} = ${v} 非有限数值`);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => walkFinite(x, `${path}[${i}]`, issues));
    return;
  }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) walkFinite(v[k], path ? `${path}.${k}` : k, issues);
  }
}

/** 分布节点（panels.stats[*] / relicStats[*] / skillStats 节点共用）：
 *  count≥0、min≤max、mean∈[min,max]、sd≥0、p10..p99 随分位点单调不减、median≈p50。
 *  dist 存在时（skillStats）：各档 count 求和 == count，档 key 为 [min,max] 内正整数。 */
function checkDistNode(v, path, issues) {
  const { count, min, max, mean, median, sd } = v;
  if (!Number.isFinite(count) || count < 0 || !isInt(count)) issues.push(`${path}.count = ${count}（须为 ≥0 整数）`);
  const finite = (x) => x == null || Number.isFinite(x);
  if (!(finite(min) && finite(max))) return;
  if (min != null && max != null && min > max) issues.push(`${path}: min(${min}) > max(${max})`);
  if (count > 0) {
    if (mean != null && min != null && max != null && (mean < min || mean > max))
      issues.push(`${path}.mean = ${mean} 超出 [min,max]=[${min},${max}]`);
    if (sd != null && sd < 0) issues.push(`${path}.sd = ${sd} 为负`);
  }
  // 分位数顺序（各分布节点只含部分分位键，按定义的全局顺序取存在的做单调校验）
  const Q = ['p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99'];
  let prevKey = null;
  for (const k of Q) {
    if (v[k] == null) continue;
    if (prevKey && v[prevKey] != null && v[k] < v[prevKey])
      issues.push(`${path}: ${prevKey}(${v[prevKey]}) > ${k}(${v[k]})（分位数须单调不减）`);
    prevKey = k;
  }
  if (median != null && v.p50 != null && !approxEq(median, v.p50)) issues.push(`${path}: median(${median}) ≠ p50(${v.p50})`);
  // 档位分布（skillStats.dist 等 {档:count}）：合计 == count，档为 [min,max] 内正整数
  if (v.dist && typeof v.dist === 'object') {
    let sum = 0;
    for (const [k, c] of Object.entries(v.dist)) {
      const n = Number(k);
      if (!Number.isInteger(n) || n <= 0) issues.push(`${path}.dist key ${JSON.stringify(k)} 非正整数档位`);
      if (!Number.isFinite(c) || c < 0 || !isInt(c)) issues.push(`${path}.dist[${k}] = ${c} 须为 ≥0 整数`);
      sum += Number(c);
    }
    if (count != null && sum !== count) issues.push(`${path}: dist 各档合计(${sum}) ≠ count(${count})`);
    if (v.dist && count > 0 && min != null && max != null) {
      const keys = Object.keys(v.dist).map(Number);
      if (keys.length) {
        const lo = Math.min(...keys);
        const hi = Math.max(...keys);
        if (lo !== min) issues.push(`${path}: dist 最小档 ${lo} ≠ min ${min}`);
        if (hi !== max) issues.push(`${path}: dist 最大档 ${hi} ≠ max ${max}`);
      }
    }
  }
}

function checkPanels(panels, issues) {
  if (!Array.isArray(panels)) return;
  panels.forEach((role, ri) => {
    if (!role || typeof role !== 'object' || !role.stats || typeof role.stats !== 'object') {
      issues.push(`panels[${ri}]: 缺 stats 对象`);
      return;
    }
    for (const [stat, node] of Object.entries(role.stats)) checkDistNode(node, `panels[${ri}].stats.${stat}`, issues);
  });
}

function checkMapOfNodes(map, label, issues) {
  if (!map || typeof map !== 'object') return;
  for (const [rid, node] of Object.entries(map)) {
    if (node && typeof node === 'object' && node.count != null && node.median != null) {
      checkDistNode(node, `${label}.${rid}`, issues);
    }
  }
}

/** skillStats 为 rid → 技能 type → 分布节点 两层，需逐层下钻 */
function checkSkillStats(skillStats, issues) {
  if (!skillStats || typeof skillStats !== 'object') return;
  for (const [rid, byType] of Object.entries(skillStats)) {
    if (!byType || typeof byType !== 'object') continue;
    for (const [t, node] of Object.entries(byType)) {
      if (node && typeof node === 'object' && node.count != null && node.median != null) {
        checkDistNode(node, `skillStats.${rid}.${t}`, issues);
      }
    }
  }
}

function checkRankDist(rankDist, issues) {
  if (!rankDist || typeof rankDist !== 'object') return;
  for (const [rid, bins] of Object.entries(rankDist)) {
    if (!bins || typeof bins !== 'object') continue;
    let sum = 0;
    for (const [r, c] of Object.entries(bins)) {
      const rr = Number(r);
      if (!Number.isInteger(rr) || rr < 0 || rr > 6) issues.push(`rankDist.${rid}: 影画档 ${JSON.stringify(r)} 超出 [0,6]`);
      if (!Number.isFinite(c) || c < 0 || !isInt(c)) issues.push(`rankDist.${rid}[${r}] = ${c} 须为 ≥0 整数`);
      sum += Number(c);
    }
    if (sum === 0) issues.push(`rankDist.${rid}: 各档合计为 0`);
  }
}

function checkOwnership(roleOwnership, issues) {
  if (!roleOwnership || typeof roleOwnership !== 'object') return;
  for (const [rid, v] of Object.entries(roleOwnership)) {
    if (typeof v === 'number' && (v < 0 || v > 1)) issues.push(`roleOwnership.${rid} = ${v} 超出 [0,1]`);
  }
}

function checkSkillLevelModes(skillLevelModes, issues) {
  if (!skillLevelModes || typeof skillLevelModes !== 'object') return;
  for (const [rid, byType] of Object.entries(skillLevelModes)) {
    for (const [t, lv] of Object.entries(byType || {})) {
      if (typeof lv === 'number' && (lv < 1 || !isInt(lv))) issues.push(`skillLevelModes.${rid}[${t}] = ${lv} 非正整数等级`);
    }
  }
}

function checkScatter(panelScatter, issues) {
  if (!panelScatter || typeof panelScatter !== 'object') return;
  const gridMap = panelScatter.perRole || panelScatter.global || {};
  for (const [rid, pairs] of Object.entries(gridMap)) {
    if (!pairs || typeof pairs !== 'object') continue;
    for (const [k, g] of Object.entries(pairs)) {
      if (!g || typeof g !== 'object') continue;
      const p = `panelScatter.${rid}.${k}`;
      if (g.N != null && (!Number.isFinite(g.N) || g.N < 0 || !isInt(g.N))) issues.push(`${p}.N = ${g.N} 须为 ≥0 整数`);
      if (g.xMin != null && g.xMax != null && g.xMin > g.xMax) issues.push(`${p}: xMin(${g.xMin}) > xMax(${g.xMax})`);
      if (g.yMin != null && g.yMax != null && g.yMin > g.yMax) issues.push(`${p}: yMin(${g.yMin}) > yMax(${g.yMax})`);
      if (Array.isArray(g.data)) {
        g.data.forEach((row, i) => {
          if (!Array.isArray(row) || row.length < 3 || !row.every(Number.isFinite) || row[2] < 0)
            issues.push(`${p}.data[${i}] = ${JSON.stringify(row)} 非法网格行（须 3 个有限数且计数 ≥0）`);
        });
      }
    }
  }
}

function checkDiscDetails(discDetails, issues) {
  if (!Array.isArray(discDetails)) return;
  discDetails.forEach((d, i) => {
    if (!d || typeof d !== 'object') return;
    if (d.equips != null && (!Number.isFinite(d.equips) || d.equips < 0)) issues.push(`discDetails[${i}].equips = ${d.equips} 为负`);
    // effDist：有效强化次数应为 ≥0 整数档
    if (d.effDist && typeof d.effDist === 'object') {
      for (const [k, c] of Object.entries(d.effDist)) {
        if (!Number.isInteger(Number(k)) || Number(k) < 0) issues.push(`discDetails[${i}].effDist key ${JSON.stringify(k)} 非 ≥0 整数`);
        if (!Number.isFinite(c) || c < 0 || !isInt(c)) issues.push(`discDetails[${i}].effDist[${k}] = ${c} 须为 ≥0 整数`);
      }
    }
    if (d.mainDenom != null) for (const [slot, n] of Object.entries(d.mainDenom || {})) {
      if (!Number.isFinite(n) || n < 0) issues.push(`discDetails[${i}].mainDenom[${slot}] = ${n} 为负`);
    }
  });
}

/** 出口自检：返回违规描述数组（空 = 通过）。只看数学必然成立的不变量，对合法数据零误报。 */
export function validateWorkshopStats(data) {
  const issues = [];
  if (!data || typeof data !== 'object') return ['workshop-stats 顶层非对象'];
  walkFinite(data, '', issues);
  checkPanels(data.panels, issues);
  checkMapOfNodes(data.relicStats, 'relicStats', issues);
  checkSkillStats(data.skillStats, issues);
  checkRankDist(data.rankDist, issues);
  checkOwnership(data.roleOwnership, issues);
  checkSkillLevelModes(data.skillLevelModes, issues);
  checkScatter(data.panelScatter, issues);
  checkDiscDetails(data.discDetails, issues);
  return issues;
}
