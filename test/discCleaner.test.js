// test/discCleaner.test.js —— 驱动盘清理决策引擎（纯内联 fixture + 真实数据冒烟）
// 主锚 = 实况（discDetails 456 主词条保留占比 ≥3% → 保留），副锚 = 职业规则表（实况空白回落）。
// 覆盖：逐槽三级判定（实况达标 keep / 规则推荐无实况 cond / 其余 drop）、适配角色双口径
// （官方 wiki 推荐 × 实况 4件套）、有效副词条、判定倾向。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDiscCleanCard,
  computeDiscCleanOverview,
  archetypeMainTier,
  computeTendency,
  normalizeRecommendName,
  DISC_META,
  KEEP_RATIO,
  MIN_MAIN_COUNT,
} from '../src/lib/discCleaner.js';
import { loadDataFile } from './helpers.js';
import { MAIN_STAT_OPTIONS } from '../src/lib/constants.js';

// 实况 fixture：1000 块盘，覆盖 keep（高频）/ 实况缺失但规则 keep → cond / 规则 drop → drop
const DETAIL = {
  name: '震星迪斯科',
  equips: 1000,
  main456: {
    4: [{ name: '暴击率', count: 400 }], // 40% → 保留
    5: [{ name: '电属性伤害加成', count: 300 }], // 30% → 保留
    6: [
      { name: '冲击力', count: 700 }, // 70% → 保留
      { name: '攻击力%', count: 60 }, // 6% → 保留
    ],
  },
  mainDenom: { 4: 1000, 5: 1000, 6: 1000 },
};

test('副锚：职业规则表档位（keep > cond > drop）', () => {
  assert.equal(archetypeMainTier(['击破'], 4, '暴击率'), 'keep');
  assert.equal(archetypeMainTier(['击破'], 4, '暴击伤害'), 'keep');
  assert.equal(archetypeMainTier(['击破'], 4, '攻击力%'), 'cond');
  assert.equal(archetypeMainTier(['击破'], 4, '生命值%'), 'drop');
  assert.equal(archetypeMainTier(['击破'], 6, '冲击力'), 'keep');
  // 5 号位元素伤害通配：任意「X属性伤害加成」命中 keep
  assert.equal(archetypeMainTier(['强攻'], 5, '冰属性伤害加成'), 'keep');
  assert.equal(archetypeMainTier(['强攻'], 5, '穿透率'), 'cond');
  assert.equal(archetypeMainTier(['命破'], 5, '穿透率'), 'drop', '命破穿透无效');
});

test('官方推荐名归一：去全部空白', () => {
  assert.equal(normalizeRecommendName('星见 雅'), '星见雅');
  assert.equal(normalizeRecommendName('猫宫 又奈'), '猫宫又奈');
  assert.equal(normalizeRecommendName(''), '');
});

test('卡片判定：实况达标 → 保留；规则推荐无实况 → 视词条；其余 → 分解', () => {
  const card = computeDiscCleanCard({
    setName: '震星迪斯科',
    discDetail: DETAIL,
    recommend: ['冯·莱卡恩'],
    live4pc: new Map([['震星迪斯科', new Set(['冯·莱卡恩', '安比·德玛拉'])]]),
    live2pc: new Map([['震星迪斯科', new Set(['「扳机」'])]]),
  });
  assert.equal(card.tendency, '泛用4件套');
  assert.deepEqual(card.labels, ['击破']);
  const m4 = new Map(card.mains[4].map((x) => [x.name, x]));
  assert.equal(m4.get('暴击率').verdict, 'keep', '实况 40% → 保留');
  assert.ok(Math.abs(m4.get('暴击率').ratio - 0.4) < 1e-9);
  assert.equal(m4.get('暴击伤害').verdict, 'cond', '实况缺失但击破规则 keep → 视词条');
  assert.equal(m4.get('攻击力%').verdict, 'cond', '次选 → 视词条');
  assert.equal(m4.get('生命值%').verdict, 'drop', '实况 0 + 规则 drop → 分解');
  assert.equal(card.mains[6].find((x) => x.name === '冲击力').verdict, 'keep');
  assert.equal(card.mains[6].find((x) => x.name === '攻击力%').verdict, 'keep', '实况 6% ≥3% → 保留');
  assert.equal(card.mains[6].find((x) => x.name === '能量自动回复').verdict, 'drop');
  // 排序：保留在前
  const order = card.mains[4].map((x) => x.verdict);
  assert.ok(order.indexOf('drop') > order.indexOf('keep'));
  // 适配角色：官方（归一去重）× 实况，金色交集 = 冯·莱卡恩
  assert.deepEqual(card.roles.official4, ['冯·莱卡恩']);
  assert.deepEqual(
    card.roles.live4,
    ['冯·莱卡恩', '安比·德玛拉'].sort((a, b) => a.localeCompare(b, 'zh'))
  );
  assert.deepEqual(card.roles.both4, ['冯·莱卡恩']);
  assert.deepEqual(card.roles.live2, ['「扳机」']);
  assert.deepEqual(card.roles.official2, [], '2pc 官方侧仅实况（Q14）');
  // 副词条四档：击破 = 暴击率核心 / 暴伤·攻击% 重要 / 其余无用
  const tiers = new Map(card.subTiers.map((t) => [t.name, t.tier]));
  assert.equal(tiers.get('暴击率'), 'core');
  assert.equal(tiers.get('暴击伤害'), 'high');
  assert.equal(tiers.get('攻击力%'), 'high');
  assert.equal(tiers.get('异常精通'), 'low');
  assert.equal(card.subThreshold, 2, '击破非强攻/命破 → 阈值 2');
});

