// test/discProb.test.js —— 驱动盘练度提升概率计算（ZZZ-DDC 移植）
// 纯内联 fixture，不依赖 data/，永远不会 SKIP
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  passChance,
  computeDiscProb,
  computePosProb,
  buildTypes,
  roleWeightsFromWs,
  DEFAULT_WEIGHTS,
} from '../src/game/index.js';
import {
  MAIN_STAT_OPTIONS,
  DISC_MAIN_PROB_WEIGHTS,
  DISC_SUBSTATS,
  DISC_SUBSTAT_SPECIAL_WEIGHTS,
} from '../src/game/index.js';

test('passChance：强化成长通过率（确定性手算）', () => {
  // 词条 [1,1]（两条权重 1），2 次成长：nowAdd 恒为 2
  assert.equal(passChance(2, 1, [1, 1]), 1); // 2 > 1 ✓
  assert.equal(passChance(2, 2, [1, 1]), 0); // 2 > 2 严格大于，不通过
  assert.equal(passChance(2, 3, [1, 1]), 0);
  // 词条 [1, 0]：2 次成长，need=1 → 4 条路径 add 为 2、1、1、0，仅 2>1 通过
  assert.equal(passChance(2, 1, [1, 0]), 0.25); // 2>1 ✓, 1>1 ✗, 1>1 ✗, 0>1 ✗
  assert.equal(passChance(0, 1, [1, 0]), 0); // 0 次成长
});

test('computeDiscProb：确定性 + 边界（概率随目标分单调不增）', () => {
  // 精简池：3 种词条，各 rest=2，可枚举 4 词条组合
  const types = [
    { typeIndex: 0, score: 1, rest: 2, specialWeight: 10 },
    { typeIndex: 1, score: 0.5, rest: 2, specialWeight: 10 },
    { typeIndex: 2, score: 0, rest: 2, specialWeight: 10 },
  ];
  const r1 = computeDiscProb(types, 1);
  const r2 = computeDiscProb(types, 1);
  assert.equal(r1.chance, r2.chance, '同参结果应确定');
  assert.ok(r1.chance > 0 && r1.chance <= 1, '概率应在 (0,1]');
  const gs = [0.5, 1, 2, 4, 8];
  let prev = Infinity;
  for (const g of gs) {
    const c = computeDiscProb(types, g).chance;
    assert.ok(c <= prev + 1e-12, `目标分 ${g} 概率 ${c} 应 ≤ 上一档 ${prev}`);
    prev = c;
  }
  assert.equal(computeDiscProb(types, 1e9).chance, 0, '目标远超上限概率为 0');
});

test('computeDiscProb：定向词条（首 4 词条必须含）过滤生效', () => {
  const types = [0, 1, 2, 3].map((i) => ({ typeIndex: i, score: 1, rest: 2, specialWeight: 10 }));
  const all = computeDiscProb(types, 0).chance;
  // 定向「必须含 typeIndex 4」——池里没有该类型 → 无满足组合 → 概率 0
  const impossible = computeDiscProb(types, 0, [4]).chance;
  assert.equal(impossible, 0, '定向类型不在池中应无满足组合');
  // 定向含池中类型：概率应 ≤ 全部组合的概率
  const directed = computeDiscProb(types, 0, [0]).chance;
  assert.ok(directed > 0 && directed <= all + 1e-12, `定向概率 ${directed} 应 ≤ 全组合 ${all}`);
});

test('buildTypes：构造 10 词条池并排除主词条同类', () => {
  const w = [0, 0, 1, 0.3, 0.3, 0, 0, 1, 1, 0];
  const t = buildTypes(w);
  assert.equal(t.length, 10);
  assert.equal(t[0].score, 0); // 生命值% 权重 0
  assert.equal(t[2].score, 1); // 攻击力% 权重 1
  assert.equal(t[8].score, 1); // 暴击率权重 1
  // 排除暴击率（idx 8）
  const t2 = buildTypes(w, 1, 8);
  assert.equal(t2[8].rest, 0, '主词条同类副词条应被禁用');
  assert.equal(t2[7].rest, 1);
});

