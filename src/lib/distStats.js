// src/lib/distStats.js —— 分布统计纯函数（分位/离散/形态/相关/聚类），Node 与浏览器共用；供 workshopStats 聚合与测试使用

/** 已排序数组的分位数（线性插值），q 夹到 [0,1]；非有限 q 返回 null（此前 q=2 会静默返回 undefined）。
 *  已知排序好的场景直接用，避免 quantile 重复排序。 */
export function quantileSorted(arr, q) {
  if (!arr || !arr.length) return null;
  if (!Number.isFinite(q)) return null;
  const qq = Math.min(1, Math.max(0, q));
  const pos = qq * (arr.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return hi === lo ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
}
export function quantile(arr, q) {
  if (!arr || !arr.length) return null;
  return quantileSorted(
    [...arr].sort((a, b) => a - b),
    q
  );
}
/** 中位数（入参任意序——内部拷贝排序，所以不会改写原数组；已排序数组请用 quantileSorted 省一次排序） */
export function median(arr) {
  return quantile(arr, 0.5);
}
/** 标准差（总体） */
export function sd(vals, mean) {
  if (!Array.isArray(vals) || vals.length < 2) return null;
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
}
/** 偏度：右偏>0、左偏<0 */
function skew(vals, mean, s) {
  if (!Array.isArray(vals) || vals.length < 3 || !s) return null;
  return vals.reduce((a, v) => a + (v - mean) ** 3, 0) / vals.length / s ** 3;
}
/** 超额峰度：>0 尖峰、<0 平峰 */
function kurt(vals, mean, s) {
  if (!Array.isArray(vals) || vals.length < 4 || !s) return null;
  return vals.reduce((a, v) => a + (v - mean) ** 4, 0) / vals.length / s ** 4 - 3;
}
/** 变异系数 CV = sd/mean；越小共识越高 */
export function cv(vals, mean) {
  const s = sd(vals, mean);
  return s != null && mean ? s / Math.abs(mean) : null;
}
/** computeDist 空结果：与正常返回同形（键齐全、值为 null）——此前空数组只返回 5 个键，消费端拿 undefined 无报错 */
const EMPTY_DIST = Object.freeze({
  count: 0,
  min: null,
  max: null,
  range: null,
  mean: null,
  median: null,
  sd: null,
  IQR: null,
  p10: null,
  p25: null,
  p50: null,
  p75: null,
  p90: null,
  p95: null,
  p99: null,
  skew: null,
  kurt: null,
  whiskerLow: null,
  whiskerHigh: null,
  outliers: 0,
  hist: null,
});

/** 玩家分布统计对象 + 离群值排除（箱线图 IQR 1.5 规则）；NaN/Infinity/null 先过滤——否则污染 mean/sd 等并被写进 workshop-stats.json */
export function computeDist(arr) {
  if (!Array.isArray(arr) || !arr.length) return { ...EMPTY_DIST };
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return { ...EMPTY_DIST };
  const n = s.length;
  const mean = s.reduce((a, v) => a + v, 0) / n;
  const sdev = sd(s, mean);
  // s 已排序，直接用 quantileSorted 避免反复排序
  const p5 = quantileSorted(s, 0.05);
  const p10 = quantileSorted(s, 0.1);
  const q1 = quantileSorted(s, 0.25);
  const med = quantileSorted(s, 0.5);
  const q3 = quantileSorted(s, 0.75);
  const p90 = quantileSorted(s, 0.9);
  const p95 = quantileSorted(s, 0.95);
  const p99 = quantileSorted(s, 0.99);
  const iqr = q3 - q1;
  // 离群值阈值：IQR 1.5 规则
  const fenceLow = q1 - 1.5 * iqr;
  const fenceHigh = q3 + 1.5 * iqr;
  // 排除离群值后的箱线须端点：IQR 规则内的最远值；离群值计数
  let whiskerLow = null;
  let whiskerHigh = null;
  let outliers = 0;
  for (let i = 0; i < n; i++) {
    if (s[i] < fenceLow || s[i] > fenceHigh) outliers++;
    if (whiskerLow == null && s[i] >= fenceLow) whiskerLow = s[i];
  }
  for (let i = n - 1; i >= 0; i--) {
    if (s[i] <= fenceHigh) {
      whiskerHigh = s[i];
      break;
    }
  }
  // IQR 塌缩兜底：数据堆在同一值（如基础暴伤 0.66）时 IQR≈0，IQR 规则会把主流玩家误判为离群——
  // 退化为分位数规则：须端用 P10/P90，离群改判 P5/P95 之外（保留堆属性的玩家）
  if (whiskerLow == null || whiskerHigh == null || iqr <= (s[n - 1] - s[0]) * 0.02) {
    whiskerLow = p10;
    whiskerHigh = p90;
    outliers = 0;
    for (let i = 0; i < n; i++) if (s[i] < p5 || s[i] > p95) outliers++;
  }
  // 直方图（等宽分箱；细一点更能看出分布峰/谷）
  const HIST_BINS = 32;
  const hbins = new Array(HIST_BINS + 1);
  const hcounts = new Array(HIST_BINS).fill(0);
  const hspan = s[n - 1] - s[0] || 1;
  for (let i = 0; i <= HIST_BINS; i++) hbins[i] = s[0] + (hspan / HIST_BINS) * i;
  for (const v of s) {
    const idx = Math.min(HIST_BINS - 1, Math.floor(((v - s[0]) / hspan) * HIST_BINS));
    hcounts[idx]++;
  }
  return {
    count: n,
    min: s[0],
    max: s[n - 1],
    range: s[n - 1] - s[0],
    mean,
    median: med,
    sd: sdev,
    IQR: iqr,
    p10,
    p25: q1,
    p50: med,
    p75: q3,
    p90,
    p95,
    p99,
    skew: skew(s, mean, sdev),
    kurt: kurt(s, mean, sdev),
    whiskerLow,
    whiskerHigh,
    outliers,
    // 直方图：bins 箱边界含两端，counts 为每箱频次
    hist: { bins: hbins, counts: hcounts },
  };
}
// ---------- 玩家分布对照（原 web/statsView.js 内嵌实现下放为可测纯函数） ----------
/** 玩家分布压缩分位点（升序）。approxPercentile 与 percentileAt（本文件，互为逆运算）共用这一张表——
 *  分位键/分位数列表曾各自硬编码，改表只漏一边会让 P20 地板与分位读数漂移。 */
export const DIST_Q_KEYS = ['p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99'];
export const DIST_Q_FRACS = DIST_Q_KEYS.map((k) => parseInt(k.slice(1), 10) / 100);

/** 我的值在玩家分布中的近似百分位（分位插值，处理零宽区间/零分位避免 NaN；无分布返回 null） */
export function approxPercentile(v, dist) {
  if (v == null || !dist || dist.p10 == null || dist.p99 == null) return null;
  const pts = DIST_Q_KEYS.map((k) => [dist[k], parseInt(k.slice(1), 10)]);
  if (v <= dist.p10) return dist.p10 === 0 ? (v === 0 ? 0 : 1) : Math.max(0, (v / dist.p10) * 10);
  if (v >= dist.p99) {
    const span = dist.p99 - dist.p10;
    return span === 0 ? 99 : Math.min(100, 99 + ((v - dist.p99) / span) * 1);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (v >= x0 && v <= x1) {
      const span = x1 - x0;
      return span === 0 ? (y0 + y1) / 2 : y0 + ((v - x0) / span) * (y1 - y0);
    }
  }
  return 50;
}

/** 从压缩分布的已知分位点线性插值任意分位值（q∈[0,1]；分位键缺失时跳过；无可用点返回 null）。
 *  dist 只有 p10/p25/p50/p75/p90/p95/p99 等离散点（键序单一权威 = 本文件 DIST_Q_KEYS），
 *  P20 等任意分位由相邻点插值近似。approxPercentile 的逆运算（值 → 分位 ↔ 分位 → 值），
 *  消费端：goalAdvisor.synthTarget 的 P20 可达性地板。 */
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
 * 直方图累计分位（0-100，值 → 玩家百分位，箱内线性插值）：用于「面板分布」图的分位轴——
 * 密度、我的点、推荐区间全部用同一累计口径，上下多属性行横向可比。
 * hist = {bins, counts}（computeDist 产物）；缺 hist 返回 null（调用方回退 approxPercentile）。
 */
export function histCumPct(v, hist) {
  if (v == null || !hist?.bins?.length || !hist?.counts?.length) return null;
  const { bins, counts } = hist;
  const total = counts.reduce((s, c) => s + c, 0);
  if (!total) return null;
  const n = counts.length;
  let acc = 0;
  const edges = [0]; // 每箱左缘累计分位（0-100）
  for (let j = 0; j < n; j++) {
    acc += counts[j];
    edges.push((acc / total) * 100);
  }
  if (v <= bins[0]) return 0;
  if (v >= bins[n]) return 100;
  for (let j = 0; j < n; j++) {
    if (v <= bins[j + 1]) {
      const t = bins[j + 1] === bins[j] ? 0 : (v - bins[j]) / (bins[j + 1] - bins[j]);
      return edges[j] + t * (edges[j + 1] - edges[j]);
    }
  }
  return 100;
}

/** 分位 → 值（histCumPct 的逆，直方图累计反查；缺 hist 返回 null） */
export function histPctValue(pct, hist) {
  if (pct == null || !hist?.bins?.length || !hist?.counts?.length) return null;
  const { bins, counts } = hist;
  const total = counts.reduce((s, c) => s + c, 0);
  if (!total) return null;
  const n = counts.length;
  let acc = 0;
  const edges = [0];
  for (let j = 0; j < n; j++) {
    acc += counts[j];
    edges.push((acc / total) * 100);
  }
  if (pct <= 0) return bins[0];
  if (pct >= 100) return bins[n];
  for (let j = 0; j < n; j++) {
    if (pct <= edges[j + 1]) {
      const t = edges[j + 1] === edges[j] ? 0 : (pct - edges[j]) / (edges[j + 1] - edges[j]);
      return bins[j] + t * (bins[j + 1] - bins[j]);
    }
  }
  return bins[n];
}
