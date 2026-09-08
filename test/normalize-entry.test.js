// test/normalize-entry.test.js —— workshop 条目规范归一化（normalizeEntry 纯函数，mys/2025 → 单格式）
// 纯内联 fixture，不依赖 data/，永远不会 SKIP。
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry } from '../src/sync/workshop.js';

test('normalizeEntry：mys 条目 → 规范格式（百分比 ×100、规范名、删 rarity、保留 source）', () => {
  const out = normalizeEntry({
    uid: 'u1',
    role_id: '1011',
    level: 60,
    rank: 6,
    relic_point: 300,
    source: 'mys',
    skills: [
      { type: 0, level: 12 },
      { type: 1, level: 11 },
    ],
    weapon: { id: '1101', name: 'xx', level: 60, rarity: 'A', main: [{ name: '基础攻击力', value: '624' }] },
    equips: [
      {
        id: '31341',
        name: '自由蓝调[1]',
        level: 15,
        rarity: 'S',
        suit: '自由蓝调',
        main: [{ name: '生命值', value: '2200' }],
        subs: [
          { name: '防御力', value: '45' },
          { name: '暴击伤害', value: '4.8%' },
          { name: '暴击率', value: '7.2%' },
          { name: '攻击力', value: '3%' },
        ],
      },
    ],
  });
  assert.equal(out.source, 'mys');
  assert.equal(out.weapon.rarity, undefined, 'weapon.rarity 删除');
  assert.equal(out.equips[0].rarity, undefined, 'equip.rarity 删除');
  assert.deepEqual(out.weapon.main, [{ name: '基础攻击力', value: 624 }], '固定值字符串 → 数字');
  assert.deepEqual(out.equips[0].main, [{ name: '生命值', value: 2200 }]);
  assert.deepEqual(
    out.equips[0].subs,
    [
      { name: '防御力', value: 45 },
      { name: '暴击伤害', value: 480 },
      { name: '暴击率', value: 720 },
      { name: '攻击力%', value: 300 },
    ],
    'mys 百分比字符串 → ×100 整数；攻击力 值带 % → 攻击力%'
  );
});

test('normalizeEntry：2025 条目 → 规范格式（值已是 ×100、名字经别名吸收、未知名保留）', () => {
  const out = normalizeEntry({
    role_id: '1311',
    source: '2025',
    equips: [
      {
        id: '32741',
        name: '折枝剑歌',
        suit: '折枝剑歌',
        rarity: 4,
        main: [{ name: '生命值百分比', value: 550 }],
        subs: [
          { name: '攻击力百分比', value: 900 },
          { name: '未知<999>', value: 12 },
        ],
      },
    ],
  });
  assert.equal(out.source, '2025');
  assert.deepEqual(out.equips[0].main, [{ name: '生命值%', value: 550 }], '生命值百分比 别名 → 生命值%');
  assert.deepEqual(
    out.equips[0].subs,
    [
      { name: '攻击力%', value: 900 },
      { name: '未知<999>', value: 12 },
    ],
    '攻击力百分比 别名 → 攻击力%；未知名原样保留'
  );
});

test('normalizeEntry：mys 数值型百分比词条不 double-count（回归：曾 ×100 成 60000，roll 2→6）', () => {
  const out = normalizeEntry({
    role_id: '1011',
    source: 'mys',
    equips: [
      {
        id: '1',
        suit: 'A',
        main: [{ name: '暴击率', value: 480 }],
        subs: [
          { name: '攻击力%', value: 600 }, // 数值已 ×100（mys 异常条目/旧数据形态）
          { name: '暴击率', value: 480 },
        ],
      },
    ],
  });
  assert.deepEqual(
    out.equips[0].subs,
    [
      { name: '攻击力%', value: 600 },
      { name: '暴击率', value: 480 },
    ],
    'mys 数值型百分比保持原样（仅字符串值才 ×100）'
  );
});

test('normalizeEntry：source 缺失 → 按 equips rarity 类型回填（number=2025、string=mys）；无 rarity → null', () => {
  assert.equal(normalizeEntry({ equips: [{ rarity: 4 }] }).source, '2025');
  assert.equal(normalizeEntry({ equips: [{ rarity: 'S' }] }).source, 'mys');
  assert.equal(normalizeEntry({ equips: [] }).source, null);
  assert.equal(normalizeEntry(null), null);
});

test('normalizeEntry：百分比字符串一律 ×100（穿透率等名字不在旧集合也乘）', () => {
  const e = normalizeEntry({
    source: 'mys',
    equips: [
      { main: [{ name: '穿透率', value: '24%' }] }, // 曾漏乘 → 24
      { main: [{ name: '暴击伤害', value: '48%' }] },
    ],
  });
  assert.equal(e.equips[0].main[0].value, 2400);
  assert.equal(e.equips[1].main[0].value, 4800);
});

test('normalizeEntry：固定值字符串（无 %）不乘 100；数字值原样透传', () => {
  const e = normalizeEntry({
    source: 'mys',
    equips: [{ main: [{ name: '生命值', value: '2200' }] }, { main: [{ name: '攻击力', value: 316 }] }],
  });
  assert.equal(e.equips[0].main[0].value, 2200);
  assert.equal(e.equips[1].main[0].value, 316);
});
