// src/lib/discCleaner.js —— 驱动盘清理决策（纯逻辑，Node 与浏览器共用，无 node/DOM 依赖）
// 把「这个套装该留什么盘」变成可执行的判定：**主锚 = 工坊实况**（top 玩家真实穿戴，
// workshop-stats.discDetails 的 456 主词条保留占比 ≥3% → 保留）——plans 官方方案噪音过大
// （14850 方案含大量娱乐/自用/整活），不作为判定输入；**副锚 = 职业规则表**
// （ARCHETYPE_MAIN_RULES 主词条档位 / ARCHETYPE_SUB_TIERS 副词条四档）兜住实况空白/冷门/未来套。
// 适配角色：4件套 官方侧用官方 wiki 推荐（library.discs[].recommend，干净）、2件套 侧仅实况。
// 三级判定：保留 = 实况保留率达标 / 视词条而定 = 职业规则推荐但玩家使用少（泛用2件套/未来套/次选）/
// 分解 = 实况极少用且规则不推荐。
import { STAT, SUBSTAT, MAIN_STAT_OPTIONS, DISC_SUBSTATS, isDamageBonus } from '../game/index.js';

/** 槽位 5 号位「属性伤害加成」通配标记：匹配任意「X属性伤害加成」主词条（物理/火/冰/电/以太/风 + 未来元素） */
const ELEMENT = Symbol('element');
const matchMain = (rule, main) => (rule === ELEMENT ? isDamageBonus(main) : rule === main);
const hasMatch = (list, main) => list.some((r) => matchMain(r, main));

/** 实况主词条保留占比达标阈值（沿用旧决策卡口径：任一实况占比 ≥3% 即保留） */
export const KEEP_RATIO = 0.03;
/** 该主词条的最小绝对盘数：占比 ≥3% 但盘数 <20（小样本/新套，如荆棘玫瑰全套装仅 21 块）
 *  时占比不可信，回落副锚规则判定，防止「50% 的 2 块盘」误判为保留 */
export const MIN_MAIN_COUNT = 20;

// ---------- 职业规则表（副锚：实况空白时的判定兜底 + 理由文案） ----------
// 每职业 4/5/6 号位主词条档位：keep = 核心（无实况时至少「视词条」），cond = 次选；缺省 = drop。
export const ARCHETYPE_MAIN_RULES = {
  强攻: {
    4: { keep: [STAT.CR, STAT.CD], cond: [SUBSTAT.ATK_PCT] },
    5: { keep: [ELEMENT], cond: [STAT.PEN_RATE, SUBSTAT.ATK_PCT] },
    6: { keep: [SUBSTAT.ATK_PCT], cond: [] },
  },
  击破: {
    4: { keep: [STAT.CR, STAT.CD], cond: [SUBSTAT.ATK_PCT] },
    5: { keep: [ELEMENT], cond: [STAT.PEN_RATE, SUBSTAT.ATK_PCT] },
    6: { keep: [STAT.IMPACT], cond: [SUBSTAT.ATK_PCT] },
  },
  异常: {
    4: { keep: [STAT.ANOMALY_PROF, STAT.CR, STAT.CD], cond: [SUBSTAT.ATK_PCT] },
    5: { keep: [ELEMENT], cond: [STAT.PEN_RATE, SUBSTAT.ATK_PCT] },
    6: { keep: [STAT.ANOMALY_CTRL, SUBSTAT.ATK_PCT], cond: [] },
  },
  支援: {
    4: { keep: [SUBSTAT.ATK_PCT, SUBSTAT.HP_PCT], cond: [STAT.CR, STAT.CD] },
    5: { keep: [SUBSTAT.ATK_PCT, SUBSTAT.HP_PCT], cond: [ELEMENT] },
    6: { keep: [STAT.ENERGY], cond: [SUBSTAT.ATK_PCT] },
  },
  防护: {
    4: { keep: [SUBSTAT.HP_PCT, SUBSTAT.DEF_PCT], cond: [] },
    5: { keep: [SUBSTAT.HP_PCT, SUBSTAT.DEF_PCT], cond: [] },
    6: { keep: [STAT.ENERGY, STAT.IMPACT], cond: [SUBSTAT.HP_PCT, SUBSTAT.DEF_PCT] },
  },
  命破: {
    4: { keep: [STAT.CR, STAT.CD], cond: [SUBSTAT.ATK_PCT] },
    5: { keep: [ELEMENT], cond: [SUBSTAT.ATK_PCT] },
    6: { keep: [SUBSTAT.HP_PCT], cond: [SUBSTAT.ATK_PCT] },
  },
  锋御: {
    4: { keep: [SUBSTAT.DEF_PCT, STAT.CR, STAT.CD], cond: [] },
    5: { keep: [SUBSTAT.DEF_PCT, ELEMENT], cond: [] },
    6: { keep: [SUBSTAT.DEF_PCT, SUBSTAT.ATK_PCT], cond: [] },
  },
};

