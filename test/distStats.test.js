// test/distStats.test.js —— 分布统计纯函数 + 属性相关
import test from 'node:test';
import assert from 'node:assert/strict';
import { quantile, median, computeDist, sd, approxPercentile, histCumPct, histPctValue } from '../src/lib/distStats.js';
import { loadDataFile } from './helpers.js';

test('quantile/median：线性插值', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0), 1);
  assert.equal(quantile([1, 2, 3, 4, 5], 1), 5);
  // 线性插值：p25 of 1..10 = 1 + (10-1)*0.25
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.25), 3.25);
});

test('computeDist：IQR 1.5 离群值排除', () => {
  // [1..5, 100]：100 超出 Q3+1.5*IQR 上限，应为离群
  const d = computeDist([1, 2, 3, 4, 5, 100]);
  assert.equal(d.whiskerLow, 1); // 下须取非离群最低
  assert.equal(d.whiskerHigh, 5); // 上须排除 100
  assert.equal(d.outliers, 1);
  // 无离群时 whisker = min/max
  const d2 = computeDist([10, 12, 14, 16, 18]);
  assert.equal(d2.outliers, 0);
  assert.equal(d2.whiskerLow, 10);
  assert.equal(d2.whiskerHigh, 18);
});

test('computeDist：完整分布对象（分位/离散/形态）', () => {
  const d = computeDist([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(d.count, 10);
  assert.equal(d.min, 1);
  assert.equal(d.max, 10);
  assert.equal(d.range, 9);
  assert.equal(d.median, 5.5);
  assert.equal(d.p50, 5.5);
  assert.ok(d.sd > 0);
  assert.ok(d.IQR > 0);
  assert.equal(d.p10, 1.9);
  assert.ok(d.skew != null && d.kurt != null);
  const empty = computeDist([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.min, null);
});

test('sd：总体标准差（除以 n，非样本 n-1）', () => {
  // [2,4,4,4,5,5,7,9] 均值 5，方差 = 32/8 = 4 → sd = 2（样本式 32/7≈2.138 会不同）
  assert.equal(sd([2, 4, 4, 4, 5, 5, 7, 9], 5), 2);
  assert.equal(sd([5, 5], 5), 0); // 零方差
  assert.equal(sd([1], 1), null); // 样本不足
});

test('approxPercentile：分位插值与零宽区间守卫（原 statsView 内嵌实现下放补测）', () => {
  const dist = { p10: 1, p25: 2, p50: 4, p75: 6, p90: 8, p95: 9, p99: 10 };
  assert.equal(approxPercentile(0.5, dist), 5, '低于 p10 按 v/p10 比例外推');
  assert.equal(approxPercentile(0, { ...dist, p10: 0 }), 0, 'p10=0 且 v=0 → 0 分位');
  assert.equal(approxPercentile(1, { ...dist, p10: 0 }), 17.5, 'v 略高于零宽 p10 时回到正常插值段');
  assert.equal(approxPercentile(3, dist), 37.5, 'p25~p50 段线性插值：25+(3-2)/(4-2)*25');
  assert.equal(approxPercentile(12, dist), 99 + 2 / 9, '略超 p99：99+(v-p99)/span 外推');
  assert.equal(approxPercentile(1000, dist), 100, '远超 p99 封顶 100');
  assert.equal(approxPercentile(null, dist), null, '无值返回 null');
  assert.equal(approxPercentile(3, {}), null, '无分布返回 null');
});

test('真实数据冒烟：workshop-stats 含分位/离散/形态', () => {
  const stats = loadDataFile('workshop-stats.json', 'node src/sync/workshop.js');
  const p = stats.panels.find((x) => x.stats['攻击力']);
  assert.ok(p.stats['攻击力'].p50 != null);
  assert.ok(p.stats['攻击力'].p99 > p.stats['攻击力'].p50);
  assert.ok(p.stats['攻击力'].sd > 0);
});

test('histCumPct/histPctValue：直方图累计分位互转（面板分布分位轴用）', () => {
  // 均匀分布：5 箱各 10 人，值 0-50
  const hist = { bins: [0, 10, 20, 30, 40, 50], counts: [10, 10, 10, 10, 10] };
  assert.equal(histCumPct(0, hist), 0, '最小值 → 0 分位');
  assert.equal(histCumPct(50, hist), 100, '最大值 → 100 分位');
  assert.equal(histCumPct(25, hist), 50, '中位 → 50 分位');
  assert.equal(histCumPct(-5, hist), 0, '越界下钳 0');
  assert.equal(histCumPct(999, hist), 100, '越界上钳 100');
  // 逆：分位 → 值
  assert.equal(histPctValue(50, hist), 25, '50 分位 → 中值');
  assert.equal(histPctValue(0, hist), 0);
  assert.equal(histPctValue(100, hist), 50);
  // 往返：值→分位→值 还原
  assert.equal(histPctValue(histCumPct(17, hist), hist), 17);
  assert.equal(histCumPct(histPctValue(37, hist), hist), 37);
  // 非均匀：前两箱（0-20）共 30/45 人 → 20 值处（bin 右缘）累计 66.67 分位
  const skew = { bins: [0, 10, 20, 30, 40], counts: [20, 10, 5, 5, 5] };
  assert.ok(Math.abs(histCumPct(10, skew) - (20 / 45) * 100) < 1e-9, '10 值处 = 前 20 人累计 44.44 分位');
  assert.ok(Math.abs(histCumPct(20, skew) - (30 / 45) * 100) < 1e-9, '20 值处 = 前 30 人累计 66.67 分位');
  // 缺 hist / 空输入
  assert.equal(histCumPct(1, null), null);
  assert.equal(histPctValue(50, {}), null);
});
