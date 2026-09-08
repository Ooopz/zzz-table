// test/buildBench.test.js —— lib/buildBench 纯函数单测：套装组合推导 + 我的/推荐/真实玩家三方配装对标结构。
// 纯内联 fixture，不依赖 data/，永远不会 SKIP。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mySetCombo, computeBuildBench } from '../src/lib/buildBench.js';

const d = (set, n) => Array.from({ length: n }, () => ({ set }));

test('mySetCombo：6 盘按 set 计数推导（4+2 组合，4 件套在前）', () => {
  const combo = mySetCombo([...d('震星迪斯科', 4), ...d('啄木鸟电音', 2)]);
  assert.equal(combo.name, '震星迪斯科4+啄木鸟电音2', '组合名 = 4 件套在前 + 2 件套在后');
  assert.deepEqual(
    combo.sets.map((s) => [s.name, s.num]),
    [
      ['震星迪斯科', 4],
      ['啄木鸟电音', 2],
    ],
    'sets 带 num、件数降序'
  );
});

test('mySetCombo：5/6 件同套装压到 4 件套，1 件套装不计', () => {
  assert.equal(
    mySetCombo([...d('震星迪斯科', 5), { set: '独此一碟' }]).name,
    '震星迪斯科4',
    '5 件算 4 件套、1 件不产生套装效果'
  );
  assert.equal(mySetCombo(d('震星迪斯科', 6)).name, '震星迪斯科4', '6 件也只算 4 件套');
});

test('mySetCombo：无 ≥2 件套装或空输入 → null', () => {
  assert.equal(mySetCombo([]), null, '空盘');
  assert.equal(mySetCombo(null), null, 'null');
  assert.equal(mySetCombo([{ set: 'A' }, { set: 'B' }]), null, '全 1 件不构成套装效果');
});

test('computeBuildBench：三方齐全，推荐/真实玩家 Top3，真实玩家跳过「其他」', () => {
  const bench = computeBuildBench({
    my: { wengine: { name: '空羽复归之诗', refinement: 2 }, discs: [...d('震星迪斯科', 4), ...d('啄木鸟电音', 2)] },
    planBuild: {
      wengines: [
        { name: '残响-Ⅱ型', percent: 50 },
        { name: '嵌合编译器', percent: 30 },
        { name: '啜泣摇篮', percent: 20 },
      ],
      relics: [
        {
          name: 'X4+Z2',
          sets: [
            { name: 'X', num: 4 },
            { name: 'Z', num: 2 },
          ],
          percent: 40,
        },
        {
          name: 'X4+W2',
          sets: [
            { name: 'X', num: 4 },
            { name: 'W', num: 2 },
          ],
          percent: 30,
        },
        { name: 'V4', sets: [{ name: 'V', num: 4 }], percent: 20 },
      ],
    },
    gradRole: {
      weapons: [
        { name: '其他', percent: 5 },
        { name: '索魂影眸', percent: 30 },
        { name: '空羽复归之诗', percent: 25 },
        { name: '嵌合编译器', percent: 20 },
      ],
      relics: [
        { name: '其他', percent: 5 },
        { name: 'Y4', sets: [{ name: 'Y', num: 4 }], percent: 25 },
        {
          name: 'Y4+Z2',
          sets: [
            { name: 'Y', num: 4 },
            { name: 'Z', num: 2 },
          ],
          percent: 22,
        },
        { name: 'W4', sets: [{ name: 'W', num: 4 }], percent: 18 },
      ],
    },
  });
  // 音擎三方
  assert.equal(bench.wengine.mine.name, '空羽复归之诗', '我的音擎名');
  assert.equal(bench.wengine.mine.refinement, 2, '我的音擎精炼');
  assert.equal(bench.wengine.rec.length, 3, '推荐音擎 Top3');
  assert.equal(bench.wengine.rec[0].name, '残响-Ⅱ型', '推荐音擎 Top1');
  assert.equal(bench.wengine.rec[2].percent, 20, '推荐音擎 Top3 占比');
  assert.equal(bench.wengine.live.length, 3, '真实玩家跳过「其他」取 Top3');
  assert.equal(bench.wengine.live[0].name, '索魂影眸', '真实玩家音擎 Top1');
  assert.equal(bench.wengine.live[1].name, '空羽复归之诗', '真实玩家音擎 Top2');
  // 套装三方
  assert.equal(bench.sets.mine.name, '震星迪斯科4+啄木鸟电音2', '我的套装组合推导');
  assert.equal(bench.sets.rec.length, 3, '推荐套装 Top3');
  assert.equal(bench.sets.rec[0].name, 'X4+Z2', '推荐套装 Top1');
  assert.equal(bench.sets.rec[0].percent, 40, '推荐套装占比');
  assert.equal(bench.sets.live.length, 3, '真实玩家套装跳过「其他」取 Top3');
  assert.equal(bench.sets.live[0].name, 'Y4', '真实玩家套装 Top1');
  assert.equal(bench.sets.live[0].percent, 25, '真实玩家套装占比');
});

test('computeBuildBench：缺侧为 空数组/单条 null（无账号数据 / 无方案 / 无工坊实况）', () => {
  const empty = computeBuildBench({ my: null, planBuild: null, gradRole: null });
  assert.equal(empty.wengine.mine, null);
  assert.deepEqual(empty.wengine.rec, [], '无方案 → 空数组');
  assert.deepEqual(empty.wengine.live, [], '无实况 → 空数组');
  assert.equal(empty.sets.mine, null);
  assert.deepEqual(empty.sets.rec, []);
  assert.deepEqual(empty.sets.live, []);
  // 部分缺失：有方案无实况
  const onlyPlan = computeBuildBench({
    my: null,
    planBuild: { wengines: [{ name: 'A', percent: 10 }], relics: [] },
    gradRole: null,
  });
  assert.equal(onlyPlan.wengine.rec.length, 1, '有方案给推荐');
  assert.equal(onlyPlan.wengine.rec[0].name, 'A', '有方案给推荐');
  assert.deepEqual(onlyPlan.wengine.live, [], '无实况给空数组');
});