test('小样本护栏：占比高但盘数 < 最小阈值不判保留（回落副锚规则）', () => {
  // 全套装仅 6 块盘、暴击率占 3 块（50%）——小样本占比不可信，不得判保留
  const tiny = {
    name: 'X',
    equips: 6,
    main456: { 4: [{ name: '暴击率', count: 3 }], 5: [], 6: [] },
    mainDenom: { 4: 6, 5: 6, 6: 6 },
  };
  const card = computeDiscCleanCard({ setName: '震星迪斯科', discDetail: tiny, recommend: [] });
  const m = card.mains[4].find((x) => x.name === '暴击率');
  assert.ok(m.ratio >= KEEP_RATIO, '占比达标');
  assert.ok(m.count < MIN_MAIN_COUNT, '盘数不足');
  assert.equal(m.verdict, 'cond', '小样本回落规则 → 视词条');
});

test('未来套（荆棘玫瑰）：零实况 → 未来套倾向，规则主词条全部视词条', () => {
  const card = computeDiscCleanCard({ setName: '荆棘玫瑰', discDetail: null, recommend: [] });
  assert.equal(card.tendency, '未来套');
  assert.deepEqual(card.labels, ['锋御']);
  const m4 = new Map(card.mains[4].map((x) => [x.name, x]));
  assert.equal(m4.get('防御力%').verdict, 'cond');
  assert.equal(m4.get('暴击率').verdict, 'cond');
  assert.equal(m4.get('攻击力%').verdict, 'drop');
  assert.ok(card.mains[4].find((x) => x.name === '防御力%').reason.includes('未来'), '未来套理由应点明职业');
  // 锋御四档：防御%/防御 核心、暴击率/暴伤 重要
  const tiers = new Map(card.subTiers.map((t) => [t.name, t.tier]));
  assert.equal(tiers.get('防御力%'), 'core');
  assert.equal(tiers.get('防御力'), 'core');
  assert.equal(tiers.get('暴击率'), 'high');
  assert.equal(tiers.get('生命值%'), 'low');
  assert.equal(card.equips, 0);
});

test('泛用2件套（折枝剑歌）：无 4件套 实况 → 倾向「仅2件套可用」，规则主词条放宽为视词条', () => {
  const card = computeDiscCleanCard({ setName: '折枝剑歌', discDetail: null, recommend: [] });
  assert.equal(card.tendency, '仅2件套可用');
  assert.equal(card.meta.universal2pc, true, '泛用2件套标记在 meta（随判定倾向徽章展示，不再入 labels）');
  assert.ok(!card.labels.includes('泛用2件套'), '适配职业标签不应含泛用2件套');
  // 强攻规则（2件套 暴伤受众）→ 4号暴击率/暴伤 = 视词条；6号冲击力 = 分解
  assert.equal(card.mains[4].find((x) => x.name === '暴击率').verdict, 'cond');
  assert.equal(card.mains[4].find((x) => x.name === '暴击伤害').verdict, 'cond');
  assert.equal(card.mains[6].find((x) => x.name === '冲击力').verdict, 'drop');
});

test('判定倾向：实况 4件套 / 角色专属 / 泛用2件套 / 未来 五档（纯实况驱动）', () => {
  const meta = (n) => DISC_META[n];
  assert.equal(computeTendency(meta('震星迪斯科'), 3, 0), '泛用4件套');
  assert.equal(computeTendency(meta('呼啸沙龙'), 1, 0), '角色专属套', '4件套实际使用 1 人 → 角色专属套');
  assert.equal(computeTendency(meta('呼啸沙龙'), 1, 3), '角色专属套', '有 2件套用户也归专属套（以 4件套人数为准）');
  assert.equal(
    computeTendency(meta('雪兔梦游仙境'), 0, 1),
    '仅2件套可用',
    '官方推荐不抬倾向：实况无 4件套用户 → 按 2件套归 仅2件套可用'
  );
  assert.equal(computeTendency(meta('荆棘玫瑰'), 0, 0), '未来套');
  assert.equal(computeTendency(meta('折枝剑歌'), 0, 0), '仅2件套可用');
  assert.equal(computeTendency(meta('折枝剑歌'), 0, 5), '仅2件套可用');
  assert.equal(computeTendency(meta('灵魂摇滚'), 0, 0), '冷门');
});

