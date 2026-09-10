// src/game/character.js —— 角色实体域：面板展示序 + 养成目标配置 + 角色元数据（元素/职业/阵营/技能）+ Character 模型类
// 依赖：disc.js（属性-词条词汇与 Disc 类，单向依赖）、wengine.js（Wengine 类）、lib/calc.js（面板计算）、lib/util.js。
// 角色元数据随角色更新会新增取值，运行期对未知值一律**放行**（当前按文本处理）；
// 一致性由 test/character-meta.test.js 校验现有 data/library.json 兜底——新值出现测试标红，补录后转绿。
import { STAT, SUBSTAT, PANEL_STAT_MAP, Disc } from './disc.js';
import { Wengine } from './wengine.js';
import { calculateCharacter, hitCount, ctxVersion } from '../lib/calc.js';
import { normalizeStatKeys } from '../lib/util.js';

// ---------- 面板展示序与满级成长 ----------
/** 面板属性展示顺序（卡片/表格列序的权威依据） */
export const PANEL_ORDER = Object.freeze([
  STAT.ATK,
  STAT.HP,
  STAT.DEF,
  STAT.IMPACT,
  STAT.CR,
  STAT.CD,
  STAT.ANOMALY_CTRL,
  STAT.ANOMALY_PROF,
  STAT.PEN_RATE,
  STAT.PIERCE,
  STAT.PEN_VALUE,
  STAT.ENERGY,
]);
/** 满级行仅含的基础属性（wiki 成长表「满级」只有这三项），wiki 视图的「满级X」列与此对齐 */
export const MAX_LEVEL_STATS = Object.freeze([STAT.HP, STAT.ATK, STAT.DEF]);

// ---------- 养成目标配置 schema（目标设置弹窗） ----------
export const TARGET_STATS = Object.freeze([
  STAT.ATK,
  STAT.CR,
  STAT.CD,
  STAT.PEN_RATE,
  STAT.ANOMALY_CTRL,
  STAT.ANOMALY_PROF,
  STAT.IMPACT,
  STAT.ENERGY,
  STAT.HP,
  STAT.DEF,
  STAT.PEN_VALUE, // 汇总表可配置目标列（穿透值；卡片面板行迁移）
  STAT.PIERCE, // 汇总表可配置目标列（贯穿力，命破角色派生；卡片面板行迁移）
  '属性伤害加成',
]);
/** 目标中按百分比存储的属性（用户填整数，内部 /100） */
export const TARGET_PERCENTS = new Set([STAT.CR, STAT.CD, STAT.PEN_RATE, '属性伤害加成']);

/** 目标配置里的非属性字段：推荐音擎 + 4/5/6 号位主词条 + 有效副词条（存于 charTargets[name]；
 *  存副词条类型数组，属性粒度勾选经 PANEL_STAT_MAP 展开） */
export const TARGET_KEYS = Object.freeze({
  WENGINE: '推荐音擎',
  MAIN4: '4号位主词条',
  MAIN5: '5号位主词条',
  MAIN6: '6号位主词条',
  VALID_STATS: '有效副词条',
});

// ---------- 有效副词条勾选（养成配置弹窗 schema） ----------
/** 有效副词条勾选项（副词条粒度，养成配置弹窗用）：攻击/生命/防御的 % 与固定分开勾选。
 *  命中/概率统一 % 口径：勾「攻击力（固定）」计入目标建议面板属性，但不计副词条命中与重刷概率。 */
export const EFFECTIVE_SUBSTAT_OPTIONS = Object.freeze([
  { type: SUBSTAT.ATK_PCT, label: '攻击力%' },
  { type: SUBSTAT.ATK, label: '攻击力（固定）' },
  { type: SUBSTAT.HP_PCT, label: '生命值%' },
  { type: SUBSTAT.HP, label: '生命值（固定）' },
  { type: SUBSTAT.DEF_PCT, label: '防御力%' },
  { type: SUBSTAT.DEF, label: '防御力（固定）' },
  { type: SUBSTAT.CR, label: '暴击率' },
  { type: SUBSTAT.CD, label: '暴击伤害' },
  { type: SUBSTAT.ANOMALY_PROF, label: '异常精通' },
  { type: SUBSTAT.PEN_VALUE, label: '穿透值' },
]);
/** 面板属性集合（attrsOfTypes 反查用；勾选粒度为副词条，面板属性显示仍按属性推导） */
export const EFFECTIVE_ATTRS = Object.freeze(Object.keys(PANEL_STAT_MAP));

// ---------- 技能类型（统一 canonical 编号；工坊两源与官方账号 API 实为同一套 type 编号） ----------
/** 技能类型（canonical 键，即 SKILL_TYPES 的 key；代码比较/分支必须用这些命名常量，勿裸写 0-5）。
 *  ⚠️ 历史（2026-08 修正）：曾假设 2025 源是「游戏内嵌 1.x 技能 ID」（1 闪避/2 特殊）并单设 WS2025_SKILL_TYPE——
 *  实为误判，证据见 sync/workshop.js OFFICIAL_SKILL_TYPE 处注释（耀嘉音辅助闪避 12 级×90% 反直觉 + 57 角色双源指纹交叉验证）。 */