test('computePosProb：位置系数与主词条加权', () => {
  const w = [0, 0, 1, 0.3, 0.3, 0, 0, 1, 1, 0];
  const pool = buildTypes(w);
  // 1 号位（无主词条）：prob = chance / 6
  const p1 = computePosProb(1, null, pool, 3);
  const direct = computeDiscProb(pool, 3).chance;
  assert.ok(Math.abs(p1.prob - direct / 6) < 1e-12, '1号位概率 = chance/6');
  // 4 号位全主词条：各主词条按 MAIN_PROB_WEIGHTS 加权
  const p4 = computePosProb(4, null, pool, 3);
  assert.ok(p4.prob > 0 && p4.prob <= 1);
  // 单主词条 = 主词条出现概率 × 排除同类池的 chance/6（主词条概率按全位置权重和归一，非选中集）
  const p4single = computePosProb(4, ['暴击率'], pool, 3);
  const poolNoCrit = pool.map((t) => ({ ...t, rest: t.typeIndex === 8 ? 0 : t.rest }));
  const totalAll = Object.values(DISC_MAIN_PROB_WEIGHTS[4]).reduce((s, v) => s + v, 0);
  const expectSingle = (computeDiscProb(poolNoCrit, 3).chance * (DISC_MAIN_PROB_WEIGHTS[4]['暴击率'] / totalAll)) / 6;
  assert.ok(Math.abs(p4single.prob - expectSingle) < 1e-12, '单主词条概率 = 主词条出现概率 × 排除同类池的 chance/6');
});

test('roleWeightsFromWs：标准名 key 直接匹配（% 与固定共享父属性权重）', () => {
  // 落地数据 key 已是 CONSTANT 标准名（抽取时映射）
  const weightJson = {
    1011: {
      factions: [
        {
          name: '默认流派',
          weights: [
            { key: '攻击力', weight: 1 },
            { key: '暴击率', weight: 0.75 },
            { key: '暴击伤害', weight: 0.5 },
            { key: '穿透值', weight: 0.25 },
            { key: '异常精通', weight: 0.6 },
          ],
        },
      ],
    },
  };
  const gradRoles = [{ item_id: '1011', name: '测试角色' }];
  const w = roleWeightsFromWs('测试角色', weightJson, gradRoles);
  // 10 维顺序：生命值%/生命值/攻击力%/攻击力/穿透值/防御力%/防御力/暴击伤害/暴击率/异常精通
  assert.deepEqual(w, [0, 0, 1, 1, 0.25, 0, 0, 0.5, 0.75, 0.6], '标准名直接匹配，攻击力%/攻击力 共享「攻击力」权重');
  assert.equal(roleWeightsFromWs('不存在', weightJson, gradRoles), null, '查不到角色返回 null');
  assert.deepEqual(DEFAULT_WEIGHTS.length, 10, '默认模板为 10 维');
});

test('常量：词条体系与主词条表完整性（名称与项目统一）', () => {
  assert.equal(DISC_SUBSTATS.length, 10);
  assert.equal(DISC_SUBSTAT_SPECIAL_WEIGHTS.length, 10);
  assert.equal(DISC_SUBSTATS[2], '攻击力%', '副词条名称用项目标准名（SUBSTAT）');
  assert.equal(DISC_SUBSTATS[9], '异常精通');
  for (const pos of [4, 5, 6]) {
    assert.ok(MAIN_STAT_OPTIONS[pos].length > 0, `${pos} 号位应有主词条候选`);
    // 主词条名与概率表 key 一致
    for (const m of MAIN_STAT_OPTIONS[pos]) {
      assert.ok(DISC_MAIN_PROB_WEIGHTS[pos][m] > 0, `${pos} 号位 ${m} 应有概率权重`);
    }
  }
  assert.equal(MAIN_STAT_OPTIONS[4].includes('暴击率'), true);
});

