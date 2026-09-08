// src/game/index.js —— 游戏概念/规则权威层「单一出口」
// 内容：constants(概念字典/分类) + discRules(驱动盘规则) + models(领域类型) + entityNames(实体词表)。
// 消费端统一从本入口 import，禁止另立局部副本（防漂移靠：单一出处 + 派生集合 + 自检，见 code-issues 讨论）。
export * from './constants.js';
export * from './discRules.js';
export * from './models.js';
export * from './entityNames.js';
export { coreConsistencyIssues, assertCoreConsistent } from './consistency.js';
