// src/game/entityNames.js —— 实体(角色/音擎/驱动盘/邦布)词表：类别 + 归一化键策略 + 手工别名（names.js 的**非函数**部分迁入）
// 权威数据层：仅声明概念；解析算法仍在 src/lib/names.js。消费端建议经 ../game/index.js 单一入口引用。
// 双端共用，禁止 import 任何 node: 模块。
import { normalize, normalizeRomanKey } from '../lib/util.js';

export const CATEGORY = { CHAR: 'char', WENGINE: 'wengine', DISC: 'disc', BANGBOO: 'bangboo' };

/** 归一化键：char/disc/bangboo 用 normalize；wengine 必须用 normalizeRomanKey —— normalize 会剥光罗马数字，使 残响-Ⅰ/Ⅱ/Ⅲ 系列键碰撞 */
export const CATEGORY_KEY = {
  [CATEGORY.CHAR]: normalize,
  [CATEGORY.WENGINE]: normalizeRomanKey,
  [CATEGORY.DISC]: normalize,
  [CATEGORY.BANGBOO]: normalize,
};

/** 手工别名表（变体 → 规范名；规范名须存在于 library 键，否则 buildNameIndex 会跳过该条） */
export const ALIASES = {
  [CATEGORY.CHAR]: {
    亚历山德丽娜·莎芭丝提安: '亚历山德丽娜·莎芭丝缇安', // 工坊「提」vs wiki「缇」（原 panelBench.CHAR_ALIASES）
    维琳娜: '维琳娜·艾嘉德', // 工坊 grad 短名
    '11号': '「11号」', // 工坊 grad 缺书名号（normalize 也能命中，显式别名表意）
    星徽·比利: '星徽·比利·奇德', // 歧义关键：比利·奇德 是两者子串，显式别名抢占
  },
  [CATEGORY.WENGINE]: {},
  [CATEGORY.DISC]: {
    棘刺玫瑰: '荆棘玫瑰', // wiki 页面名（2026-10 起为「荆棘玫瑰」）；旧名兼容历史数据（plans/workshop 写时固化的旧标准名）
  },
  [CATEGORY.BANGBOO]: {},
};

/** 类别别名表便捷引用（CHAR_ALIASES 供 web/wsRoles.js 使用；DISC_ALIASES 仅测试使用） */
export const CHAR_ALIASES = ALIASES[CATEGORY.CHAR];
export const DISC_ALIASES = ALIASES[CATEGORY.DISC];
