// src/game/disc.js —— 驱动盘实体域：属性-词条词汇体系 + 驱动盘规则「唯一权威」+ Disc 模型类
// ⚠️ 新增/修改任何驱动盘相关规则前先查这里；每条规则带编号注释（A-H 审阅稿编号）。
// 面板属性名（STAT）落于本域的原因：驱动盘主/副词条与角色面板共用同一套词汇，且依赖方向必须是
// character → disc（Character 组合 Disc），本文件是 game 的词汇叶子域，禁止反向 import character。
// 规则编号分布：A3/A4/C4 词条成长与形态、A5 主词条、B 生成模型、C2/C3 分数与命中、D/G 权重与工坊口径、E 保词条比较——全在本文件；
// H 显示配对在 web/discDisplay.js。双端共享，无 node 依赖。
// 导出的对象/数组枚举一律 Object.freeze（Set 不冻结，子集校验由 test/game-consistency.test.js 兜底）。
import { statEntries } from '../lib/util.js';

// ============================================================
// 属性-词条词汇体系（面板属性名 / 副词条类型 / 成长规则）
// ============================================================

// ---------- 面板属性名 ----------
/** 面板属性名枚举（数据层与展示层的属性键，贯穿 wiki / 账号 / 推荐方案三方）。
 *  固定字符串的单一权威出处：各处引用枚举而非魔法字符串（拼错得 undefined 而非静默写错数据）。 */
export const STAT = Object.freeze({
  ATK: '攻击力',
  HP: '生命值',
  DEF: '防御力',
  IMPACT: '冲击力',
  CR: '暴击率',
  CD: '暴击伤害',
  ANOMALY_CTRL: '异常掌控',
  ANOMALY_PROF: '异常精通',
  PEN_RATE: '穿透率',
  PIERCE: '贯穿力',
  PEN_VALUE: '穿透值',
  ENERGY: '能量自动回复',
  DMG_BONUS: '伤害加成', // 工坊权重 key「加伤」的标准化名（通用伤害加成）
});

/** 百分比面板属性（值 ≤1 表示百分比，如暴击率 0.3 = 30%） */
export const PERCENT_STATS = new Set([STAT.CR, STAT.CD, STAT.PEN_RATE]);
/** 百分比加成按「基础×(1+Σ%)」计算的属性（其余百分比加成纯累加） */
export const MULT_STATS = new Set([STAT.ATK, STAT.HP, STAT.DEF, STAT.IMPACT, STAT.ENERGY, STAT.ANOMALY_CTRL]);
export const isDamageBonus = (name) => name.endsWith('伤害加成') || name.endsWith('伤害提升');

/** 面板属性 → 对应哪些有效副词条类型（用于按有效属性配置高亮面板行） */
export const PANEL_STAT_MAP = Object.freeze({
  [STAT.ATK]: ['攻击力', '攻击力%'],
  [STAT.HP]: ['生命值', '生命值%'],
  [STAT.DEF]: ['防御力', '防御力%'],
  [STAT.CR]: [STAT.CR],
  [STAT.CD]: [STAT.CD],
  [STAT.PEN_VALUE]: [STAT.PEN_VALUE],
  [STAT.ANOMALY_PROF]: [STAT.ANOMALY_PROF],
});

// ---------- 副词条类型（有效副词条 / 成长表） ----------
/** 副词条类型枚举：攻击/生命/防御有「固定」与「百分比」两种形态，其余为单一形态 */
export const SUBSTAT = Object.freeze({
  ATK: STAT.ATK,
  ATK_PCT: '攻击力%',
  CR: STAT.CR,
  CD: STAT.CD,
  PEN_VALUE: STAT.PEN_VALUE,
  ANOMALY_PROF: STAT.ANOMALY_PROF,
  HP: STAT.HP,
  HP_PCT: '生命值%',
  DEF: STAT.DEF,
  DEF_PCT: '防御力%',
});
export const SUBSTAT_TYPE_SET = new Set(Object.values(SUBSTAT));

/** 副词条 10 维顺序（对应游戏 10 种副词条；界面显示按 5 行×2 列配对，见 web/discDisplay.js 的 DP_ROW_PAIRS）：
    生命值%/生命值/攻击力%/攻击力/穿透值/防御力%/防御力/暴击伤害/暴击率/异常精通 */
export const DISC_SUBSTATS = Object.freeze([
  SUBSTAT.HP_PCT,
  SUBSTAT.HP,
  SUBSTAT.ATK_PCT,
  SUBSTAT.ATK,
  SUBSTAT.PEN_VALUE,
  SUBSTAT.DEF_PCT,
  SUBSTAT.DEF,
  SUBSTAT.CD,
  SUBSTAT.CR,
  SUBSTAT.ANOMALY_PROF,
]);
/** 每种副词条的抽取基础权重（词条池加权抽样用） */
export const DISC_SUBSTAT_SPECIAL_WEIGHTS = Object.freeze([10, 10, 9, 9, 8, 10, 10, 8, 8, 8]);
/** 固定值副词条类型（攻击/生命/防御的数值形态）——概率/命中统一为「% 变体」口径时剔除 */
export const FIXED_SUBSTATS = new Set([SUBSTAT.ATK, SUBSTAT.HP, SUBSTAT.DEF]);

