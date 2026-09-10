// test/workshopAgg.test.js —— 工坊统计聚合：驱动盘单盘 / 面板散点 / 新指标聚合（评分·影画分层·技能·角色盘）
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  computeWorkshopStats,
  computeWorkshopDiscStats,
  computePanelScatter,
  computeRelicStats,
  computeRankDist,
  computeSkillStats,
  buildRoleSubstatWeights,
  computeAllWorkshopStats,
  computeRoleOwnership,
  computeSkillLevelModes,
} from '../src/lib/workshopAgg.js';
import { substatRolls } from '../src/game/index.js';
import { buildNameIndex, CATEGORY } from '../src/lib/names.js';
import { normalizeStatKey } from '../src/lib/util.js';
import { iterWorkshopFile } from '../src/lib/nodeUtil.js';
import { loadDataFile } from './helpers.js';

test('normalizeStatKey：workshop 别名吸收（归一化后词条名已是规范名，幂等）', () => {
  assert.equal(normalizeStatKey('攻击力百分比'), '攻击力%');
  assert.equal(normalizeStatKey('暴击率百分比'), '暴击率');
  assert.equal(normalizeStatKey('暴击伤害百分比'), '暴击伤害');
  assert.equal(normalizeStatKey('异常掌控百分比'), '异常掌控');
  assert.equal(normalizeStatKey('能量回复百分比'), '能量自动回复');
  assert.equal(normalizeStatKey('攻击力'), '攻击力');
  assert.equal(normalizeStatKey('暴击率'), '暴击率');
  assert.equal(normalizeStatKey('物理伤害'), '物理伤害加成');
  assert.equal(normalizeStatKey('未知<123>'), '未知<123>', '未知名原样返回');
  assert.equal(normalizeStatKey(null), null);
});