test('computePosProb：1/2/3 号位对称性——同池同目标概率严格相等，需求命中越高概率越低（不变量护栏：盘卡概率差异只能来自各盘当前质量）', () => {
  // 需求词条 = 暴击伤害(7) + 暴击率(8)，等权（与手风琴盘卡的 0/1 需求口径一致）
  const types = buildTypes([0, 0, 0, 0, 0, 0, 0, 1, 1, 0]);
  const p1 = computePosProb(1, [], types, 3);
  const p2 = computePosProb(2, [], types, 3);
  const p3 = computePosProb(3, [], types, 3);
  assert.equal(p1.prob, p2.prob, '1/2 号位主词条固定且不屏蔽需求词条 → 概率必须严格相等');
  assert.equal(p2.prob, p3.prob, '2/3 号位同上');
  assert.ok(p1.hitMain === 1 / 6 && p2.hitMain === 1 / 6, '1/2/3 号位均为位置均摊 1/6');
  // 同一盘位：当前盘需求命中越高（盘越强）→ 被超越概率单调不增
  const hard = computePosProb(1, [], types, 5);
  const easy = computePosProb(1, [], types, 1);
  assert.ok(hard.prob < p1.prob && p1.prob < easy.prob, 'goal 1 < 3 < 5 → 概率严格递减');
  // 4/5/6 号位：唯一需求词条与主词条同类时被屏蔽 → 概率归零（模型自带；多需求词条时只是被去掉一条路，不归零）
  const onlyCrit = buildTypes([0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
  const blocked = computePosProb(4, ['暴击率'], onlyCrit, 3);
  assert.equal(blocked.prob, 0, '4 号位主词条暴击率屏蔽暴击率副词条 → 唯一需求词条不可得 → 概率 0');
});

test('passChance/computeDiscProb：持平口径（op = ">="，不低于）——确定性手算与不变量', () => {
  // 2 次强化、每条线 score 1/0：路径 add = 2,1,1,0 → 严格大于 1 占 1/4，不低于 1 占 3/4，恰好等于 1 占 2/4
  assert.ok(Math.abs(passChance(2, 1, [1, 0]) - 1 / 4) < 1e-12, '默认 op = ">" 语义不变（与上方确定性手算一致）');
  assert.ok(Math.abs(passChance(2, 1, [1, 0], '=') - 2 / 4) < 1e-12, 'op = "=" 数恰好补齐差额的路径');
  assert.ok(Math.abs(passChance(2, 1, [1, 0], '>=') - 3 / 4) < 1e-12, 'op = ">=" 数不低于差额的路径（= 超过 + 打平）');
  // 不变量：持平（≥）恒 ≥ 超过（>）；超过 + 不足 + 打平 = 1 的完整性由 ≥ = > + = 保证
  const types = buildTypes([0, 0, 0, 0, 0, 0, 0, 1, 1, 0]);
  const gt = computeDiscProb(types, 3);
  const ge = computeDiscProb(types, 3, [], '>=');
  const eq = computeDiscProb(types, 3, [], '=');
  assert.ok(ge.chance >= gt.chance, '持平（不低于）恒 ≥ 超过');
  assert.ok(Math.abs(ge.chance - (gt.chance + eq.chance)) < 1e-9, '≥ = > + = 精确成立');
  assert.ok(ge.p4 > 0 && ge.p3 > 0, '持平的 4/3 词条条件概率非零');
  // 位置级：同不变量
  const posGt = computePosProb(2, [], types, 3);
  const posTie = computePosProb(2, [], types, 3, [], {}, '>=');
  assert.ok(posTie.prob >= posGt.prob && posTie.prob <= 1, '2 号位持平 ≥ 超过 且 ≤ 1');
});
