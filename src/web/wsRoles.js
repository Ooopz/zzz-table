// src/web/wsRoles.js —— 工坊/方案数据的「标准角色名」缓存层：grad item_id ↔ wiki 标准名映射、
// 玩家分布面板、推荐三档统计等按引用失效的缓存（原 statsView.js 内嵌实现抽出，手风琴/总览视图共用）。
// ⚠️ 单槽哨兵缓存（wsRoleIdMap / recTierStats / wsPanelMap / alignRoleName）全靠 workshopGrad/plans/panels 引用比较失效——搬移时逐字保留其引用守卫语义，勿在 import 期预建（会在 setData() 前冻结而永久陈旧）。
import { plans, workshopGrad, workshopStats, charIndex, statsMissingData, myCharacters, wengineIndex } from './data.js';
import { computeRecTierStats } from '../lib/panelBench.js';
import { CHAR_ALIASES, canonicalName, CATEGORY, resolveEntry } from '../lib/names.js';
import { SKILL_TYPES, OFFICIAL_SKILL_TYPE } from '../lib/constants.js';
import { emptyState } from './shared.js';

/** 统一空态转发（缺数据源时给对应同步指引） */
export function statsNotReady() {
  const miss = statsMissingData();
  if (!miss.length) return null;
  const hint =
    miss.length === 2
      ? '请在右上角 <b>同步数据 → 更新推荐方案</b>，以及 <b>更新工坊数据</b>（全量爬取，耗时数小时）后刷新查看。'
      : miss[0] === '推荐方案'
        ? '请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。'
        : '请在右上角 <b>同步数据 → 更新工坊数据</b>（全量爬取，耗时数小时）后刷新查看。';
  return emptyState(`暂无${miss.join('、')}数据。`, hint);
}

/** 查 library.wengines 音擎：统一 resolver（精确/别名/normalizeRomanKey，如 残响-II型→「残响」-Ⅱ型）。
 *  挪来共用（手风琴配装对标等解析工坊源音擎名）。 */
export function findLibraryWengine(name) {
  return resolveEntry(CATEGORY.WENGINE, wengineIndex, name);
}

// ---------- grad 数据缓存（workshopGrad.roles 引用变化时惰性重建） ----------
let _roleIdRoles = null;
let _roleIdCache = null;
let _roleIdByName = null;
/** grad item_id → 角色名（供 workshop-stats 的 role_id 映射） */
function wsRoleIdMap() {
  const roles = workshopGrad.roles;
  if (_roleIdRoles !== roles) {
    _roleIdRoles = roles;
    _roleIdCache = new Map((roles || []).map((r) => [String(r.item_id), r.name]));
    _roleIdByName = new Map((roles || []).map((r) => [r.name, String(r.item_id)]));
  }
  return _roleIdCache;
}
let _wsPanelRoles = null;
let _wsPanelCache = null;
/** 角色名 → role_id（workshop-stats 的 panels/panelScatter 按 role_id 键；grad name→id 缓存反查） */
export function roleIdFor(name) {
  // 必须恒走身份守卫的 wsRoleIdMap 重建：旧的 `if (!_roleIdByName)` 惰性守卫在数据换新后、
  // 本函数是首个消费者时会返回上一份 roles 的过期反查表（goalView 散点 perRole 查不到 → 空面板）
  wsRoleIdMap();
  return _roleIdByName?.get(name) ?? null;
}
/** 推荐三档统计（plans → 每角色每属性 low/mid/high 的 mean/median/sd/cv），按 plans 引用缓存。
 *  实测 ~51ms/次而每次切角色都重渲染（两面板各调一次，等于每次交互白烧 ~100ms）。 */
let _tierPlans = null;
let _tierCache = null;
export function recTierStats() {
  if (_tierPlans !== plans) {
    _tierPlans = plans;
    _tierCache = computeRecTierStats(plans);
  }
  return _tierCache;
}