// ---------- 副词条成长规则（A3/A4/C4） ----------
// A3：副词条成长表（S/A/B 三档，内部小数口径：百分比存小数如 0.024=2.4%）。
// 数据来源：bilibili wiki。S 级副词条初始值 = 成长值，每强化一次 +成长值，等级每 +3 触发一次成长。
// ⚠️ mys 源（去 % 的整数，如暴击率 2.4）与 2025 源（×100 整数）在此表基础上换算，见 C4 substatRolls。
export const substatGrowthTable = Object.freeze({
  S: {
    穿透值: 9,
    异常精通: 9,
    防御力: 15,
    攻击力: 19,
    生命值: 112,
    暴击率: 0.024,
    '生命值%': 0.03,
    '攻击力%': 0.03,
    暴击伤害: 0.048,
    '防御力%': 0.048,
  },
  A: {
    穿透值: 6,
    异常精通: 6,
    防御力: 10,
    攻击力: 13,
    生命值: 75,
    暴击率: 0.016,
    '生命值%': 0.02,
    '攻击力%': 0.02,
    暴击伤害: 0.032,
    '防御力%': 0.032,
  },
  B: {
    穿透值: 3,
    异常精通: 3,
    防御力: 5,
    攻击力: 6,
    生命值: 0,
    暴击率: 0.008,
    '生命值%': 0.01,
    '攻击力%': 0.01,
    暴击伤害: 0.016,
    '防御力%': 0.016,
  },
});

// A4：副词条形态判定（% vs 固定）。暴击/暴伤恒为 %；其余按数值大小（≤1 视为百分比）。
export function substatType(name, value) {
  return [STAT.CR, STAT.CD].includes(name) ? name : value <= 1 ? name + '%' : name;
}

// C4：还原一条副词条的强化次数（1-6）。值统一为 ×100 整数百分比（480 = 4.8%，归一化后无字符串形态）。
// 基数与 A3 成长表同源：百分比形态 = S 级成长值 × 100（"去 % 的数" 整数）。
// ⚠️ 仅限 S 级口径：基数写死 substatGrowthTable.S、不接收 rarity。workshop 数据归一化后 rarity 已删、当前恒为 S 级；
// 与 discGrowth(rarity) 形成对照，一旦未来混入 A/B 级条目会静默少算 roll——不要给本函数加 rarity 参数（另走 A3 成长表）。
// 为什么还原次数：旧「有效词条个数」99.95% 恒为 4 无区分度；value/base 99.9987% 恰为 1-6 整数（余 19 条异常靠 round+钳制兜底）。
const PCT_SUBSTATS = new Set(['暴击率', '暴击伤害', '攻击力%', '生命值%', '防御力%']);
export function substatRolls(name, value) {
  const growth = substatGrowthTable.S[name];
  if (!growth) return 0;
  const raw = parseFloat(String(value));
  if (!Number.isFinite(raw)) return 0;
  const v = PCT_SUBSTATS.has(name) ? raw / 100 : raw;
  const base = PCT_SUBSTATS.has(name) ? growth * 100 : growth; // 统一换算到「去 % 的数」口径
  const r = Math.round(v / base);
  return r < 1 ? 0 : r > 6 ? 6 : r; // 钳制：异常值（实测 19/144 万）不至于把分布拉出量程
}

// ---------- 副词条成长来源（面板属性视角） ----------
/** 面板属性 → 能影响它的副词条类型 + 每次强化的收益定义（S 级成长值 + 面板乘区形态）。
 *  kind：pct = 按基础白值乘算（攻击/生命/防御的 % 形态）、flat = 固定值累加（攻击/生命/防御的固定形态）、
 *  add = 直接累加面板值（暴击/暴伤/精通/穿透值）；乘区归属与 MULT_STATS 一致。
 *  消费端：simCalc 成长极限模拟（每强化次数收益 = pct 时 基础×value，其余 value）。 */