export const SKILL = Object.freeze({
  NORMAL: 0, // 普攻
  DODGE: 1, // 闪避
  SUPPORT: 2, // 支援
  SPECIAL: 3, // 特殊技
  ULTIMATE: 4, // 终结/连携（共享等级）
  CORE: 5, // 核心被动
});
/** canonical 键 → 展示名（SKILL_TYPES 的唯一标签来源） */
const SKILL_LABEL = {
  [SKILL.NORMAL]: '普攻',
  [SKILL.DODGE]: '闪避',
  [SKILL.SUPPORT]: '支援',
  [SKILL.SPECIAL]: '特殊',
  [SKILL.ULTIMATE]: '终结',
  [SKILL.CORE]: '核心',
};
/** 统一技能类型列表（canonical，游戏 2.0 槽顺序：普攻/闪避/支援/特殊/终结/核心；无独立「连携」——连携与终结同槽共享等级）。
 *  落盘数据（characters.json / workshop.json）的技能 type 已在 sync 写入侧归一为 canonical——
 *  官方编号 → canonical 映射由 sync 各脚本自持（见 sync/characters.js、sync/workshop.js 的 OFFICIAL_SKILL_TYPE）。 */
export const SKILL_TYPES = Object.freeze(Object.keys(SKILL_LABEL).map((k) => ({ key: Number(k), label: SKILL_LABEL[k] })));

// ---------- 角色固有元数据枚举：属性(element)/职业(trait)/阵营(faction) ----------
// 图标：仅 属性/职业 各一张小图(assets/img/…，构建内联为 base64)；阵营不落图。
export const ELEMENT = Object.freeze({
  电: '电', 冰: '冰', 物理: '物理', 风: '风', 流明: '流明', 火: '火', 以太: '以太',
  凛刃: '凛刃', 玄墨: '玄墨', 烈霜: '烈霜',
});
export const TRAIT = Object.freeze({
  锋御: '锋御', 强攻: '强攻', 击破: '击破', 支援: '支援', 异常: '异常', 命破: '命破', 防护: '防护',
});
export const FACTION = Object.freeze({
  弗林特工坊: '弗林特工坊', 空域巡戍局: '空域巡戍局', 坎卜斯黑枝: '坎卜斯黑枝', 怪啖屋: '怪啖屋',
  'H.S.O.S.6': 'H.S.O.S.6', 达识结社: '达识结社', 外务筹策局: '外务筹策局', 法厄同: '法厄同',
  狡兔屋: '狡兔屋', 都市秩序部: '都市秩序部', 妄想天使: '妄想天使', 云岿山: '云岿山',
  奥波勒斯小队: '奥波勒斯小队', 反舌鸟: '反舌鸟', '防卫军·白银小队': '防卫军·白银小队', 天琴座: '天琴座',
  卡吕冬之子: '卡吕冬之子', 刑侦特勤组: '刑侦特勤组', 维多利亚家政: '维多利亚家政', 白祇重工: '白祇重工',
});
export const ELEMENT_SET = new Set(Object.values(ELEMENT));
export const TRAIT_SET = new Set(Object.values(TRAIT));
export const FACTION_SET = new Set(Object.values(FACTION));

// ---------- Character 模型类 ----------

/** 角色基类：组合音擎 + 驱动盘，提供面板/达成率/命中计算 */
export class Character {
  constructor(data = {}) {
    // 基础字段
    this.name = data.name || '';
    this.id = data.id ?? null;
    this.level = data.level ?? null;
    this.icon = data.icon || '';
    this.rarity = data.rarity || '';
    this.faction = data.faction || '';
    this.panel = data.panel || {};
    this.skills = data.skills || [];
    this.mindscape = data.mindscape || null;
    this.skillAwaken = data.skillAwaken || null;
    this.equipPlan = data.equipPlan || null;
    // wiki 属性库字段
    this.element = data.element || '';
    this.trait = data.trait || '';
    // 满级属性键名归一化（wiki 页面各角色用词不一：生命/生命力/攻击/防御 → 生命值/攻击力/防御力）
    this.maxLevel = normalizeStatKeys(data.maxLevel);
    // 其余字段（wiki 扁平初始属性 / description / cinemas / appearance / cv 等）统一归一化到实例，避免 calc/wiki 各自去猜 .extra 字段；
    // wengine/discs 在下文用基类实例化，此处跳过（避免先拷贝再被覆盖的浪费）
    for (const [k, v] of Object.entries(data)) if (!(k in this) && k !== 'wengine' && k !== 'discs') this[k] = v;
    // 组合：音擎 + 驱动盘（覆盖原始嵌套）
    this.wengine = data.wengine ? new Wengine(data.wengine) : null;
    this.discs = (data.discs || []).map((d) => new Disc(d));
  }

  /** 计算最终面板（数据经 setCalcContext 注入）。按 ctxVersion 缓存：同一次数据加载内反复渲染只算一次，
   *  数据源刷新（setCalcContext）或实例重建（setData）时自动失效。 */
  calculate() {
    if (this._calcVersion === ctxVersion && this._calcCache) return this._calcCache;
    this._calcVersion = ctxVersion;
    this._calcCache = calculateCharacter(this);
    return this._calcCache;
  }

  hitCount() {
    return hitCount(this);
  }
}