/** 副词条优先级四档：core=核心 / high=重要 / mid=一般 / low=无用（缺省 low）。规则副锚，逐职业。 */
const ARCHETYPE_SUB_TIERS = {
  强攻: { [SUBSTAT.CR]: 'core', [SUBSTAT.CD]: 'core', [SUBSTAT.ATK_PCT]: 'high', [SUBSTAT.PEN_VALUE]: 'mid' },
  击破: { [SUBSTAT.CR]: 'core', [SUBSTAT.CD]: 'high', [SUBSTAT.ATK_PCT]: 'high' },
  异常: {
    [SUBSTAT.ANOMALY_PROF]: 'core',
    [SUBSTAT.ATK_PCT]: 'high',
    [SUBSTAT.PEN_VALUE]: 'mid',
    [SUBSTAT.CR]: 'mid', // 暴击流（折枝剑歌等）才需要
    [SUBSTAT.CD]: 'mid',
  },
  支援: { [SUBSTAT.ATK_PCT]: 'high', [SUBSTAT.ATK]: 'high', [SUBSTAT.HP_PCT]: 'mid', [SUBSTAT.HP]: 'mid' },
  防护: { [SUBSTAT.HP_PCT]: 'high', [SUBSTAT.DEF_PCT]: 'high', [SUBSTAT.ATK_PCT]: 'mid' },
  命破: {
    [SUBSTAT.CR]: 'core',
    [SUBSTAT.CD]: 'core',
    [SUBSTAT.HP_PCT]: 'high',
    [SUBSTAT.ATK_PCT]: 'mid',
    [SUBSTAT.PEN_VALUE]: 'low', // 贯穿伤害无视防御，穿透无效
  },
  锋御: { [SUBSTAT.DEF_PCT]: 'core', [SUBSTAT.DEF]: 'core', [SUBSTAT.CR]: 'high', [SUBSTAT.CD]: 'high' },
};
/** 档位序：数字越小优先级越高 */
export const SUB_TIER_RANK = { core: 0, high: 1, mid: 2, low: 3 };
/** 某副词条在 rule 职业里的最高档（取 rank 最小者） */
function subTierOf(ruleArchetypes, sub) {
  let best = 'low';
  for (const arc of ruleArchetypes || []) {
    const t = ARCHETYPE_SUB_TIERS[arc]?.[sub];
    if (t && SUB_TIER_RANK[t] < SUB_TIER_RANK[best]) best = t;
  }
  return best;
}

/** 有效副词条保留阈值：≥ 此数才值得留（攻略共识；强攻/命破 更苛刻） */
const SUB_THRESHOLD = { default: 2, strict: ['强攻', '命破'], value: 3 };

/**
 * 套装 → 清理元数据：
 * - archetypes：4 件套适配职业（展示标签；可空 = 4件套 几乎无人用，如激素朋克）
 * - rule：判定副锚采用哪些职业规则（4件套 身份 ∪ 2件套 填充受众，如折枝剑歌 4件套=异常 + 2件套 暴伤受众=强攻）
 * - universal2pc：泛用二件套（效果是通用属性、大量角色当散件 → 好主词条的盘即使无 4pc 角色也值得留）
 * - future：为未实装职业预置的「未来套」（当前无角色，判定一律「视词条」，词条好才留）
 * 依据 2026-09 全 30 套（3.1 版本；3.2 新职业锋御 + 荆棘玫瑰）。
 */