test('computeWorkshopDiscStats：两源混合聚合（主词条/副词条/槽位/角色/别名/幂等）', () => {
  const discIndex = buildNameIndex(['静听嘉音', '荆棘玫瑰'], CATEGORY.DISC);
  const roleNameMap = new Map([
    ['1341', '维琳娜·艾嘉德'],
    ['1361', '艾莲'],
  ]);
  const entries = [
    // —— 2025 源：id 末位=槽，main[0]=真实主词条，subs=副词条 ——
    {
      uid: 'u1',
      role_id: '1341',
      equips: [
        {
          id: '33144',
          suit: '静听嘉音',
          main: [{ name: '攻击力百分比', value: 3000 }],
          subs: [
            { name: '攻击力百分比', value: 480 },
            { name: '暴击伤害百分比', value: 480 },
          ],
        },
        {
          id: '33145',
          suit: '静听嘉音',
          main: [{ name: '攻击力', value: 3000 }],
          subs: [{ name: '暴击率百分比', value: 480 }],
        },
      ],
    },
    // —— mys 源：name [N]，与 2025 同构（main=主词条、subs=全部副词条） ——
    {
      uid: 'u2',
      role_id: '1341',
      equips: [
        {
          name: '静听嘉音[5]',
          suit: '静听嘉音',
          main: [{ name: '穿透率', value: 480 }],
          subs: [
            { name: '攻击力%', value: 600 },
            { name: '暴击率', value: 480 },
          ],
        },
      ],
    },
    // —— 套装别名（旧名棘刺玫瑰→荆棘玫瑰）+ 另一角色 ——
    {
      uid: 'u3',
      role_id: '1361',
      equips: [
        {
          name: '棘刺玫瑰[1]',
          suit: '棘刺玫瑰',
          main: [{ name: '防御力%', value: 600 }],
          subs: [{ name: '生命值', value: 224 }],
        },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, { roleNameMap });
  assert.equal(out.length, 2, '只含出现的盘');
  const 静听 = out.find((d) => d.name === '静听嘉音');
  const 棘刺 = out.find((d) => d.name === '荆棘玫瑰');
  assert.ok(静听 && 棘刺, '套装别名解析为规范名');
  // 静听嘉音：equips = 2 块 2025 + 1 块 mys = 3（物理盘数）
  assert.equal(静听.equips, 3);
  // 主词条：两源都参与（槽4=攻击力% 2025 扁平经 mainStatName 兜底；槽5=2025 攻击力% + mys 穿透率）
  assert.deepEqual(静听.main456[4], [{ name: '攻击力%', count: 1 }]);
  assert.deepEqual(Object.fromEntries(静听.main456[5].map((f) => [f.name, f.count])), { '攻击力%': 1, 穿透率: 1 });
  assert.deepEqual(静听.main456[6], []);
  // mainDenom：每槽所有盘（槽4:1、槽5:2、槽6:0）
  assert.deepEqual(静听.mainDenom, { 4: 1, 5: 2, 6: 0 });
  // 副词条：两源 subs 全量合并（mys 盘穿透率是主词条不参与；生命值属棘刺盘在下方断言）
  const subMap = Object.fromEntries(静听.subs.map((f) => [f.name, f.count]));
  assert.deepEqual(subMap, { '攻击力%': 2, 暴击伤害: 1, 暴击率: 2 });
  // 角色：两个 entry 同 role_id → 去重 1 个名字
  assert.deepEqual(静听.characters, ['维琳娜·艾嘉德']);
  // 荆棘玫瑰：mys 盘（槽1 主词条防御力% 不在 456 范围），副词条 生命值，角色去重
  assert.equal(棘刺.equips, 1);
  assert.deepEqual(棘刺.main456, { 4: [], 5: [], 6: [] }, '槽1 主词条不在 456 范围');
  assert.deepEqual(Object.fromEntries(棘刺.subs.map((f) => [f.name, f.count])), { 生命值: 1 });
  assert.deepEqual(棘刺.characters, ['艾莲']);
  // 幂等：同 entries 跑两遍深相等
  assert.deepEqual(computeWorkshopDiscStats(entries, discIndex, { roleNameMap }), out);
});

test('computeWorkshopDiscStats：不传 roleNameMap 时 characters 落回 role_id；同配装 4 件套计 4 块盘', () => {
  const discIndex = buildNameIndex(['如影相随'], CATEGORY.DISC);
  const entries = [
    {
      uid: 'u1',
      role_id: '1341',
      equips: [
        { id: '32901', suit: '如影相随', main: [{ name: '生命值', value: 1000 }], subs: [] },
        { id: '32902', suit: '如影相随', main: [{ name: '攻击力', value: 1000 }], subs: [] },
        { id: '32903', suit: '如影相随', main: [{ name: '防御力', value: 1000 }], subs: [] },
        { id: '32904', suit: '如影相随', main: [{ name: '攻击力百分比', value: 3000 }], subs: [] },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, {});
  assert.equal(out[0].equips, 4, '同配装 4 件套 = 4 块盘');
  assert.deepEqual(out[0].characters, ['1341'], '无 roleNameMap → role_id');
  assert.deepEqual(out[0].mainDenom, { 4: 1, 5: 0, 6: 0 }, '槽4 是 2025 盘');
  assert.deepEqual(out[0].main456[4], [{ name: '攻击力%', count: 1 }], '扁平 攻击力 经 mainStatName 兜底为 攻击力%');
});

test('真实数据冒烟：workshop.json 全量聚合不抛错、计数合法', () => {
  const lib = loadDataFile('library.json', 'npm run sync:library（或网页「更新数据库」）');
  const grad = loadDataFile('workshop-grad.json', 'node src/sync/workshop.js');
  const discIndex = buildNameIndex(lib.discs, CATEGORY.DISC);
  const roleNameMap = new Map((grad.roles || []).map((r) => [String(r.item_id), r.name]));
  // workshop.json 为分块 gzip（~0.2GB），用流式逐块解压抽样前 5 万条验证聚合逻辑
  // ⚠️ 本文件不经过 helpers.loadDataFile，须自行尊重 REQUIRE_DATA 语义——曾无条件 exit(0) 让 CI 对最大的数据文件失去守卫
  const entries = [];
  try {
    for (const e of iterWorkshopFile(fileURLToPath(new URL('../data/workshop.json', import.meta.url)))) {
      entries.push(e);
      if (entries.length >= 50000) break;
    }
  } catch (e) {
    const missing = e && e.code === 'ENOENT';
    console.error('\n[test] ' + (missing ? '缺少' : '损坏/读不了（' + (e.code || e.message) + '）') + ' data/workshop.json，本文件的真实数据冒烟测试无法运行。');
    console.error('  请先更新数据：node src/sync/workshop.js\n');
    process.exit(missing && process.env.REQUIRE_DATA !== '1' ? 0 : 1);
  }
  const out = computeWorkshopDiscStats(entries, discIndex, { roleNameMap });
  assert.ok(out.length > 0, '应聚合出盘');
  for (const d of out) {
    assert.ok(d.equips > 0);
    assert.ok(d.characters.length > 0);
    for (const k of [4, 5, 6]) {
      const sum = d.main456[k].reduce((s, f) => s + f.count, 0);
      assert.ok(sum <= d.mainDenom[k], `${d.name} 槽${k} 主词条计数不超过分母`);
      for (const f of d.main456[k]) assert.ok(f.count > 0);
    }
    assert.ok(d.subs.length > 0);
  }
});

test('computeWorkshopDiscStats 新字段：有效强化次数分布 / 副词条组合 / 主词条×副词条协同', () => {
  const discIndex = buildNameIndex(['静听嘉音', '荆棘玫瑰'], CATEGORY.DISC);
  const entries = [
    // —— 2025 源盘（id 末位=槽4）：主词条 + 4 个有效副词条 ——
    {
      uid: 'u1',
      role_id: '1341',
      equips: [
        {
          id: '11114',
          suit: '静听嘉音',
          main: [{ name: '暴击率百分比', value: 2400 }],
          subs: [
            { name: '攻击力百分比', value: 480 },
            { name: '暴击伤害百分比', value: 480 },
            { name: '暴击率百分比', value: 480 },
            { name: '异常精通', value: 12 },
          ],
        },
      ],
    },
    // —— mys 源盘（name 末尾 [1]，同构：main=主词条、subs=副词条全量，含无效词条 异常掌控） ——
    {
      uid: 'u2',
      role_id: '1341',
      equips: [
        {
          name: '静听嘉音[1]',
          suit: '静听嘉音',
          main: [{ name: '攻击力%', value: 600 }],
          subs: [
            { name: '攻击力%', value: 600 },
            { name: '暴击率', value: 480 },
            { name: '异常掌控', value: '12' },
          ],
        },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, {});
  const 静听 = out.find((d) => d.name === '静听嘉音');
  assert.ok(静听, '应聚合出盘');
  // 有效强化次数分布（roll 口径，未传 weightJson → 有效集合退化为全部合法副词条）：
  //   2025 盘 = 攻击% 480/300→2 + 暴伤 480/480→1 + 暴率 480/240→2 + 精通 12/9→1 = 6 次
  //   mys  盘 = 攻击% 6/3→2 + 暴率 4.8/2.4→2（异常掌控不在 SUBSTAT_TYPE_SET，剔除）= 4 次
  assert.deepEqual(静听.effDist, { 4: 1, 6: 1 });
  // 副词条组合：两盘各一个组合（归一名排序去重）
  assert.ok(静听.subCombos.length >= 2);
  assert.equal(静听.subCombos[0].count, 1);
  assert.equal(new Set(静听.subCombos[0].combo).size, 4, '2025 盘组合含 4 词条');
  // 主词条×副词条协同：槽4 盘（主词条 暴击率）；mys 盘槽1 主词条不在 456 范围不参与
  assert.deepEqual(静听.mainSubCross[4]['暴击率'], { '攻击力%': 1, 暴击伤害: 1, 暴击率: 1, 异常精通: 1 });
  assert.ok(!静听.mainSubCross[1], '槽1 无协同（非 456 槽位）');
  assert.deepEqual(computeWorkshopDiscStats(entries, discIndex, {}), out);
});

test('computeWorkshopDiscStats：mys 与 2025 同构，主词条/协同统计两源全量参与', () => {
  const discIndex = buildNameIndex(['静听嘉音'], CATEGORY.DISC);
  const entries = [
    // —— 2025 源盘（id 末位=槽4）：主词条 + 副词条 ——
    {
      uid: 'u1',
      role_id: '1341',
      equips: [
        {
          id: '11114',
          suit: '静听嘉音',
          main: [{ name: '暴击率百分比', value: 2400 }],
          subs: [
            { name: '攻击力百分比', value: 480 },
            { name: '暴击伤害百分比', value: 480 },
          ],
        },
      ],
    },
    // —— mys 源盘（name 末尾 [4]）：同构 main=主词条、subs=全部副词条，含无效词条 ——
    {
      uid: 'u2',
      role_id: '1341',
      equips: [
        {
          name: '静听嘉音[4]',
          suit: '静听嘉音',
          main: [{ name: '暴击伤害', value: 960 }],
          subs: [
            { name: '暴击率', value: 480 },
            { name: '防御力', value: 15 }, // 无效副词条（防御力）也应参与统计
          ],
        },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, {});
  const 静听 = out.find((d) => d.name === '静听嘉音');
  assert.ok(静听, '应聚合出盘');
  assert.equal(静听.equips, 2, '两块盘都计数');
  // 主词条：两源都参与（槽4：暴击率 1 + 暴击伤害 1），分母为 2
  assert.equal(静听.mainDenom[4], 2, 'mys 盘也计入主词条分母');
  assert.deepEqual(Object.fromEntries(静听.main456[4].map((f) => [f.name, f.count])), { 暴击伤害: 1, 暴击率: 1 });
  // 副词条：mys 的无效词条（防御力）也计入
  const subMap = Object.fromEntries(静听.subs.map((f) => [f.name, f.count]));
  assert.deepEqual(subMap, { '攻击力%': 1, 暴击伤害: 1, 暴击率: 1, 防御力: 1 });
  // 有效强化次数：2025 盘 = 攻击% 480/300→2 + 暴伤 480/480→1 = 3；mys 盘 = 暴率 4.8/2.4→2 + 防御 15/15→1 = 3
  assert.deepEqual(静听.effDist, { 3: 2 });
  // D7 套装×槽位：两块盘都在 4 号位
  assert.deepEqual(静听.slotDist, { 1: 0, 2: 0, 3: 0, 4: 2, 5: 0, 6: 0 });
  // 主词条×副词条协同：两源都参与
  assert.deepEqual(静听.mainSubCross[4]['暴击率'], { '攻击力%': 1, 暴击伤害: 1 });
  assert.deepEqual(静听.mainSubCross[4]['暴击伤害'], { 暴击率: 1, 防御力: 1 });
  assert.deepEqual(computeWorkshopDiscStats(entries, discIndex, {}), out);
});

test('computePanelScatter：每角色/全体 2D 密度网格（攻击归一、幂等）', () => {
  const entries = [
    {
      role_id: '1011',
      panel: [
        { name: '暴击率', final: '0.5' },
        { name: '暴击伤害', final: '1.0' },
        { name: '攻击力', final: '3000' },
      ],
    },
    {
      role_id: '1011',
      panel: [
        { name: '暴击率', final: '0.6' },
        { name: '暴击伤害', final: '1.5' },
        { name: '攻击力', final: '3200' },
      ],
    },
    {
      role_id: '1011',
      panel: [
        { name: '暴击率', final: '0.7' },
        { name: '暴击伤害', final: '1.8' },
        { name: '攻击力', final: '3400' },
      ],
    },
    {
      role_id: '1031',
      panel: [
        { name: '暴击率', final: '40%' },
        { name: '暴击伤害', final: '120%' },
        { name: '攻击力', final: '2800' },
      ],
    },
  ];
  const out = computePanelScatter(entries);
  // 每角色（含攻击归一的攻击×暴伤）
  const r1011 = out.perRole['1011'];
  assert.ok(r1011, '1011 应有 perRole 数据');
  assert.ok(r1011['暴击率_暴击伤害'].data.length > 0);
  assert.ok(r1011['攻击力_暴击伤害'].data.length > 0);
  assert.equal(r1011['攻击力_暴击伤害'].xName, '攻击力');
  assert.ok(r1011['攻击力_暴击伤害'].xMin <= r1011['攻击力_暴击伤害'].xMax);
  // 全体
  assert.ok(out.global['暴击率_暴击伤害'].data.length > 0);
  assert.ok(out.global['攻击力_暴击伤害'].data.length > 0);
  // 网格坐标合法（xi/yi ∈ [0,23]）
  for (const g of [r1011['暴击率_暴击伤害'], out.global['攻击力_暴击伤害']]) {
    for (const [xi, yi, count] of g.data) {
      assert.ok(xi >= 0 && xi < 24 && yi >= 0 && yi < 24);
      assert.ok(count > 0);
    }
  }
  assert.deepEqual(computePanelScatter(entries), out);
});

// ---------- 新指标聚合 ----------

const NEW_META_ENTRIES = [
  // 角色 1011：2 条（rank 0 / rank 6），技能与评分各异（source 显式声明，type 为 canonical：0普攻/1闪避）
  {
    uid: 'u1',
    role_id: '1011',
    source: '2025',
    rank: 0,
    relic_point: 150,
    skills: [
      { type: 0, level: 9 },
      { type: 1, level: 7 },
    ],
    panel: [
      { name: '攻击力', final: '2000' },
      { name: '暴击率', final: '0.4' },
    ],
    equips: [
      {
        id: '11114',
        suit: '静听嘉音',
        main: [{ name: '暴击率', value: 480 }],
        subs: [
          { name: '攻击力%', value: 600 },
          { name: '异常掌控', value: '12' },
        ],
      },
    ],
  },
  {
    uid: 'u1',
    role_id: '1011',
    source: '2025',
    rank: 6,
    relic_point: 300,
    skills: [
      { type: 0, level: 12 },
      { type: 1, level: 12 },
    ],
    panel: [
      { name: '攻击力', final: '3000' },
      { name: '暴击率', final: '0.7' },
    ],
    equips: [
      {
        id: '11114',
        suit: '静听嘉音',
        main: [{ name: '暴击率', value: 480 }],
        subs: [
          { name: '暴击伤害', value: 960 },
          { name: '攻击力%', value: 600 },
        ],
      },
    ],
  },
  // 角色 1031：1 条（rank 2），评分 0（应被过滤）
  {
    uid: 'u2',
    role_id: '1031',
    source: '2025',
    rank: 2,
    relic_point: 0,
    skills: [{ type: 0, level: 10 }],
    panel: [{ name: '攻击力', final: '2500' }],
    equips: [],
  },
];

test('computeRelicStats：每角色评分分布，0/非法排除', () => {
  const out = computeRelicStats(NEW_META_ENTRIES);
  assert.ok(out['1011']);
  assert.equal(out['1011'].count, 2);
  assert.equal(out['1011'].min, 150);
  assert.equal(out['1011'].max, 300);
  assert.equal(out['1011'].median, 225);
  assert.equal(out['1031'], undefined, '0 评分角色不产出分布');
  // 字符串评分兜底（旧数据）
  const old = computeRelicStats([{ role_id: '1011', relic_point: '188.20' }]);
  assert.equal(old['1011'].mean, 188.2);
});

test('computeRankDist：每角色影画档位占比', () => {
  const out = computeRankDist(NEW_META_ENTRIES);
  assert.deepEqual(out['1011'], { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1 });
  assert.deepEqual(out['1031'], { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 });
});

test('computeSkillStats：每角色×技能类型的等级分布', () => {
  const out = computeSkillStats(NEW_META_ENTRIES);
  assert.ok(out['1011']);
  assert.equal(out['1011'][0].count, 2);
  assert.equal(out['1011'][0].median, 10.5, 'lightDist 分位与 computeDist 统一：排序 [9,12] 线性插值 = 10.5');
  assert.equal(out['1011'][1].median, 9.5, 'type1 闪避：排序 [7,12] 线性插值 = 9.5');
  assert.equal(out['1031'][0].count, 1);
  assert.equal(out['1031'][0].mean, 10);
});

test('computeSkillStats：canonical type 直入（词汇中立不做映射）', () => {
  // 2026-09 起官方→canonical 归一已前移到 sync 写入侧（sync/characters.js、workshop.js 各持映射副本，
  // 对账见 test/official-skill-type.test.js）；2026-08「1↔2 误映射」回归由彼处兜底，聚合侧零映射。
  const out = computeSkillStats([
    {
      role_id: '1011',
      source: 'mys',
      skills: [
        { type: 0, level: 12 }, // 普攻
        { type: 3, level: 11 }, // 特殊
        { type: 1, level: 10 }, // 闪避
        { type: 4, level: 9 }, // 终结/连携
        { type: 5, level: 7 }, // 核心
        { type: 2, level: 8 }, // 支援
      ],
    },
  ]);
  const d = out['1011'];
  assert.equal(d[0].median, 12, '普攻');
  assert.equal(d[1].median, 10, '闪避');
  assert.equal(d[2].median, 8, '支援');
  assert.equal(d[3].median, 11, '特殊技');
  assert.equal(d[4].median, 9, '终结/连携');
  assert.equal(d[5].median, 7, '核心');
});

test('computeSkillStats：无法判源条目同样计入（技能统计已不依赖判源）', () => {
  const out = computeSkillStats([
    {
      role_id: '1011',
      // 旧数据无 source（type 落盘已 canonical）：数组按 UI 顺序 [0,1,2,...]
      skills: [
        { type: 0, level: 12 },
        { type: 1, level: 10 },
        { type: 2, level: 8 },
      ],
    },
    {
      role_id: '1021',
      // 旧数据无 source：数组按 ID 顺序 [0,3,2,...]
      skills: [
        { type: 0, level: 12 },
        { type: 3, level: 11 },
        { type: 2, level: 8 },
      ],
    },
    {
      role_id: '1031',
      // 无 source 且 skills 不足 2 个 → 曾因无法判源被跳过，现同样计入
      skills: [{ type: 0, level: 12 }],
    },
  ]);
  assert.equal(out['1011'][0].median, 12, '无 source 条目正常计入');
  assert.equal(out['1011'][1].median, 10, 'type1 闪避');
  assert.equal(out['1011'][2].median, 8, 'type2 支援');
  assert.equal(out['1021'][3].median, 11, 'type3 特殊技');
  assert.equal(out['1021'][2].median, 8, 'type2 支援');
  assert.equal(out['1031'][0].count, 1, '无法判源条目不再被跳过');
});

test('computeWorkshopDiscStats：游戏规则白名单清洗（非法副词条/异常主词条过滤）', () => {
  const discIndex = buildNameIndex(['静听嘉音'], CATEGORY.DISC);
  const entries = [
    {
      uid: 'u1',
      role_id: '1011',
      equips: [
        // 2025 源脏装备：4 号位（id 末位 4）副词条含 穿透率百分比（非法），主词条 暴击率（合法）
        {
          id: '33144',
          suit: '静听嘉音',
          main: [{ name: '暴击率', value: 480 }],
          subs: [
            { name: '穿透率百分比', value: 600 },
            { name: '暴击率百分比', value: 480 },
          ],
        },
        // 5 号位（id 末位 5）主词条 穿透值（非候选 → 过滤），副词条 攻击力%（合法）
        {
          id: '33145',
          suit: '静听嘉音',
          main: [{ name: '穿透值', value: 9 }],
          subs: [{ name: '攻击力百分比', value: 480 }],
        },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, { roleNameMap: new Map([['1011', '安比']]) });
  const d = out[0];
  // 副词条：穿透率百分比 被过滤，只剩 暴击率（+攻击力%）
  assert.deepEqual(Object.fromEntries(d.subs.map((f) => [f.name, f.count])), { 暴击率: 1, '攻击力%': 1 });
  // 主词条：4 号位只统计候选内（暴击率 计入）；5 号位 穿透值 不在候选 → 不统计
  assert.deepEqual(Object.fromEntries(d.main456[4].map((f) => [f.name, f.count])), { 暴击率: 1 });
  assert.deepEqual(d.main456[5], []);
  assert.equal(d.mainDenom[4], 1);
  assert.equal(d.mainDenom[5], 1, '分母仍按物理盘数');
  // 组合也过滤：脏词条不参与
  for (const c of d.subCombos)
    assert.ok(
      c.combo.every((n) =>
        [
          '暴击率',
          '攻击力%',
          '暴击伤害',
          '穿透值',
          '异常精通',
          '攻击力',
          '防御力',
          '防御力%',
          '生命值',
          '生命值%',
        ].includes(n)
      )
    );
});

// ---------- computeWorkshopStats（顶层聚合入口） ----------
// 此前无测试覆盖：条目计数/4件套去重/百分比归一/空串缺失，全靠真实数据发现问题。

test('computeWorkshopStats：面板百分比归一为小数，空串/非法值视为缺失', () => {
  const out = computeWorkshopStats([
    {
      role_id: '1011',
      equips: [],
      panel: [
        { name: '暴击率', final: '70%' },
        { name: '攻击力', final: '3000' },
      ],
    },
    {
      role_id: '1011',
      equips: [],
      panel: [
        { name: '暴击率', final: '50%' },
        { name: '攻击力', final: '' },
      ],
    },
    { role_id: '1011', equips: [], panel: [{ name: '暴击率', final: null }] },
  ]);
  const s = out.panels.find((p) => p.name === '1011').stats;
  assert.equal(s['暴击率'].count, 2, '空串与 null 不计入样本');
  assert.equal(s['暴击率'].min, 0.5, '百分比归一为小数');
  assert.equal(s['暴击率'].max, 0.7);
  assert.equal(s['攻击力'].count, 1, '空串 final 被丢弃');
});

test('computeWorkshopStats：空输入返回同形空结果，不抛错', () => {
  for (const input of [[], null, undefined]) {
    const out = computeWorkshopStats(input);
    assert.deepEqual(out.panels, []);
  }
});

// ---------- 2026-08 新增：强化次数口径 / 角色权重 / 源判别 / 加权效率分 / 两源审计 ----------

test('substatRolls：×100 整数百分比还原次数（归一化后统一数值格式）', () => {
  assert.equal(substatRolls('暴击率', 480), 2);
  assert.equal(substatRolls('暴击伤害', 480), 1); // 480/100/4.8
  assert.equal(substatRolls('攻击力%', 900), 3); // 900/100/3
  assert.equal(substatRolls('攻击力', 57), 3);
  assert.equal(substatRolls('异常精通', 27), 3);
  assert.equal(substatRolls('生命值', 112), 1);
  assert.equal(substatRolls('暴击率', 99999), 6, '异常大值钳到量程上限');
  assert.equal(substatRolls('暴击率', 1), 0, '不足一次强化不计入');
  assert.equal(substatRolls('异常掌控', 480), 0, '不在基数表（非合法副词条）');
  assert.equal(substatRolls('攻击力', 0), 0);
  assert.equal(substatRolls('攻击力', null), 0);
  assert.equal(substatRolls('暴击率', 500), 2, '500/100/2.4=2.08 → 2');
});

test('buildRoleSubstatWeights：标准名 key → 副词条名展开，0/缺失 key 不入表', () => {
  // ⚠️ fixture 用落地格式：权重表 key 已是 CONSTANT 标准名（回归：曾用旧原始 key「暴击/攻击…」致除穿透值外全查空）
  const weightJson = {
    1011: {
      factions: [
        {
          name: '默认流派',
          weights: [
            { key: '攻击力', weight: 1 },
            { key: '暴击率', weight: 0.9 },
            { key: '暴击伤害', weight: 0.9 },
            { key: '生命值', weight: 0 },
            { key: '能量自动回复', weight: 1 },
          ],
        },
      ],
    },
    1021: { factions: [{ name: '默认流派', weights: [{ key: '异常精通', weight: 1 }] }] },
    1031: { factions: [] }, // 无流派 → 不入表
    1041: { factions: [{ name: '默认流派', weights: [{ key: '能量自动回复', weight: 1 }] }] }, // 只有主词条 key → 不入表
  };
  const m = buildRoleSubstatWeights(weightJson);
  assert.deepEqual([...m.keys()], ['1011', '1021'], '无可映射副词条的角色不入表');
  const a = m.get('1011');
  // 「攻击力」一个 key 同时展开到 攻击力% 与 攻击力（权重表不区分百分比/固定值）
  assert.deepEqual(Object.fromEntries(a), { 暴击率: 0.9, 暴击伤害: 0.9, '攻击力%': 1, 攻击力: 1 });
  assert.equal(a.has('生命值'), false, 'weight=0 视为不吃该属性');
  assert.equal(a.has('异常精通'), false, '缺 key 即不吃');
  assert.deepEqual(Object.fromEntries(m.get('1021')), { 异常精通: 1 });
  // 空输入不抛错
  assert.equal(buildRoleSubstatWeights(null).size, 0);
  assert.equal(buildRoleSubstatWeights({}).size, 0);
});

test('聚合入口：脏条目（null/空对象）不应中断整轮聚合', () => {
  // computeAllWorkshopStats 把同一条喂给全部 8 个累加器，任一处抛异常 = 2.13GB 全量重算零产出
  const ok = {
    role_id: '1011',
    uid: 'u1',
    rank: 0,
    relic_point: 100,
    weapon: { name: '擎' },
    equips: [{ id: '11114', name: '[4]', suit: '套', main: [{ name: '攻击力', value: '30%' }], subs: [] }],
    panel: [{ name: '攻击力', final: '3000' }],
    skills: [],
  };
  const dirty = [null, undefined, {}, ok];
  assert.doesNotThrow(() => computeWorkshopStats(dirty), 'computeWorkshopStats 应容忍脏条目');
  assert.doesNotThrow(() => computeAllWorkshopStats(dirty, {}), 'computeAllWorkshopStats 应容忍脏条目');
  // 且脏条目被跳过后，正常条目仍被统计
  const s = computeWorkshopStats(dirty);
  assert.ok(
    s.panels.some((p) => p.name === '1011'),
    '脏条目之后的正常条目仍应入统计'
  );
});

test('computeAllWorkshopStats：单遍历结果与逐个公开函数逐位相等', () => {
  // 文件头断言两条路径「逐位相等」（累加顺序/Map 插入顺序一致），此前无测试守护。
  // 生产走的是单遍历路径，一旦某个累加器被改得与公开函数不同步，只有这里能发现。
  const mkEntry = (i) => ({
    role_id: String(1011 + (i % 3)),
    uid: `u${i % 7}`,
    rank: i % 7,
    level: 60,
    relic_point: 100 + (i % 50),
    source: i % 2 ? 'mys' : '2025',
    weapon: { name: `擎${i % 4}`, level: 60 },
    equips: [4, 5, 6, 1, 2, 3].map((slot) => ({
      id: `1111${slot}`,
      name: `[${slot}]`,
      suit: `套${i % 5}`,
      main: [{ name: slot === 4 ? '暴击率' : '攻击力%', value: 2400 }],
      subs: [
        { name: '攻击力%', value: 960 },
        { name: '暴击伤害', value: 960 },
      ],
    })),
    panel: [
      { name: '攻击力', final: String(2400 + (i % 300)) },
      { name: '暴击率', final: String(0.3 + (i % 20) / 100) },
      { name: '暴击伤害', final: String(1.2 + (i % 30) / 100) },
      { name: '生命值', final: String(9000 + (i % 500)) },
      { name: '防御力', final: String(700 + (i % 90)) },
      { name: '异常精通', final: String(100 + (i % 40)) },
      { name: '异常掌控', final: String(100 + (i % 25)) },
      { name: '冲击力', final: String(110 + (i % 20)) },
    ],
    skills: [
      { type: 0, level: 10 + (i % 3) },
      { type: 1, level: 9 + (i % 4) },
      { type: 2, level: 8 + (i % 5) },
    ],
  });
  const entries = Array.from({ length: 400 }, (_, i) => mkEntry(i));
  const discIndex = {};
  const all = computeAllWorkshopStats(entries, discIndex);
  // 每项与对应公开函数逐位比对（JSON 序列化同时校验键序）
  const eq = (a, b, name) =>
    assert.equal(JSON.stringify(a), JSON.stringify(b), `${name} 单遍历结果应与公开函数逐位相等`);
  eq(all.stats, computeWorkshopStats(entries), 'stats');
  eq(all.discDetails, computeWorkshopDiscStats(entries, discIndex), 'discDetails');
  eq(all.panelScatter, computePanelScatter(entries), 'panelScatter');
  eq(all.relicStats, computeRelicStats(entries), 'relicStats');
  eq(all.rankDist, computeRankDist(entries), 'rankDist');
  eq(all.skillStats, computeSkillStats(entries), 'skillStats');
  eq(all.roleOwnership, computeRoleOwnership(entries), 'roleOwnership');
  eq(all.skillLevelModes, computeSkillLevelModes(entries), 'skillLevelModes');
});

test('computeSkillLevelModes：每技能等级众数（落盘已 canonical、并列取更高、脏条目跳过）', () => {
  // 2026-09 起技能 type 在 sync 写入侧归一（sync/characters.js、workshop.js），聚合只见 canonical
  //（0普攻 1闪避 2支援 3特殊 4终结 5核心）；词汇中立，不做任何映射
  const modes = computeSkillLevelModes([
    {
      role_id: '1011',
      source: 'mys',
      skills: [
        { type: 0, level: 12 },
        { type: 3, level: 11 },
        { type: 3, level: 12 },
      ],
    },
    {
      role_id: '1011',
      source: 'mys',
      skills: [
        { type: 3, level: 12 },
        { type: 4, level: 9 },
      ],
    },
    { role_id: '1033', source: 'mys', skills: [{ type: 0, level: 0 }] }, // 非正等级跳过
    { role_id: null, source: 'mys', skills: [{ type: 0, level: 12 }] }, // 无 role_id 跳过
    { source: 'mys', skills: [{ type: 0, level: 12 }] },
  ]);
  assert.deepEqual(
    modes,
    { 1011: { 0: 12, 3: 12, 4: 9 } },
    'canonical type 直入；type3 11/12 并列取更高 → 12；全脏角色不产出'
  );
  // 回归（原「2025 源 type2 = 闪避」用例的词汇中立化）：type 1 = 闪避原样统计，聚合不做二次映射
  const dodge = computeSkillLevelModes([
    {
      role_id: '9',
      source: '2025',
      skills: [
        { type: 1, level: 12 },
        { type: 1, level: 12 },
        { type: 1, level: 11 },
      ],
    },
  ]);
  assert.deepEqual(dodge, { 9: { 1: 12 } }, 'type1 = 闪避（canonical），众数 12');
});

test('computeRoleOwnership：拥有率 = 拥有该角色的去重 uid 数 / 样本池去重 uid 总数', () => {
  const entries = [
    { role_id: '1011', uid: 'a' },
    { role_id: '1011', uid: 'b' },
    { role_id: '1022', uid: 'a' },
    { role_id: '1022', uid: 'b' },
    { role_id: '1022', uid: 'c' },
    { role_id: '1033', uid: 'a' },
    { role_id: null, uid: 'd' }, // 脏条目不计
    { role_id: '1011' }, // 无 uid 不计
  ];
  const { pool, roles } = computeRoleOwnership(entries);
  assert.equal(pool, 3, '样本池 = 去重 uid 总数（a/b/c）');
  assert.equal(roles['1011'], 2 / 3, 'a/b 拥有 1011 → 2/3');
  assert.equal(roles['1022'], 1, 'a/b/c 都拥有 1022 → 100%');
  assert.equal(roles['1033'], 1 / 3, '仅 a 拥有 1033 → 1/3');
});