export const SUBSTAT_SOURCES = Object.freeze({
  [STAT.ATK]: [
    { type: SUBSTAT.ATK_PCT, kind: 'pct', stat: STAT.ATK, value: substatGrowthTable.S[SUBSTAT.ATK_PCT] },
    { type: SUBSTAT.ATK, kind: 'flat', stat: STAT.ATK, value: substatGrowthTable.S[SUBSTAT.ATK] },
  ],
  [STAT.HP]: [
    { type: SUBSTAT.HP_PCT, kind: 'pct', stat: STAT.HP, value: substatGrowthTable.S[SUBSTAT.HP_PCT] },
    { type: SUBSTAT.HP, kind: 'flat', stat: STAT.HP, value: substatGrowthTable.S[SUBSTAT.HP] },
  ],
  [STAT.DEF]: [
    { type: SUBSTAT.DEF_PCT, kind: 'pct', stat: STAT.DEF, value: substatGrowthTable.S[SUBSTAT.DEF_PCT] },
    { type: SUBSTAT.DEF, kind: 'flat', stat: STAT.DEF, value: substatGrowthTable.S[SUBSTAT.DEF] },
  ],
  [STAT.CR]: [{ type: STAT.CR, kind: 'add', stat: STAT.CR, value: substatGrowthTable.S[STAT.CR] }],
  [STAT.CD]: [{ type: STAT.CD, kind: 'add', stat: STAT.CD, value: substatGrowthTable.S[STAT.CD] }],
  [STAT.ANOMALY_PROF]: [{ type: STAT.ANOMALY_PROF, kind: 'add', stat: STAT.ANOMALY_PROF, value: substatGrowthTable.S[STAT.ANOMALY_PROF] }],
  [STAT.PEN_VALUE]: [{ type: STAT.PEN_VALUE, kind: 'add', stat: STAT.PEN_VALUE, value: substatGrowthTable.S[STAT.PEN_VALUE] }],
});

// ============================================================
// D/G. 价值权重与工坊口径
// ============================================================
/** 工坊流派权重 key → 标准属性名（system_data weight_json 抽取/落地时映射，消费端直接按标准名匹配）。
 *  ⚠️ 12 个 key 全映射：暴击/暴伤/攻击/穿透值/能量/冲击/穿透率/加伤 + 生命/防御/精通/掌控（旧抓取曾丢后 4 个）。 */
export const WS_KEY_TO_STAT = Object.freeze({
  攻击: STAT.ATK,
  暴击: STAT.CR,
  暴伤: STAT.CD,
  生命: STAT.HP,
  防御: STAT.DEF,
  精通: STAT.ANOMALY_PROF,
  掌控: STAT.ANOMALY_CTRL,
  穿透值: STAT.PEN_VALUE,
  穿透率: STAT.PEN_RATE,
  能量: STAT.ENERGY,
  冲击: STAT.IMPACT,
  加伤: STAT.DMG_BONUS,
});
/** 副词条维度 → 落地权重 key（% 与固定共享父属性权重：攻击力% 与 攻击力 都取「攻击力」等） */
export const DISC_SUBSTAT_WS_KEY = Object.freeze({
  [SUBSTAT.ATK_PCT]: STAT.ATK,
  [SUBSTAT.ATK]: STAT.ATK,
  [SUBSTAT.HP_PCT]: STAT.HP,
  [SUBSTAT.HP]: STAT.HP,
  [SUBSTAT.DEF_PCT]: STAT.DEF,
  [SUBSTAT.DEF]: STAT.DEF,
  [SUBSTAT.CR]: STAT.CR,
  [SUBSTAT.CD]: STAT.CD,
  [SUBSTAT.PEN_VALUE]: STAT.PEN_VALUE,
  [SUBSTAT.ANOMALY_PROF]: STAT.ANOMALY_PROF,
});

// D2：查不到工坊权重时的默认模板（攻击力% 0.3 + 通用双暴）
export const DEFAULT_WEIGHTS = Object.freeze([0, 0, 0.3, 0.3, 0.3, 0, 0, 1, 1, 0]);

// D3/D4：库角色名 → 10 维价值权重。数据源 workshop-weights（经 workshop-grad 的 role_id→wiki 名对齐）。
// 落地数据 key 已是标准属性名（抽取时经 WS_KEY_TO_STAT 映射），此处按 DISC_SUBSTAT_WS_KEY 直接匹配
// （% 与固定共享父属性权重：攻击力%/攻击力 都取「攻击力」）。查不到角色返回 null。
export function roleWeightsFromWs(libName, weightJson, gradRoles) {
  const role = (gradRoles || []).find((r) => r.name === libName);
  const entry = role && weightJson?.[role.item_id];
  const ws = entry?.factions?.[0]?.weights;
  if (!ws) return null;
  const w = new Map(ws.map((x) => [x.key, x.weight]));
  return DISC_SUBSTATS.map((name) => w.get(DISC_SUBSTAT_WS_KEY[name]) || 0);
}

// ============================================================
// A5 + 主词条体系（4/5/6 号位候选 / 出现概率 / 同类屏蔽）
// ============================================================

// A5：1-3 号位主词条固定（游戏定死，不可选）
export const SLOT_FIXED_MAIN = Object.freeze({ 1: STAT.HP, 2: STAT.ATK, 3: STAT.DEF });

/** 4/5/6 号位主词条候选。注意：只有 1/2/3 号盘才有数值型攻击/防御/生命主词条，
 *  4/5/6 号位的攻击/防御/生命恒为百分比——故候选只含百分比变体与各槽位特有词条。 */
