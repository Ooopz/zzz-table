// src/game/index.js —— 游戏概念/规则权威层「单一出口」
// 按游戏实体分域：disc(驱动盘域 + 属性-词条词汇体系) + character(角色域) + wengine(音擎域)，
// 另收跨实体公共件（实体词表 / 泛型实例化）——它们不专属于任何实体，故住 barrel。
// 消费端统一从本入口 import，禁止另立局部副本（防漂移靠：单一出处 + 派生集合 + 自检，见 test/game-consistency.test.js）；
// lint 由 no-restricted-imports 强制本约定。依赖方向：character → disc / wengine，disc 与 wengine 为叶子。
import { normalize, normalizeRomanKey } from '../lib/util.js';

export * from './disc.js';
export * from './character.js';
export * from './wengine.js';

// ---------- 跨实体词表（角色/音擎/驱动盘/邦布共用） ----------
// 权威数据层：仅声明概念；解析算法在 src/lib/names.js。双端共用，禁止 import 任何 node: 模块。
export const CATEGORY = Object.freeze({ CHAR: 'char', WENGINE: 'wengine', DISC: 'disc', BANGBOO: 'bangboo' });

/** 归一化键：char/disc/bangboo 用 normalize；wengine 必须用 normalizeRomanKey —— normalize 会剥光罗马数字，使 残响-Ⅰ/Ⅱ/Ⅲ 系列键碰撞 */
export const CATEGORY_KEY = Object.freeze({
  [CATEGORY.CHAR]: normalize,
  [CATEGORY.WENGINE]: normalizeRomanKey,
  [CATEGORY.DISC]: normalize,
  [CATEGORY.BANGBOO]: normalize,
});

/** 手工别名表（变体 → 规范名；规范名须存在于 library 键，否则 buildNameIndex 会跳过该条） */
export const ALIASES = Object.freeze({
  [CATEGORY.CHAR]: Object.freeze({
    亚历山德丽娜·莎芭丝提安: '亚历山德丽娜·莎芭丝缇安', // 工坊「提」vs wiki「缇」（原 panelBench.CHAR_ALIASES）
    维琳娜: '维琳娜·艾嘉德', // 工坊 grad 短名
    '11号': '「11号」', // 工坊 grad 缺书名号（normalize 也能命中，显式别名表意）
    星徽·比利: '星徽·比利·奇德', // 歧义关键：比利·奇德 是两者子串，显式别名抢占
  }),
  [CATEGORY.WENGINE]: Object.freeze({}),
  [CATEGORY.DISC]: Object.freeze({
    棘刺玫瑰: '荆棘玫瑰', // wiki 页面名（2026-10 起为「荆棘玫瑰」）；旧名兼容历史数据（plans/workshop 写时固化的旧标准名）
  }),
  [CATEGORY.BANGBOO]: Object.freeze({}),
});

/** 类别别名表便捷引用（CHAR_ALIASES 供 web/wsRoles.js 使用；DISC_ALIASES 仅测试使用） */
export const CHAR_ALIASES = ALIASES[CATEGORY.CHAR];
export const DISC_ALIASES = ALIASES[CATEGORY.DISC];

/** 泛型实例化：{key: data} → {key: Base 实例}（web/data.js 组装账号/库实体用） */
export function toInstances(obj, Base) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = new Base(v);
  return out;
}