test('总览：判定倾向降序（泛用4件套在前），同倾向按名称', () => {
  const rows = computeDiscCleanOverview({
    discNames: ['震星迪斯科', '荆棘玫瑰', '折枝剑歌', '灵魂摇滚'],
    live4pc: new Map([['震星迪斯科', new Set(['安比'])]]),
    live2pc: new Map([['折枝剑歌', new Set(['星见雅'])]]),
  });
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName['震星迪斯科'].tendency, '角色专属套', '实况 4件套仅 1 人 → 专属套');
  assert.equal(byName['折枝剑歌'].tendency, '仅2件套可用');
  assert.equal(byName['荆棘玫瑰'].tendency, '未来套');
  assert.equal(byName['灵魂摇滚'].tendency, '冷门');
  const order = rows.map((r) => r.name);
  const want = ['震星迪斯科', '折枝剑歌', '荆棘玫瑰', '灵魂摇滚'];
  assert.deepEqual(order, want, '倾向降序 + 同倾向按名称');
});

test('总览 4件套适配角色：无实况使用 → 托底官方推荐（users4Fb 标记）', () => {
  const rows = computeDiscCleanOverview({
    discNames: ['雪兔梦游仙境', '震星迪斯科'],
    recommendByName: { 雪兔梦游仙境: ['照'], 震星迪斯科: ['冯·莱卡恩'] },
    live4pc: new Map([['震星迪斯科', new Set(['冯·莱卡恩', '安比·德玛拉'])]]),
    live2pc: new Map(),
  });
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName['雪兔梦游仙境'].users4Fb, true, '无实况 → 托底官方');
  assert.deepEqual(byName['雪兔梦游仙境'].users4, ['照']);
  assert.equal(byName['震星迪斯科'].users4Fb, false, '有实况 → 不托底');
  assert.deepEqual(byName['震星迪斯科'].users4, ['安比·德玛拉', '冯·莱卡恩']);
});

test('全量主词条候选都在卡片里（每槽无遗漏主词条）', () => {
  const card = computeDiscCleanCard({ setName: '荆棘玫瑰', discDetail: null });
  for (const slot of [4, 5, 6]) {
    const names = card.mains[slot].map((x) => x.name);
    assert.deepEqual(new Set(names), new Set(MAIN_STAT_OPTIONS[slot]), `${slot} 号位主词条候选应齐全`);
  }
});

test('覆盖合并：override 优先于自动值，逐项生效 + overridden 标记', () => {
  // 谶羽之誓 自动 universal2pc=true；覆盖为 false
  const card = computeDiscCleanCard({
    setName: '谶羽之誓',
    discDetail: null,
    recommend: [],
    overrides: { 谶羽之誓: { universal2pc: false } },
  });
  assert.equal(card.meta.universal2pc, false, '覆盖优先');
  assert.equal(card.overridden, true, '有覆盖标记');
  const card2 = computeDiscCleanCard({ setName: '荆棘玫瑰', discDetail: null });
  assert.equal(card2.overridden, false, '未覆盖 → 无标记');
});

test('覆盖 archetypes：标签与规则都跟随覆盖', () => {
  const card = computeDiscCleanCard({
    setName: '震星迪斯科',
    discDetail: null,
    recommend: [],
    overrides: { 震星迪斯科: { archetypes: ['击破', '支援'] } },
  });
  assert.deepEqual(card.labels, ['击破', '支援']);
  // 6 号位能量自动回复：支援 slot6 keep [能量自动回复] → 规则跟随覆盖职业
  assert.equal(card.mains[6].find((x) => x.name === '能量自动回复').verdict, 'cond');
});

test('覆盖 mains：逐槽微调优先于 archetype 推导，未列主词条归 drop', () => {
  const card = computeDiscCleanCard({
    setName: '震星迪斯科',
    discDetail: null,
    recommend: [],
    overrides: { 震星迪斯科: { mains: { 6: { keep: ['攻击力%'], cond: ['冲击力'] } } } },
  });
  const m6 = new Map(card.mains[6].map((x) => [x.name, x]));
  assert.equal(m6.get('冲击力').verdict, 'cond');
  assert.equal(m6.get('攻击力%').verdict, 'cond', '规则 keep、无实况 → 视词条');
  assert.equal(m6.get('能量自动回复').verdict, 'drop', '不在 spec → drop');
});