export const MAIN_STAT_OPTIONS = Object.freeze({
  4: [STAT.CR, STAT.CD, STAT.ANOMALY_PROF, SUBSTAT.ATK_PCT, SUBSTAT.DEF_PCT, SUBSTAT.HP_PCT],
  5: [
    STAT.PEN_RATE,
    SUBSTAT.ATK_PCT,
    SUBSTAT.DEF_PCT,
    SUBSTAT.HP_PCT,
    '物理伤害加成',
    '火属性伤害加成',
    '冰属性伤害加成',
    '电属性伤害加成',
    '以太伤害加成',
    '风属性伤害加成',
  ],
  6: [STAT.IMPACT, STAT.ENERGY, STAT.ANOMALY_CTRL, SUBSTAT.ATK_PCT, SUBSTAT.DEF_PCT, SUBSTAT.HP_PCT],
});

/** 456 号位主词条出现概率（key 与 MAIN_STAT_OPTIONS 一致；数值源自游戏实测） */
export const DISC_MAIN_PROB_WEIGHTS = Object.freeze({
  4: {
    [SUBSTAT.ATK_PCT]: 18,
    [SUBSTAT.HP_PCT]: 21,
    [SUBSTAT.DEF_PCT]: 21,
    [STAT.CR]: 12,
    [STAT.CD]: 12,
    [STAT.ANOMALY_PROF]: 15,
  },
  5: {
    [SUBSTAT.ATK_PCT]: 16.5,
    [SUBSTAT.HP_PCT]: 19.2,
    [SUBSTAT.DEF_PCT]: 19.2,
    [STAT.PEN_RATE]: 9.1,
    物理伤害加成: 6,
    火属性伤害加成: 6,
    冰属性伤害加成: 6,
    电属性伤害加成: 6,
    以太伤害加成: 6,
    风属性伤害加成: 6,
  },
  6: {
    [SUBSTAT.ATK_PCT]: 18,
    [SUBSTAT.HP_PCT]: 21,
    [SUBSTAT.DEF_PCT]: 21,
    [STAT.ANOMALY_CTRL]: 15,
    [STAT.IMPACT]: 15,
    [STAT.ENERGY]: 15,
  },
});
/** S 级满级驱动盘主词条数值（1-6 号位；456 号位的百分比/特殊词条均为内部小数口径）。
 *  123 号位为固定白值；456 号位 key 与 MAIN_STAT_OPTIONS/DISC_MAIN_PROB_WEIGHTS 对齐。
 *  消费端：simCalc 成长极限模拟固定面板。 */
export const DISC_MAIN_STAT_S = Object.freeze({
  1: { [STAT.HP]: 2200 },
  2: { [STAT.ATK]: 316 },
  3: { [STAT.DEF]: 184 },
  4: {
    [SUBSTAT.HP_PCT]: 0.3,
    [SUBSTAT.ATK_PCT]: 0.3,
    [SUBSTAT.DEF_PCT]: 0.48,
    [STAT.ANOMALY_PROF]: 92,
    [STAT.CR]: 0.24,
    [STAT.CD]: 0.48,
  },
  5: {
    [SUBSTAT.HP_PCT]: 0.3,
    [SUBSTAT.ATK_PCT]: 0.3,
    [SUBSTAT.DEF_PCT]: 0.48,
    [STAT.PEN_RATE]: 0.24,
    物理伤害加成: 0.3,
    火属性伤害加成: 0.3,
    冰属性伤害加成: 0.3,
    电属性伤害加成: 0.3,
    以太伤害加成: 0.3,
    风属性伤害加成: 0.3,
  },
  6: {
    [SUBSTAT.HP_PCT]: 0.3,
    [SUBSTAT.ATK_PCT]: 0.3,
    [SUBSTAT.DEF_PCT]: 0.48,
    [STAT.IMPACT]: 0.18,
    [STAT.ANOMALY_CTRL]: 0.3,
    [STAT.ENERGY]: 0.6,
  },
});

/** 主词条 → 禁用的同类副词条（副词条不得与主词条重复；key 即主词条名，值即 DISC_SUBSTATS 中对应的副词条） */
export const DISC_MAIN_BLOCK = Object.freeze({
  [SUBSTAT.ATK_PCT]: SUBSTAT.ATK_PCT,
  [SUBSTAT.HP_PCT]: SUBSTAT.HP_PCT,
  [SUBSTAT.DEF_PCT]: SUBSTAT.DEF_PCT,
  [STAT.CR]: SUBSTAT.CR,
  [STAT.CD]: SUBSTAT.CD,
  [STAT.ANOMALY_PROF]: SUBSTAT.ANOMALY_PROF,
});

/** 4/5/6 号位主词条名归一化：接口/旧数据可能返回固定值名（攻击力/防御力/生命值），
 *  但 456 号位主词条恒为百分比，统一转百分比变体；其余原样返回（幂等，可安全套用）。 */
export function mainStatName(name) {
  if (name === STAT.ATK) return SUBSTAT.ATK_PCT;
  if (name === STAT.HP) return SUBSTAT.HP_PCT;
  if (name === STAT.DEF) return SUBSTAT.DEF_PCT;
  return name;
}

/** 主词条 % 变体 → 面板属性名（456 的 攻击力%/生命值%/防御力% 累加到对应面板属性乘区；其余主词条名原样）。
 *  mainStatName 的反向映射；消费端：simCalc 固定面板合成。 */
