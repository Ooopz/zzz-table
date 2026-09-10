// src/web/discDisplay.js —— 驱动盘模拟视图的显示配对（H1 规则；无依赖叶子模块，Node 测试可直接 import）
// 2026-09 自 src/game 迁入（应用层显示规则，非游戏规则）；唯一消费者 web/discProb.js。
// 不放 discProb.js 本体：其模块图顶层触 DOM（data.js），Node 侧测试不可导入；下标不变量由 test/game-consistency.test.js 校验。

// H1：副词条池 5 行 × 2 列配对顺序（每行两个数值即 DISC_SUBSTATS 下标；固定值在前、百分比在后）
export const DP_ROW_PAIRS = [
  [1, 0], // 生命值   | 生命值%
  [6, 5], // 防御力   | 防御力%
  [3, 2], // 攻击力   | 攻击力%
  [8, 7], // 暴击率   | 暴击伤害
  [9, 4], // 异常精通 | 穿透值
];
/** 副词条下拉/显示展示顺序（配对展平，与权重池一致） */
export const DP_SUB_ORDER = DP_ROW_PAIRS.flat();