test('覆盖 subTiers（逐条档位）+ tendency（钉死整档）', () => {
  const card = computeDiscCleanCard({
    setName: '谶羽之誓',
    discDetail: null,
    recommend: [],
    overrides: { 谶羽之誓: { subTiers: { 异常精通: 'core', '攻击力%': 'low' }, tendency: '冷门' } },
  });
  const tiers = new Map(card.subTiers.map((t) => [t.name, t.tier]));
  assert.equal(tiers.get('异常精通'), 'core', '覆盖档位优先');
  assert.equal(tiers.get('攻击力%'), 'low');
  assert.equal(tiers.get('暴击伤害'), 'mid', '未覆盖词条仍按异常职业合成（暴击流 mid）');
  assert.equal(tiers.get('生命值%'), 'low');
  assert.equal(card.tendency, '冷门', 'tendency 覆盖钉死');
});

test('总览覆盖：overridden 标记 + 倾向钉死', () => {
  const rows = computeDiscCleanOverview({
    discNames: ['荆棘玫瑰'],
    recommendByName: {},
    live4pc: new Map(),
    live2pc: new Map(),
    overrides: { 荆棘玫瑰: { tendency: '冷门' } },
  });
  assert.equal(rows[0].tendency, '冷门');
  assert.equal(rows[0].overridden, true);
});

test('真实数据冒烟：全部套装都有决策卡，判定合法、倾向合理', () => {
  const lib = loadDataFile('library.json', 'npm run sync:library');
  const stats = loadDataFile('workshop-stats.json', 'npm run sync:workshop');
  const grad = loadDataFile('workshop-grad.json', 'npm run sync:workshop');
  const discNames = Object.keys(lib.discs || {});
  const recommendByName = Object.fromEntries(
    Object.entries(lib.discs || {}).map(([n, d]) => [n, (d.recommend || []).map((r) => r.name)])
  );
  // 实况 4件套/2件套：grad relics 按套装 × 角色（raw 名，冒烟不比对账）
  const l4 = new Map();
  const l2 = new Map();
  const add = (m, k, v) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(v);
  };
  for (const role of grad.roles || []) {
    for (const relic of role.relics || []) {
      for (const s of relic.sets || []) {
        if (s.num === 4) add(l4, s.name, role.name);
        else if (s.num === 2) add(l2, s.name, role.name);
      }
    }
  }
  const details = new Map((stats.discDetails || []).map((d) => [d.name, d]));
  let keep = 0;
  let cond = 0;
  let drop = 0;
  for (const name of discNames) {
    assert.ok(DISC_META[name], `${name} 应有套装元数据（职业标注）`);
    const card = computeDiscCleanCard({
      setName: name,
      discDetail: details.get(name) || null,
      recommend: recommendByName[name] || [],
      live4pc: l4,
      live2pc: l2,
    });
    assert.ok(card, `${name} 应有决策卡`);
    assert.ok(['泛用4件套', '角色专属套', '仅2件套可用', '未来套', '冷门'].includes(card.tendency), `${name} 倾向合法`);
    for (const slot of [4, 5, 6]) {
      assert.equal(card.mains[slot].length, MAIN_STAT_OPTIONS[slot].length, `${name} ${slot} 号位主词条齐全`);
      for (const m of card.mains[slot]) {
        assert.ok(['keep', 'cond', 'drop'].includes(m.verdict), `${name} ${slot} 号位 ${m.name} 判定合法`);
        assert.ok(Number.isFinite(m.ratio) && m.ratio >= 0 && m.ratio <= 1, `${name} ${m.name} 占比合法`);
        assert.ok(typeof m.reason === 'string' && m.reason.length > 0, `${name} ${m.name} 应有理由`);
        if (m.verdict === 'keep') keep++;
        if (m.verdict === 'cond') cond++;
        if (m.verdict === 'drop') drop++;
      }
    }
    assert.equal(card.subTiers.length, 10, `${name} 副词条全量覆盖 10 维`);
  }
  assert.ok(keep > 0 && drop > 0, '全量下应同时出现保留与分解判定');
  assert.ok(cond > 0, '全量下应出现视词条判定');
  // 已知语义抽查
  const z = computeDiscCleanCard({
    setName: '震星迪斯科',
    discDetail: details.get('震星迪斯科'),
    recommend: recommendByName['震星迪斯科'],
    live4pc: l4,
    live2pc: l2,
  });
  assert.equal(z.mains[6].find((x) => x.name === '冲击力').verdict, 'keep', '击破套 6 号位冲击力应为保留');
  assert.equal(z.tendency, '泛用4件套');
  const t = computeDiscCleanCard({
    setName: '荆棘玫瑰',
    discDetail: details.get('荆棘玫瑰'),
    recommend: recommendByName['荆棘玫瑰'],
    live4pc: l4,
    live2pc: l2,
  });
  assert.equal(t.tendency, '未来套', '荆棘玫瑰无实况 → 未来套');
});