export function mainStatForPanel(name) {
  if (name === SUBSTAT.ATK_PCT) return STAT.ATK;
  if (name === SUBSTAT.HP_PCT) return STAT.HP;
  if (name === SUBSTAT.DEF_PCT) return STAT.DEF;
  return name;
}

/** 槽位 → 该位主词条对应的副词条类型（用于「副词条不与主词条重复」约束）：
 *  123 号位 = 固定主词条本身（SLOT_FIXED_MAIN），456 号位 = 主词条名经 mainStatName 归一（% 变体/特殊词条原样）。 */
export function mainTypeForSlot(slot, mains) {
  if (slot === 1) return STAT.HP;
  if (slot === 2) return STAT.ATK;
  if (slot === 3) return STAT.DEF;
  return mainStatName(mains[slot]) || '';
}

// ============================================================
// B. 驱动盘生成模型（ZZZ-DDC 移植）
// ============================================================
// B2：初始词条数占比（游戏实际：掉落盘初始 3 副词条占 80%、4 副词条占 20%）
const FOUR_SUB_CHANCE = 0.2; // 初始 4 词条盘概率
const THREE_SUB_CHANCE = 0.8; // 初始 3 词条盘概率
// B3：强化成长次数。15 级盘共 5 次强化事件：4 词条盘 5 次全是成长；3 词条盘第 1 次强化补第 4 词条、之后 4 次成长
// 泛化口径（simCalc 成长极限模拟用）：满级盘总命中 = 4 初始 + 5 强化 = 9 次（废词条按初始 1 次占位），
// 相关词条可分配命中 = 5 + 相关词条数 k（ compositions(k, 5+k)），每词条 ≤6 次、同词条每盘最多一次、不与主词条重复。
const FOUR_SUB_TIMES = 5; // 4 词条盘成长次数
const THREE_SUB_TIMES = 4; // 3 词条盘补词条后的成长次数

// B4/B5：强化成长通过率。递归 times 次（每次从 nowGroup 随机一条 +score），统计 add 相对 need 的路径占比。
// op = '>'（默认，严格大于）| '='（恰好等于）| '>='（不低于）——向后兼容：不传 op 即原严格大于语义。
export function passChance(times, need, nowGroup, op = '>') {
  let total = 0;
  let pass = 0;
  (function dfs(leave, add) {
    if (leave <= 0) {
      total++;
      if (op === '=' ? add === need : op === '>=' ? add >= need : add > need) pass++;
      return;
    }
    for (const g of nowGroup) dfs(leave - 1, add + g);
  })(times, 0);
  return total === 0 ? 0 : pass / total;
}

/** 构造 10 词条池：weights 为角色 10 维价值权重（score），rest 默认 1（同盘不重复），blockedIdx 排除主词条同类 */
export function buildTypes(weights, rest = 1, blockedIdx = -1) {
  return DISC_SUBSTATS.map((_, i) => ({
    typeIndex: i,
    score: weights[i] || 0,
    rest: i === blockedIdx ? 0 : rest,
    specialWeight: DISC_SUBSTAT_SPECIAL_WEIGHTS[i],
  }));
}

// B1/B5：首 4 词条组合枚举 + 达标概率。
// 词条池 types: [{ typeIndex, score, rest, specialWeight }]（rest = 该词条可用数，通常 1 = 同盘不重复）
// 目标 goal（价值分）：对每个首 4 词条组合（按 specialWeight 概率加权），
// 基础分达标则通过率 1，否则按 4/3 词条两路径强化成长算通过率；两路径按 20%/80% 占比加权。
// 返回 { chance, p4, p3 }（均未含主词条/位置 scaleFactor）：chance = 0.2×p4 + 0.8×p3；
// p4 = 初始 4 词条盘（成长 5 次）的条件通过率；p3 = 初始 3 词条盘（补词条后成长 4 次）的条件通过率。
// op = '>'（默认，严格超过）| '>='（不低于 = 超过 + 恰好打平，供「持平概率」用）| '='（恰好打平）。
// 非严格 op 语义：scoreSum 已达目标 → 直接通过；否则数「成长加成补齐剩余差额」的路径。
export function computeDiscProb(types, goal, directedTypes = [], op = '>') {
  const groups = [];
  (function pick(rest, chosen, scoreSum, weight) {
    if (chosen.length === 4) {
      if (directedTypes.length) {
        const have = new Set(chosen.map((c) => c.typeIndex));
        if (!directedTypes.every((t) => have.has(t))) return;
      }
      groups.push({ scores: chosen.map((c) => c.score), scoreSum, weight });
      return;
    }
    const total = rest.reduce((s, t) => s + (t.rest > 0 ? t.specialWeight : 0), 0);
    if (total === 0) return;
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (t.rest <= 0) continue;
      const next = rest.map((x) => ({ ...x }));
      next[i].rest--;
      chosen.push(t);
      pick(next, chosen, scoreSum + t.score, weight * (t.specialWeight / total));
      chosen.pop();
    }
  })(
    types.map((t) => ({ ...t })),
    [],
    0,
    1
  );

  let totalW = 0;
  let totalA = 0;
  let totalB = 0;
  const branchChance = (times, scoreSum, scores) => {
    if (op === '>') return scoreSum > goal ? 1 : passChance(times, goal - scoreSum, scores);
    if (op === '>=') return scoreSum >= goal ? 1 : passChance(times, goal - scoreSum, scores, '>=');
    return scoreSum > goal ? 0 : passChance(times, goal - scoreSum, scores, '=');
  };
  for (const g of groups) {
    const pA = branchChance(FOUR_SUB_TIMES, g.scoreSum, g.scores);
    const pB = branchChance(THREE_SUB_TIMES, g.scoreSum, g.scores);
    totalW += g.weight;
    totalA += pA * g.weight;
    totalB += pB * g.weight;
  }
  if (totalW === 0) return { chance: 0, p4: 0, p3: 0 };
  const mA = totalA / totalW; // 4 词条盘路径（成长 5 次）通过率
  const mB = totalB / totalW; // 3 词条盘路径（补词条后成长 4 次）通过率
  return { chance: FOUR_SUB_CHANCE * mA + THREE_SUB_CHANCE * mB, p4: mA, p3: mB };
}

