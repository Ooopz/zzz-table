// test/validateWorkshopStats.test.js —— 工坊聚合出口自检（validateWorkshopStats）
// 纯函数 + 真实数据冒烟：合法数据零误报，各类回归（NaN/分位破序/dist 合计漂移/负计数/拥有率越界）必须被抓。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkshopStats } from '../src/lib/validateWorkshopStats.js';
import { loadDataFile } from './helpers.js';

/** 最小合法 stats（各 section 满足自检所需结构） */
function validStats() {
  return {
    meta: { scrapedAt: '2026-09-08T00:00:00.000Z', entries: 10, poolUids: 5 },
    panels: [
      {
        name: '1011',
        stats: {
          攻击力: {
            count: 4,
            min: 100,
            max: 200,
            mean: 150,
            median: 150,
            sd: 30,
            p10: 105,
            p25: 120,
            p50: 150,
            p75: 180,
            p90: 195,
            p99: 199,
            skew: -0.5, // 可为负
            kurt: 2.3,
            outliers: 0,
          },
        },
      },
    ],
    discDetails: [
      { name: '套', equips: 12, characters: ['角色'], mainDenom: { 4: 12 }, effDist: { 0: 3, 4: 1 } },
    ],
    panelScatter: {
      perRole: {
        1011: { 攻击力_暴击率: { xName: '攻击力', yName: '暴击率', xMin: 0, xMax: 10, yMin: 0, yMax: 1, N: 3, data: [[1, 2, 5], [3, 4, 1]] } },
      },
    },
    relicStats: { 1011: { count: 3, min: 50, max: 70, mean: 60, median: 60, sd: 5, p10: 52, p90: 68 } },
    rankDist: { 1011: { 0: 1, 1: 2, 6: 3 } },
    skillStats: { 1011: { 0: { count: 3, min: 1, max: 3, mean: 2, median: 2, p10: 1, p90: 3, dist: { 1: 1, 2: 1, 3: 1 } } } },
    roleOwnership: { 1011: 0.5 },
    skillLevelModes: { 1011: { 0: 3, 5: 7 } },
  };
}

test('合法数据零误报', () => {
  assert.deepEqual(validateWorkshopStats(validStats()), []);
});

test('NaN 注入被全局扫描抓住', () => {
  const d = validStats();
  d.panels[0].stats.攻击力.mean = NaN;
  assert.match(validateWorkshopStats(d)[0], /非有限/);
});

test('分位数破序 / median≠p50 / mean 越界被抓', () => {
  const d1 = validStats();
  d1.panels[0].stats.攻击力.p90 = d1.panels[0].stats.攻击力.median - 10;
  assert.match(validateWorkshopStats(d1)[0], /单调不减/);

  const d2 = validStats();
  d2.panels[0].stats.攻击力.mean = 999;
  assert.match(validateWorkshopStats(d2)[0], /超出 \[min,max\]/);

  const d3 = validStats();
  d3.panels[0].stats.攻击力.median = 123;
  assert.match(validateWorkshopStats(d3)[0], /median.*≠.*p50/);
});

test('skillStats dist 合计漂移 / 档位错位被抓（两层级联结构）', () => {
  const d1 = validStats();
  d1.skillStats['1011'][0].dist[3] += 5; // 合计超出 count
  assert.match(validateWorkshopStats(d1)[0], /dist 各档合计.*≠ count/);

  const d2 = validStats();
  d2.skillStats['1011'][0].min = 999; // min 越过 max
  assert.match(validateWorkshopStats(d2)[0], /min\(999\) > max/);
});

test('负计数 / 拥有率越界 / 影画档越界被抓', () => {
  const d1 = validStats();
  d1.rankDist['1011'][3] = -1;
  assert.match(validateWorkshopStats(d1)[0], /须为 ≥0 整数/);

  const d2 = validStats();
  d2.rankDist['1011'][9] = 2;
  assert.match(validateWorkshopStats(d2)[0], /超出 \[0,6\]/);

  const d3 = validStats();
  d3.roleOwnership['1011'] = 1.4;
  assert.match(validateWorkshopStats(d3)[0], /超出 \[0,1\]/);
});

test('真实数据冒烟：workshop-stats.json 通过出口自检', () => {
  const stats = loadDataFile('workshop-stats.json', 'npm run sync:workshop');
  const issues = validateWorkshopStats(stats);
  assert.deepEqual(issues, [], `真实 workshop-stats 应零误报，违规:\n  - ${issues.slice(0, 5).join('\n  - ')}`);
});
