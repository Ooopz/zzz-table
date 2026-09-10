// test/plansSlim.test.js —— sync/plans.js 载荷瘦身契约单测（原 lib/plansSlim.js，2026-09 并入）：剥离 desc/skills 后其余字段与嵌套 plans 数组保留。
// server /api/data 与 publish-release 静态构建共用该瘦身，剥离集改动须红本测试（纯内联，永不 SKIP）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { slimPlans } from '../src/sync/plans.js';

test('slimPlans：剥离 desc/skills，其余字段保留，plans 嵌套数组逐条瘦身', () => {
  const plans = {
    1001: {
      name: '测试角色',
      avatarId: 1001,
      plans: [
        {
          id: 'a',
          name: '方案A',
          desc: '一大段攻略正文……',
          skills: [{ type: 1, level: 12 }],
          panel: { 攻击力: { final: 1000 } },
          topW: { wengine: 'X' },
        },
        { id: 'b', name: '方案B', panel: { 生命值: { final: 5000 } } }, // 无 desc/skills 也应原样
      ],
    },
  };
  const out = slimPlans(plans);
  assert.equal(Object.keys(out).length, 1, '角色层键保留');
  assert.equal(out[1001].name, '测试角色', '角色层字段保留');
  assert.deepEqual(Object.keys(out[1001].plans[0]).sort(), ['id', 'name', 'panel', 'topW'], 'desc/skills 已剥离、其余键保留');
  assert.equal('desc' in out[1001].plans[0], false);
  assert.equal('skills' in out[1001].plans[0], false);
  assert.deepEqual(out[1001].plans[1], { id: 'b', name: '方案B', panel: { 生命值: { final: 5000 } } }, '无剥离字段的方案原样保留');
  // 不修改原对象
  assert.ok(plans[1001].plans[0].desc.length > 0, '原对象不应被改动');
  // 空输入 / 缺失字段不抛错
  assert.deepEqual(slimPlans({}), {});
  assert.deepEqual(slimPlans(null), {});
  assert.deepEqual(slimPlans({ 1001: { name: 'x' } }), { 1001: { name: 'x', plans: [] } }, '缺 plans 数组不抛错');
});