// B6/B7/B8：位置级概率（主词条加权 + 位置系数 + 定向道具）。
// pos 1-6；mains = 该位置选中的主词条（pos≤3 忽略，传 [] 或 null，空 = 不限即全部主词条）。
// B7：主词条概率按「全位置权重和」归一（mains 只决定哪些主词条计入成功，不改变其出现概率）；
// B6：位置随机 ×1/6。
// B8 opts.posFixed（定向道具）：非空主词条名 = 位置与主词条都已确定（不乘 1/6、不乘主词条出现概率），
//   123 号位传任意非空值即可（主词条固定，仅消除位置随机）。
// 返回 { prob, hitMain, p4, p3 }：
//   hitMain = 抽中该号位主词条的概率（未定向 456 = 1/6 × 主词条出现概率和，123 = 1/6；定向 = 1）；
//   p4 = 初始 4 词条盘升满后超过的纯条件概率（不含 hitMain：456 按主词条相对占比加权平均）；
//   p3 = 初始 3 词条盘升满后超过的纯条件概率（不含 hitMain）；
//   prob = 总概率（含 hitMain 与分支占比）；单目标主词条时 prob = hitMain × (0.2×p4 + 0.8×p3)。
export function computePosProb(pos, mains, types, goal, directedTypes = [], opts = {}, op = '>') {
  if (opts.posFixed) {
    // 定向：位置确定；456 主词条确定（123 主词条固定）
    if (pos <= 3) {
      const r = computeDiscProb(types, goal, directedTypes, op);
      return { prob: r.chance, hitMain: 1, p4: r.p4, p3: r.p3 };
    }
    const blockedIdx = DISC_SUBSTATS.indexOf(DISC_MAIN_BLOCK[opts.posFixed]);
    const pool = types.map((t) => ({ ...t, rest: t.typeIndex === blockedIdx ? 0 : t.rest }));
    const r = computeDiscProb(pool, goal, directedTypes, op);
    return { prob: r.chance, hitMain: 1, p4: r.p4, p3: r.p3 };
  }
  if (pos <= 3) {
    const r = computeDiscProb(types, goal, directedTypes, op);
    return { prob: r.chance / 6, hitMain: 1 / 6, p4: r.p4, p3: r.p3 };
  }
  const probWeights = DISC_MAIN_PROB_WEIGHTS[pos];
  const totalAll = Object.values(probWeights).reduce((s, v) => s + v, 0); // 全位置主词条权重和（≈100）
  if (totalAll === 0) return { prob: 0, hitMain: 0, p4: 0, p3: 0 };
  const mainList = mains && mains.length ? mains : Object.keys(probWeights);
  const totalW = mainList.reduce((s, m) => s + (probWeights[m] || 0), 0); // 选中集权重和（p4/p3 归一口径）
  let hitMain = 0;
  let p4 = 0;
  let p3 = 0;
  let prob = 0;
  for (const main of mainList) {
    const w = probWeights[main] || 0;
    const f = w / totalAll / 6; // 位置 1/6 × 主词条出现概率
    hitMain += f;
    const blockedIdx = DISC_SUBSTATS.indexOf(DISC_MAIN_BLOCK[main]); // 主词条同类副词条（SUBSTAT 值 → 索引）
    const pool = types.map((t) => ({ ...t, rest: t.typeIndex === blockedIdx ? 0 : t.rest }));
    const r = computeDiscProb(pool, goal, directedTypes, op);
    const rel = w / totalW; // 选中集内相对占比（p4/p3 纯条件，不含位置与绝对主词条概率；单目标 = 1）
    p4 += r.p4 * rel;
    p3 += r.p3 * rel;
    prob += r.chance * f;
  }
  return { prob, hitMain, p4, p3 };
}