export const DISC_META = {
  獠牙重金属: { archetypes: ['异常'], rule: ['异常', '强攻'], universal2pc: true }, // 2件套物理伤 = 物理角色散件填充
  激素朋克: { archetypes: ['强攻'], rule: ['强攻', '命破'], universal2pc: true },
  震星迪斯科: { archetypes: ['击破'], rule: ['击破'], universal2pc: true }, // 2件套冲击力 = 击破散件填充
  雷暴重金属: { archetypes: ['强攻', '异常'], rule: ['强攻', '异常'], universal2pc: false },
  极地重金属: { archetypes: ['强攻'], rule: ['强攻'], universal2pc: false },
  自由蓝调: { archetypes: ['异常'], rule: ['异常'], universal2pc: true },
  炎狱重金属: { archetypes: ['强攻'], rule: ['强攻'], universal2pc: false },
  河豚电音: { archetypes: ['强攻'], rule: ['强攻'], universal2pc: true },
  摇摆爵士: { archetypes: ['支援'], rule: ['支援', '击破'], universal2pc: true },
  啄木鸟电音: { archetypes: ['强攻', '击破', '命破'], rule: ['强攻', '击破', '命破'], universal2pc: true },
  灵魂摇滚: { archetypes: ['防护'], rule: ['防护'], universal2pc: false },
  混沌重金属: { archetypes: ['强攻'], rule: ['强攻'], universal2pc: false },
  原始朋克: { archetypes: ['防护'], rule: ['防护'], universal2pc: false },
  混沌爵士: { archetypes: ['异常'], rule: ['异常'], universal2pc: true },
  折枝剑歌: { archetypes: ['异常'], rule: ['异常', '强攻'], universal2pc: true },
  静听嘉音: { archetypes: ['支援'], rule: ['支援', '强攻'], universal2pc: true },
  如影相随: { archetypes: ['强攻', '击破'], rule: ['强攻', '击破'], universal2pc: false },
  法厄同之歌: { archetypes: ['异常'], rule: ['异常'], universal2pc: true },
  云岿如我: { archetypes: ['命破'], rule: ['命破'], universal2pc: false },
  山大王: { archetypes: ['击破'], rule: ['击破'], universal2pc: false },
  拂晓生花: { archetypes: ['强攻'], rule: ['强攻'], universal2pc: false },
  月光骑士颂: { archetypes: ['支援'], rule: ['支援', '击破'], universal2pc: true }, // 2件套回能与摇摆爵士同效 = 支援/击破散件
  沧浪行歌: { archetypes: ['强攻'], rule: ['强攻'], universal2pc: false },
  流光咏叹: { archetypes: ['异常'], rule: ['异常'], universal2pc: false },
  囚徒手记: { archetypes: ['异常'], rule: ['异常'], universal2pc: false },
  雪兔梦游仙境: { archetypes: ['防护'], rule: ['防护'], universal2pc: false },
  呼啸沙龙: { archetypes: ['异常'], rule: ['异常'], universal2pc: false },
  拂晓行纪: { archetypes: ['强攻'], rule: ['强攻'], universal2pc: false },
  谶羽之誓: { archetypes: ['异常'], rule: ['异常'], universal2pc: true },
  荆棘玫瑰: { archetypes: ['锋御'], rule: ['锋御'], universal2pc: false, future: true },
};
const EMPTY_META = { archetypes: [], rule: [], universal2pc: false, future: false };

/** 规则副锚：该主词条在 rule 职业规则表里的最高档位（keep > cond > drop） */
export function archetypeMainTier(ruleArchetypes, slot, main) {
  let tier = 'drop';
  for (const a of ruleArchetypes || []) {
    const r = ARCHETYPE_MAIN_RULES[a]?.[slot];
    if (!r) continue;
    if (hasMatch(r.keep, main)) return 'keep';
    if (hasMatch(r.cond, main)) tier = 'cond';
  }
  return tier;
}

/** 展示标签：4件套适配职业（泛用2件套 归判定倾向徽章，见 universal2pc 标记） */
function archetypeLabels(meta) {
  return [...(meta?.archetypes || [])];
}

