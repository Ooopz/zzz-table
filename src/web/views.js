// src/web/views.js —— 视图 IA 枚举：合法 view 值与旧持久化值迁移（应用层概念，2026-09 自 src/game 迁出）
// 持久化位置：URL ?view= 与 user-config 的 view 字段。

// 持久化值：「我的角色」视图 2026-09 更名「角色」，内部 id 一并改为 roles，
// 旧持久化值 mychars 经 LEGACY_VIEW_MAP 迁移；更早历史值 recommend/discstats/card/table 已由 migrateViewState 一次性迁移。
export const VIEWS = Object.freeze({
  ROLES: 'roles',
  DISC: 'discs',
  SIMULATE: 'simulate',
  WIKI: 'wiki',
});
/** 合法 view 值集合。⚠️ 校验必须查这里，不能写 `VIEWS[raw]`——VIEWS 的键是 WIKI/DISC/…，
 *  持久化的值是 wiki/discs/…，用值当键查恒为 undefined，四个视图会全部被判非法回退 roles。 */
export const VIEW_VALUES = new Set(Object.values(VIEWS));
/** 旧 view 持久化值 → 当前值（一次性迁移映射）。⚠️ 旧「统计」(stats) 在 URL 里要按 tab 分流到三个不同去处，
 *  那部分逻辑在 web/urlState.js 的 migrateLegacyStats；本表用于 user-config 里「无 tab 信息」的归一（stats 只能落 roles）。
 *  迁移批次：2026-09 我的角色→角色（mychars→roles）；2026-11 recommend/discstats/card/table；2026-08 IA 重构 simulate→plan。 */
export const LEGACY_VIEW_MAP = Object.freeze({
  recommend: 'roles',
  mychars: 'roles',
  discstats: 'discs',
  card: 'roles',
  table: 'roles',
  stats: 'roles',
  // 2026-08 练度规划（goal）退役：并入「角色」·汇总表手风琴；goal/plan 旧值不迁移，非法回退 roles。
  // simulate 现为合法值（新「模拟」视图），不再是旧值。
});