// ============================================================
// C. 分数与命中（C4 substatRolls 在本文件词条区）
// ============================================================
// C3：单盘落在有效词条上的命中次数（每个词条本身 1 + 成长次数）；validSet 空 = 无有效集，返回 null。
// 供 Disc.getHitCount / calc.hitCount 与「我的角色」副词条命中共用。
export function discHits(growth, validSet) {
  if (!validSet || !validSet.size) return null;
  return (growth || []).filter((g) => validSet.has(g.type)).reduce((s, g) => s + 1 + g.growthCount, 0);
}

// C2：单个驱动盘各副词条的成长（强化）次数 = 当前值/成长值 - 1（下限 0）。
// 与 subStats 顺序一一对应；返回 [{name, value, type, growthCount}]。
export function discGrowth(disc, rarity) {
  const table = substatGrowthTable[rarity] || substatGrowthTable.S;
  return statEntries(disc.subStats).map((t) => {
    const type = substatType(t.name, t.value);
    const growth = table[type];
    return { ...t, type, growthCount: growth ? Math.max(0, Math.round(t.value / growth - 1)) : 0 };
  });
}

// ============================================================
// E. 保词条比较（比当前盘更强且词条不缩水）
// ============================================================
// E3：固定值副词条 → 其百分比变体（保词条匹配时百分比视为「一定超过」固定值）
const FIXED_TO_PCT = {
  [DISC_SUBSTATS.indexOf(SUBSTAT.ATK)]: DISC_SUBSTATS.indexOf(SUBSTAT.ATK_PCT), // 攻击力 → 攻击力%
  [DISC_SUBSTATS.indexOf(SUBSTAT.HP)]: DISC_SUBSTATS.indexOf(SUBSTAT.HP_PCT), // 生命值 → 生命值%
  [DISC_SUBSTATS.indexOf(SUBSTAT.DEF)]: DISC_SUBSTATS.indexOf(SUBSTAT.DEF_PCT), // 防御力 → 防御力%
};

// E1-E4：同 computeDiscProb，但额外要求「当前盘每个副词条在新盘中命中数都不低于原盘」：
// minHits = 10 维数组（typeIndex → 最低命中次数，0 = 无约束）。
// 新盘 4 个副词条（槽位顺序无关，按词条类型一对一匹配）必须满足全部约束：
//   - 同类型：新盘该词条最终命中（1 + 强化次数）≥ minHits[type]；
//   - 百分比变体替代（E3）：约束为固定值（攻击力/生命值/防御力）时，新盘的对应百分比词条
//     可视为「词条超过」直接满足（命中 ≥ 1 即可，反向不成立）；
//   - 当前盘同时有固定值与百分比时两者各自独立约束（一个词条只能满足一个约束，E1/E2）。
// 且总分 > goal（E4）。返回 { chance }。
function computeDiscProbKeep(types, goal, minHits, directedTypes = []) {
  const minH = minHits || [];
  const cons = [];
  for (let ti = 0; ti < minH.length; ti++) {
    if (minH[ti] > 0) cons.push({ type: ti, need: minH[ti] });
  }
  const groups = [];
  (function pick(rest, chosen, weight) {
    if (chosen.length === 4) {
      if (directedTypes.length) {
        const have = new Set(chosen.map((c) => c.typeIndex));
        if (!directedTypes.every((t) => have.has(t))) return;
      }
      groups.push({ chosen: chosen.slice(), weight }); // 必须存副本：chosen 在回溯时被 pop 复用
      return;
    }
    const total = rest.reduce((s, t) => s + (t.rest > 0 ? t.specialWeight : 0), 0);
    if (total === 0) return;
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (t.rest <= 0) continue;
      const next = rest.map((x) => ({ ...x }));
      next[i].rest--;
      chosen.push(t);
      pick(next, chosen, weight * (t.specialWeight / total));
      chosen.pop();
    }
  })(
    types.map((t) => ({ ...t })),
    [],
    1
  );

  /** 约束能否被 combo 词条（各带最终命中 hits）一对一全匹配（二分匹配回溯，E1/E3） */
  function matchOk(combo, hits, cons) {
    if (cons.length > combo.length) return false;
    const used = new Array(combo.length).fill(false);
    function tryMatch(ci) {
      if (ci === cons.length) return true;
      const c = cons[ci];
      for (let j = 0; j < combo.length; j++) {
        if (used[j]) continue;
        const t = combo[j].typeIndex;
        const okSelf = t === c.type && hits[j] >= c.need;
        const okPct = t === FIXED_TO_PCT[c.type] && hits[j] >= 1; // 百分比变体视为超过固定值
        if (okSelf || okPct) {
          used[j] = true;
          if (tryMatch(ci + 1)) return true;
          used[j] = false;
        }
      }
      return false;
    }
    return tryMatch(0);
  }

  /** 组合的强化路径通过率：times 次强化分配到 4 词条（stars-and-bars 枚举分布 × multinomial 权重，比全排列快） */
  function passKeep(combo, times) {
    const n = combo.length;
    if (cons.length > n) return 0;
    const fact = (x) => {
      let r = 1;
      for (let i = 2; i <= x; i++) r *= i;
      return r;
    };
    const num = fact(times);
    let total = 0;
    let pass = 0;
    const dist = new Array(n).fill(0);
    (function rec(i, remain) {
      if (i === n - 1) {
        dist[i] = remain;
        let w = num; // multinomial = times! / Π dist_j!（总权重 = n^times，公共因子已含）
        for (let j = 0; j < n; j++) w /= fact(dist[j]);
        total += w;
        const hits = dist.map((d) => 1 + d);
        let score = 0;
        for (let j = 0; j < n; j++) score += hits[j] * combo[j].score;
        if (score > goal && matchOk(combo, hits, cons)) pass += w;
        return;
      }
      for (let c = 0; c <= remain; c++) {
        dist[i] = c;
        rec(i + 1, remain - c);
      }
    })(0, times);
    return total === 0 ? 0 : pass / total;
  }

  let totalW = 0;
  let totalA = 0;
  let totalB = 0;
  for (const g of groups) {
    totalW += g.weight;
    totalA += passKeep(g.chosen, FOUR_SUB_TIMES) * g.weight;
    totalB += passKeep(g.chosen, THREE_SUB_TIMES) * g.weight;
  }
  if (totalW === 0) return { chance: 0 };
  return { chance: (FOUR_SUB_CHANCE * totalA + THREE_SUB_CHANCE * totalB) / totalW };
}