/**
 * 覆盖合并：自动元数据（DISC_META）+ 用户覆盖（discCleanOverrides，覆盖优先），返回「生效元数据」。
 * 覆盖字段：archetypes（标签=规则）/ universal2pc / future / tendency（钉死整档）/
 * mains（{slot: {keep, cond}} 逐槽微调，优先于 archetype 推导）/ subTiers（{副词条: 档位} 逐条微调）。
 */
export function effectiveMeta(setName, override) {
  const base = DISC_META[setName] || EMPTY_META;
  const ov = override || {};
  const archetypes = ov.archetypes || base.archetypes;
  const universal2pc = ov.universal2pc ?? base.universal2pc;
  const future = ov.future ?? base.future;
  // 规则：覆盖了 archetypes → 规则 = 覆盖的职业（标签即规则）；未覆盖 → 用库内 rule
  const rule = ov.archetypes ? archetypes : base.rule;
  return { archetypes, universal2pc, future, rule, mains: ov.mains, subTiers: ov.subTiers, tendency: ov.tendency };
}

/** 逐槽微调档位：spec = {keep, cond} 里命中 keep → keep，命中 cond → cond，否则 drop */
function tierFromSpec(spec, main) {
  if (hasMatch(spec.keep, main)) return 'keep';
  if (hasMatch(spec.cond, main)) return 'cond';
  return 'drop';
}

/** 官方 wiki 推荐名归一：去全部空白（「星见 雅」→「星见雅」）后与原样返回 */
export function normalizeRecommendName(name) {
  return String(name || '').replace(/\s+/g, '');
}

/** 判定倾向（card 与 overview 共用同一口径）：纯实况驱动——官方 wiki 推荐只展示在「官方推荐」行，不抬升倾向 */
export function computeTendency(meta, live4Count, live2Count) {
  if (live4Count >= 2) return '泛用4件套';
  if (live4Count === 1) return '角色专属套'; // 4件套实际使用仅 1 人 → 该角色专属
  if (meta.universal2pc || live2Count >= 1) return '仅2件套可用';
  if (meta.future) return '未来套';
  return '冷门';
}

/** 主词条判定理由（一句话） */
function mainReason(verdict, ratio, tier, meta) {
  if (verdict === 'keep') return `实际使用占比 ${Math.round(ratio * 100)}%`;
  if (verdict === 'cond') {
    if (meta.future) return `未来「${meta.archetypes.join('·')}」职业专属，词条好可留`;
    if (tier === 'keep')
      return meta.universal2pc ? '泛用二件套主词条，词条好可留' : '职业规则推荐主词条，玩家使用少，词条好可留';
    return '次选主词条，词条好可留';
  }
  return '实际使用极少，可分解';
}

/**
 * 单套装清理决策卡。
 * @param {object} p
 * @param {string} p.setName 套装名
 * @param {object|null} p.discDetail workshop-stats.discDetails 行（主锚数据；可为 null = 无实况）
 * @param {string[]} p.recommend 官方 wiki 推荐角色（原始名，函数内归一）
 * @param {Map<string,Set<string>>} p.live4pc 套装 → 实况 4pc 使用者（已对齐标准名）
 * @param {Map<string,Set<string>>} p.live2pc 套装 → 实况 2pc 使用者（已对齐标准名）
 */
