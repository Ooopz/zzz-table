// test/panelItems.test.js —— lib/panelItems 纯函数单测：手风琴「面板分布」整合图的组合项。
// 纯内联 fixture，不依赖 data/，永远不会 SKIP。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPanelItems } from '../src/lib/panelItems.js';

// dist / rec / myFinal fixture（与 workshop-stats/plans/characters 同构）
const dist = {
  攻击力: {
    count: 50,
    median: 2000,
    p10: 1500,
    p25: 1800,
    p50: 2000,
    p75: 2200,
    p90: 2500,
    p95: 2650,
    p99: 2800,
    mean: 2000,
  },
  暴击率: { count: 40, median: 0.6, p10: 0.4, p25: 0.5, p50: 0.6, p75: 0.7, p90: 0.8, p95: 0.85, p99: 0.9, mean: 0.6 },
  异常掌控: { count: 8, median: 100 }, // 样本 < 30，应被排除
};
const rec = {
  攻击力: {
    low: { median: 1900, sd: 80 },
    mid: { median: 2000, sd: 90 },
    high: { median: 2150, sd: 100 },
  },
  // 暴击率缺三档（占位属性，只有玩家分布）
};
const myFinal = { 攻击力: 2100, 暴击率: 0.55 };
const src = { dist, rec, myFinal };

test('buildPanelItems：组合项含全部字段（手风琴整合图用）', () => {
  const items = buildPanelItems(src);
  assert.equal(items.length, 2);
  const atk = items.find((i) => i.attr === '攻击力');
  assert.ok(atk.dist, '含完整 dist（箱线 quartile 从这取）');
  assert.equal(atk.minePct, 62.5);
  assert.equal(atk.high.sd, 100, '三档带 sd（悬浮用）');
});

test('minCount 可调（默认 30）', () => {
  assert.equal(buildPanelItems({ ...src, minCount: 5 }).length, 3, 'minCount=5 时异常掌控也计入');
});

test('buildPanelItems：targets 传入后每属性带目标内部值与玩家分位（面板分布图目标标记用）', () => {
  // targets = 内部值口径（攻击力固定值 2200、暴击率 0.55）
  const items = buildPanelItems({ ...src, targets: { 攻击力: 2200, 暴击率: 0.55 } });
  const atk = items.find((i) => i.attr === '攻击力');
  assert.equal(atk.target, 2200, '目标内部值透传');
  assert.equal(atk.targetPct, 75, '目标=玩家 P75 → 分位 75（approxPercentile 锚点命中）');
  const crit = items.find((i) => i.attr === '暴击率');
  assert.equal(crit.target, 0.55);
  assert.ok(crit.targetPct != null && crit.targetPct > 0 && crit.targetPct <= 100, '目标分位应在 0-100');
  // 未传 targets → target/targetPct = null（未设目标不标记）
  const noTarget = buildPanelItems(src).find((i) => i.attr === '攻击力');
  assert.equal(noTarget.target, null);
  assert.equal(noTarget.targetPct, null);
  // targets 里非数值（如特殊键）被跳过，不影响其他属性
  const skip = buildPanelItems({ ...src, targets: { 攻击力: NaN } }).find((i) => i.attr === '攻击力');
  assert.equal(skip.target, null);
});