// E1-E4 位置级：同 computePosProb，但内部用 computeDiscProbKeep（新盘必须包含当前盘全部权重>0 的副词条类型且各自命中不低，且总分超过）。
export function computePosProbKeep(pos, mains, types, goal, minHits, directedTypes = [], opts = {}) {
  if (opts.posFixed) {
    if (pos <= 3) {
      const r = computeDiscProbKeep(types, goal, minHits, directedTypes);
      return { prob: r.chance };
    }
    const blockedIdx = DISC_SUBSTATS.indexOf(DISC_MAIN_BLOCK[opts.posFixed]);
    const pool = types.map((t) => ({ ...t, rest: t.typeIndex === blockedIdx ? 0 : t.rest }));
    const r = computeDiscProbKeep(pool, goal, minHits, directedTypes);
    return { prob: r.chance };
  }
  if (pos <= 3) {
    const r = computeDiscProbKeep(types, goal, minHits, directedTypes);
    return { prob: r.chance / 6 };
  }
  const probWeights = DISC_MAIN_PROB_WEIGHTS[pos];
  const totalAll = Object.values(probWeights).reduce((s, v) => s + v, 0);
  if (totalAll === 0) return { prob: 0 };
  const mainList = mains && mains.length ? mains : Object.keys(probWeights);
  let prob = 0;
  for (const main of mainList) {
    const w = probWeights[main] || 0;
    const blockedIdx = DISC_SUBSTATS.indexOf(DISC_MAIN_BLOCK[main]);
    const pool = types.map((t) => ({ ...t, rest: t.typeIndex === blockedIdx ? 0 : t.rest }));
    const r = computeDiscProbKeep(pool, goal, minHits, directedTypes);
    prob += (r.chance * w) / totalAll / 6;
  }
  return { prob };
}

// ============================================================
// Disc 模型类
// ============================================================

/** 驱动盘基类：名称/位置/等级/稀有度/主词条/副词条 + 各副词条成长次数 */
export class Disc {
  constructor(data = {}) {
    // 账号版：set/slot/level/rarity/mainStats/subStats；wiki 版：name/icon/set2…
    this.name = data.name || '';
    this.set = data.set || data.name || '';
    this.slot = data.slot ?? null;
    this.level = data.level ?? null;
    this.icon = data.icon || '';
    this.roundIcon = data.roundIcon || ''; // 圆形光盘图标（wiki 提取，卡片/汇总视图用）
    this.rarity = data.rarity || 'S';
    this.mainStats = data.mainStats || [];
    this.subStats = data.subStats || [];
    // wiki 版：套装效果
    this.set2 = data.set2 ?? null;
    this.set4 = data.set4 ?? null;
    this.set2Text = data.set2Text || '';
    this.set4Text = data.set4Text || '';
    // wiki 扩展：套装故事/推荐角色/副词条建议/部位主词条
    this.setLore = data.setLore || [];
    this.recommend = data.recommend || [];
    this.substatAdvice = data.substatAdvice || '';
    this.slotMainStats = data.slotMainStats || [];
    // 派生计算：各副词条成长（强化）次数（权威实现即本文件 C2 discGrowth）
    this.growth = discGrowth(this, this.rarity);
  }

  /** 该盘落在有效词条上的命中次数（每个词条本身 1 + 成长次数）；未设有效属性返回 null */
  getHitCount(validSet) {
    // 权威实现即本文件 C3（discHits）
    return discHits(this.growth, validSet);
  }
}