export function computeDiscCleanCard({
  setName,
  discDetail = null,
  recommend = [],
  live4pc = new Map(),
  live2pc = new Map(),
  overrides = {},
}) {
  const meta = effectiveMeta(setName, overrides[setName]);
  const l4 = live4pc.get(setName) || new Set();
  const l2 = live2pc.get(setName) || new Set();
  const o4 = recommend.map(normalizeRecommendName).filter(Boolean);
  const both4 = o4.filter((c) => l4.has(c));
  const mains = {};
  for (const slot of [4, 5, 6]) {
    const denom = discDetail?.mainDenom?.[slot] || 0;
    const counts = new Map((discDetail?.main456?.[slot] || []).map((f) => [f.name, f.count || 0]));
    const spec = meta.mains?.[slot]; // 逐槽微调优先于 archetype 推导
    const items = (MAIN_STAT_OPTIONS[slot] || []).map((main) => {
      const count = counts.get(main) || 0;
      const ratio = denom ? count / denom : 0;
      const tier = spec ? tierFromSpec(spec, main) : archetypeMainTier(meta.rule, slot, main);
      const verdict = ratio >= KEEP_RATIO && count >= MIN_MAIN_COUNT ? 'keep' : tier !== 'drop' ? 'cond' : 'drop';
      return { name: main, ratio, count, verdict, reason: mainReason(verdict, ratio, tier, meta) };
    });
    // 排序：保留（占比降）→ 视词条（占比降）→ 分解（保持候选顺序）
    const rank = { keep: 0, cond: 1, drop: 2 };
    items.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.ratio - a.ratio);
    mains[slot] = items;
  }
  // 副词条四档：覆盖 subTiers 优先，否则 rule 职业合成（取最高档）；全部 10 维展示
  const subTiers = DISC_SUBSTATS.map((sub) => ({
    name: sub,
    tier: meta.subTiers?.[sub] ?? subTierOf(meta.rule, sub),
  }));
  const subThreshold = meta.rule.some((arc) => SUB_THRESHOLD.strict.includes(arc))
    ? SUB_THRESHOLD.value
    : SUB_THRESHOLD.default;
  return {
    name: setName,
    meta,
    overridden: !!overrides[setName],
    labels: archetypeLabels(meta),
    tendency: meta.tendency || computeTendency(meta, l4.size, l2.size),
    roles: {
      official4: [...new Set(o4)].sort((x, y) => x.localeCompare(y, 'zh')),
      live4: [...l4].sort((x, y) => x.localeCompare(y, 'zh')),
      both4,
      official2: [],
      live2: [...l2].sort((x, y) => x.localeCompare(y, 'zh')),
    },
    mains,
    subTiers,
    subThreshold,
    equips: discDetail?.equips || 0,
  };
}

/**
 * 全套装速查总览行（判定倾向降序，同倾向按名称）。
 * 4件套适配角色 = 实况使用者；无实况时托底官方 wiki 推荐（users4Fb 标记）。
 * @param {object} p
 * @param {string[]} p.discNames 全部套装名
 * @param {Map<string,string[]>} p.recommendByName 套装 → 官方 wiki 推荐（原始名）
 * @param {Map<string,Set<string>>} p.live4pc / p.live2pc
 */
export function computeDiscCleanOverview({
  discNames,
  recommendByName = {},
  live4pc = new Map(),
  live2pc = new Map(),
  overrides = {},
}) {
  const TEND_ORDER = { 泛用4件套: 0, 角色专属套: 1, 仅2件套可用: 2, 未来套: 3, 冷门: 4 };
  const rows = [];
  for (const name of discNames || []) {
    const meta = effectiveMeta(name, overrides[name]);
    const l4 = live4pc.get(name) || new Set();
    const l2 = live2pc.get(name) || new Set();
    const live4 = [...l4].sort((a, b) => a.localeCompare(b, 'zh'));
    const rec = (recommendByName[name] || [])
      .map(normalizeRecommendName)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'zh'));
    const users4Fb = live4.length === 0 && rec.length > 0; // 无实况 → 托底官方推荐
    rows.push({
      name,
      tendency: meta.tendency || computeTendency(meta, l4.size, l2.size),
      labels: archetypeLabels(meta),
      universal2pc: meta.universal2pc,
      // 徽章展示条件：泛用2件套 且（有散件用户 或 用户显式覆盖为是）
      showUniversal: meta.universal2pc && (l2.size >= 1 || overrides[name]?.universal2pc === true),
      overridden: !!overrides[name],
      n4: l4.size, // 排序/统计仍用实况数
      n2: l2.size,
      users4: users4Fb ? rec : live4, // 4件套适配角色（实况优先，空则官方推荐）
      users4Fb,
    });
  }
  // 倾向降序；同倾向按实况需求（4件套+2件套 用户数）降序——高需求套排前，利于清理优先级
  return rows.sort(
    (x, y) =>
      TEND_ORDER[x.tendency] - TEND_ORDER[y.tendency] ||
      y.n4 + y.n2 - (x.n4 + x.n2) ||
      x.name.localeCompare(y.name, 'zh')
  );
}