/** grad/工坊名 → plans 标准角色名（resolver 优先；落空 CHAR_ALIASES + plans 子串）。
 *  按名字缓存：建表循环逐角色调用（57 角色 × 8 个源），每次调用都重建 planNames 并做子串扫描。 */
let _alignPlans = null;
let _alignCache = new Map();
export function alignRoleName(name) {
  if (_alignPlans !== plans) {
    _alignPlans = plans;
    _alignCache = new Map();
  }
  const cached = _alignCache.get(name);
  if (cached !== undefined) return cached;
  const planNames = Object.values(plans).map((v) => v.name);
  const n = canonicalName(CATEGORY.CHAR, charIndex, name);
  let out;
  if (n) {
    out = n;
  } else {
    const a = CHAR_ALIASES[name] || name;
    out = planNames.includes(a) ? a : planNames.find((p) => p.includes(a) || a.includes(p)) || a;
  }
  _alignCache.set(name, out);
  return out;
}
/** 角色名 → 玩家真实样本面板统计（workshop-stats.panels）；key 对齐 plans 角色名（grad 名可能为简称/缇提差异） */
export function wsPanelMap() {
  const panels = workshopStats.panels;
  if (_wsPanelRoles !== panels) {
    _wsPanelRoles = panels;
    const idToName = wsRoleIdMap();
    _wsPanelCache = new Map();
    for (const p of panels || []) {
      const gradName = idToName.get(String(p.name));
      if (gradName && p.stats) _wsPanelCache.set(alignRoleName(gradName), p.stats);
    }
  }
  return _wsPanelCache;
}
/** 通用缓存：role_id 键的 stats 对象（relicStats/rankDist/skillStats 等）→ 角色名键 Map。
 *  用 WeakMap 按源对象缓存而非单槽：多个源的调用方会轮流打穿单槽（命中率 0），WeakMap 各源各自命中且旧表可回收。 */
const _roleKeyedCache = new WeakMap();
export function roleKeyedMap(source) {
  if (!source || typeof source !== 'object') return new Map();
  const hit = _roleKeyedCache.get(source);
  if (hit) return hit;
  const idToName = wsRoleIdMap();
  const m = new Map();
  for (const [rid, v] of Object.entries(source)) {
    const gradName = idToName.get(String(rid));
    if (gradName) m.set(alignRoleName(gradName), v);
  }
  _roleKeyedCache.set(source, m);
  return m;
}

/** 技能等级分布 items（汇总手风琴技能养成用）：从 skillStats 直方图 + 我的技能等级组装。
 *  返回 [{label, dist, mine, mode, min, max}]，供 charts.skillDistOption 渲染；
 *  mode = 玩家样本众数（最高频等级，同数取高级，与 skillLevelModes 口径一致），供图内「目标峰值」标记与达标判定；
 *  非核心技能固定 1-16 柱、核心技（canonical 5）固定 1-7 柱（轴统一，跨技能可比，2026-08 规范）；
 *  无样本分布或无账号技能返回 []（调用方静默跳过）。 */
export function skillDistItems(name) {
  const dist = roleKeyedMap(workshopStats.skillStats).get(name);
  const my = myCharacters.find((c) => c.name === name);
  if (!dist || !my?.skills?.length) return [];
  return SKILL_TYPES.map((t) => {
    const d = dist[t.key];
    if (!d) return null;
    const myLv = my.skills.find((s) => OFFICIAL_SKILL_TYPE[s.type] === t.key)?.level;
    // 众数：最高频等级；同数取高级（与 computeSkillLevelModes 的并列取高一致）
    let modeLv = null;
    let best = -1;
    for (const [k, v] of Object.entries(d.dist || {})) {
      const n = Number(v) || 0;
      if (n > best || (n === best && Number(k) > modeLv)) {
        best = n;
        modeLv = Number(k);
      }
    }
    return {
      label: t.label,
      dist: d.dist,
      mine: myLv != null ? myLv : null,
      mode: modeLv,
      min: 1,
      max: t.key === 5 ? 7 : 16,
    };
  }).filter(Boolean);
}
