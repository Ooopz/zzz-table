// src/web/urlState.js —— 视图状态 URL 持久化（?view=&tab=&role=&disc=，replaceState 不产生历史记录），刷新/分享链接不丢状态。
// 旧值（recommend/discstats/card/table/stats）由 migrateViewState 一次性迁移（simulate 现为合法视图值，不在旧值表），不再保留兼容分支。
// 「我的角色」已无二级 tab（角色诊断 2026-09 删），role 恒为手风琴展开角色。
import { userConfig } from './data.js';
import { VIEWS, VIEW_VALUES, LEGACY_VIEW_MAP } from '../lib/constants.js';
import { wikiTab, setWikiTab } from './wiki.js';
import { expandedChar, setExpandedChar } from './myChars.js';
import { selectedDisc, setSelectedDisc } from './discstats.js';
import { simTab, setSimTab } from './simulate.js';
import { dpRole, setDpRole } from './discProb.js';

/** 各一级视图的合法子 tab 键（URL 恢复时白名单校验）；我的角色无二级 tab */
const URL_TABS = {
  [VIEWS.WIKI]: ['characters', 'wengines', 'discs', 'bangboos', 'overview'],
  [VIEWS.SIMULATE]: ['prob', 'frontier'],
};
// DISC 视图无二级 tab；?disc= 归 DISC 消费（决策卡选中盘）；
// ?role= 按视图门控：mychars → expandedChar（手风琴展开）、simulate+prob → dpRole。

/** 当前视图的子 tab 值（URL 写入用） */
function currentTab(view) {
  if (view === VIEWS.WIKI) return wikiTab;
  if (view === VIEWS.SIMULATE) return simTab;
  return null;
}

/** 旧「统计」视图按 tab 分流迁移：detail/未知 → 我的角色汇总，overview → 资料页总览，discs → 驱动盘视图。
 *  role=/disc= 参数不改写原样保留——消费方恢复时按新视图语义读取。 */
function migrateLegacyStats(p) {
  const tab = p.get('tab');
  if (tab === 'overview') {
    p.set('view', VIEWS.WIKI); // tab=overview 保持不变：资料页第五个 tab 同名
    return;
  }
  p.delete('tab');
  if (tab === 'discs') {
    p.set('view', VIEWS.DISC);
    return;
  }
  // detail / 无 tab / 未知 tab → 「我的角色」汇总（旧统计默认 tab 即 detail；无二级 tab）
  p.set('view', VIEWS.ROLES);
  p.delete('tab');
}

/**
 * URL 里的旧视图值一次性迁移。仅旧书签触发；迁移后 URL 即新值，代码不再保留旧值兼容分支。
 * 历史：2026-11 recommend/discstats/card/table；2026-08 IA 重构 simulate→plan、统计页退役——
 * URL 里的 stats/recommend 走 migrateLegacyStats（view+tab 联合分流）。
 * config 里的旧 view 值**不在此迁移**：本函数在 initUi 里早于 loadUserConfig 执行、读到的还是默认值，
 * 由 data.js normalizeLegacyView 在 loadUserConfig 合入服务器配置后统一归一（stats 落 mychars）。
 */
export function migrateViewState() {
  const p = new URLSearchParams(location.search);
  const urlView = p.get('view');
  if (urlView === 'stats' || urlView === 'recommend') {
    migrateLegacyStats(p);
    history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
  } else if (urlView && LEGACY_VIEW_MAP[urlView]) {
    p.set('view', LEGACY_VIEW_MAP[urlView]);
    history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
  }
}

/** 把当前 视图/子tab/角色/盘 状态写入 URL。每次状态切换后调用。
 *  view 缺省时沿用 URL 已有 view（子 tab 切换场景），否则回退 userConfig.view——避免把 loadUserConfig 之前的默认 mychars 写进 URL。 */
export function syncUrl(view) {
  if (!view) {
    const raw = new URLSearchParams(location.search).get('view') || userConfig.view || VIEWS.ROLES;
    view = VIEW_VALUES.has(raw) ? raw : VIEWS.ROLES;
  }
  const p = new URLSearchParams();
  if (view !== VIEWS.ROLES) p.set('view', view);
  const tab = currentTab(view);
  if (tab) p.set('tab', tab);
  if (view === VIEWS.ROLES && expandedChar) p.set('role', expandedChar);
  if (view === VIEWS.SIMULATE && simTab === 'prob' && dpRole) p.set('role', dpRole);
  if (view === VIEWS.DISC && selectedDisc) p.set('disc', selectedDisc);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

/** 首次渲染前从 URL 恢复 子tab/角色/盘 状态（一级 view 由 render.js 的 resolveView 解析）。 */
export function applyUrlState() {
  const p = new URLSearchParams(location.search);
  const raw = p.get('view') || userConfig.view || VIEWS.ROLES;
  const view = VIEW_VALUES.has(raw) ? raw : VIEWS.ROLES;
  const tab = p.get('tab');
  if (tab && (URL_TABS[view] || []).includes(tab)) {
    if (view === VIEWS.WIKI) setWikiTab(tab);
    else if (view === VIEWS.SIMULATE) setSimTab(tab);
  }
  if (view === VIEWS.ROLES) {
    // 我的角色已无二级 tab：role 恒为手风琴展开角色
    const role = p.get('role');
    if (role) setExpandedChar(role);
  } else if (view === VIEWS.SIMULATE) {
    if (p.get('role')) setDpRole(p.get('role'));
  } else if (view === VIEWS.DISC) {
    if (p.get('disc')) setSelectedDisc(p.get('disc'));
  }
}
