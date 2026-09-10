// 练度规划纯逻辑测试：目标合成（档位×P20 地板）与目标缺口（纯内联 fixture，不依赖 data/）
import test from 'node:test';
import assert from 'node:assert/strict';
import { synthTarget, toTargetDisplay, GOAL_FLOOR_Q } from '../src/lib/panelAdvice.js';
import { percentileAt } from '../src/lib/distStats.js';
import { setCalcContext, targetGap } from '../src/lib/calc.js';

// 造一个已知分位点的分布：p10=1 p25=2 p50=4 p75=6 p90=8 p95=9 p99=10
const DIST = { p10: 1, p25: 2, p50: 4, p75: 6, p90: 8, p95: 9, p99: 10 };

test('percentileAt：离散分位点线性插值与端点夹持', () => {
  assert.ok(Math.abs(percentileAt(DIST, 0.2) - (1 + (2 - 1) * ((0.2 - 0.1) / 0.15))) < 1e-9, 'P20 在 p10~p25 间插值');
  assert.equal(percentileAt(DIST, 0.05), 1, '低于最小已知分位 → 夹持到 p10');
  assert.equal(percentileAt(DIST, 0.995), 10, '高于最大已知分位 → 夹持到 p99');
  assert.equal(percentileAt({}, 0.5), null, '无分位点 → null');
  assert.equal(percentileAt({ p10: 1, p50: 4 }, 0.25), 2.125, '缺 p25 时用相邻 p10~p50 插值');
  assert.equal(percentileAt(null, 0.5), null);
});

test('synthTarget：P20 地板触发（方案意图低于可达带）', () => {
  const r = synthTarget('攻击力%', { high: { median: 1 } }, DIST, 0.8, 'high');
  assert.ok(Math.abs(r.suggestion - 5 / 3) < 1e-9, '意图 1 < P20≈1.667 → 提到 P20');
  assert.equal(r.floorApplied, true);
  assert.equal(r.plan, 1);
  assert.equal(r.source, 'plan');
  assert.ok(Math.abs(r.percentile - 20) < 1e-9, '修正后分位恰为 20（approxPercentile 线性插值）');
  assert.equal(GOAL_FLOOR_Q, 0.2, '地板分位约定 0.2（只托底不封顶）');
});

test('synthTarget：带内不修正，高档意图原样保留（不封顶）', () => {
  const r = synthTarget('攻击力%', { high: { median: 9.5 } }, DIST, 5, 'high');
  assert.equal(r.suggestion, 9.5, '意图高于 P20 → 原样采纳，超 P85 也不压');
  assert.equal(r.floorApplied, false);
  assert.ok(r.percentile > 95, '分位标注如实显示 95+');
});

test('synthTarget：回退链（方案缺→玩家中位；两源缺→null）', () => {
  const r1 = synthTarget('暴击率', {}, DIST, 0.3, 'high');
  assert.equal(r1.suggestion, 4, '方案缺该档 → 玩家 p50');
  assert.equal(r1.source, 'p50');
  assert.equal(r1.tier, null);
  assert.equal(synthTarget('暴击率', {}, null, 0.3, 'high'), null, '两源都缺 → 不编数');
  const r2 = synthTarget('暴击率', { high: { median: 0.5 } }, null, 0.3, 'high');
  assert.equal(r2.suggestion, 0.5, '分布缺 → 方案值直出、无分位标注');
  assert.equal(r2.percentile, null);
});

test('toTargetDisplay：内部值 → user-config 整数口径', () => {
  assert.equal(toTargetDisplay('暴击率', 0.6), 60, '暴击类按 % 存整数');
  assert.equal(toTargetDisplay('攻击力', 3120.4), 3120);
  assert.equal(toTargetDisplay('攻击力', NaN), null);
});

test('targetGap：targetsOverride 显式目标即时演算（不读 charTarget）', () => {
  setCalcContext({ readCharTarget: () => ({}) }); // 若被误读将返回 null
  const R = {
    final: { 攻击力: 1000, 暴击率: 0.5 },
    base: { 攻击力: 500 },
    libCharacter: { maxLevel: { 攻击力: 600 } },
    libWengine: { baseAtk: 200 },
  };
  const gap = targetGap({}, R, { 攻击力: 1100, 暴击率: 60, 推荐音擎: ['x'] }); // 特殊键混入应被数值过滤剔除
  assert.ok(gap && gap.total > 0, '有缺口');
  const atk = gap.items.find((i) => i.name === '攻击力');
  const crit = gap.items.find((i) => i.name === '暴击率');
  assert.equal(atk.target, 1100);
  assert.equal(crit.target, 0.6, '暴击类 ÷100 内部化');
  assert.equal(atk.type, '攻击力%');
  assert.equal(crit.type, '暴击率');
  // 全达标 → items 空
  const done = targetGap({}, R, { 攻击力: 900, 暴击率: 40 });
  assert.deepEqual(done.items, []);
});
