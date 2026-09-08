// src/web/discstats.js —— 「驱动盘」一级视图（view 值 `discs`）：清理决策工具，纯知识不接个人盘。
// 上半 = 全套装清理速查总览（判定倾向：泛用4件套/仅2件套可用/未来套/冷门，点击跳到清理卡）；
// 下半 = 选中套装的清理决策卡（适配职业标签 + 4件套 适配角色[官方 wiki 推荐 × 实况] + 2件套 填充[实况] +
// 逐槽主词条三级判定[实况保留率≥3%→保留 / 职业规则推荐→视词条 / 其余→分解] + 有效副词条清单 + 证据图）。
// 判定引擎纯逻辑在 lib/discCleaner.js；实况角色名经 wsRoles.alignRoleName 对齐 plans 标准名。
import { library, workshopStats, workshopGrad, readDiscCleanOverrides, saveDiscCleanOverrides } from './data.js';
import { alignRoleName } from './wsRoles.js';
import {
  computeDiscCleanCard,
  computeDiscCleanOverview,
  effectiveMeta,
  ARCHETYPE_MAIN_RULES,
  SUB_TIER_RANK,
} from '../lib/discCleaner.js';
import { STACK, CHART_HEIGHT } from './visual.js';
import { escapeHtml, escapeJsAttr } from '../lib/util.js';
import { discSetEffectsHtml, registerZZZ } from './shared.js';
import { registerChart, chartBox, mainSubCrossOption } from './charts.js';

export let selectedDisc = '';
export function setSelectedDisc(name) {
  selectedDisc = name;
}

// ---------- 覆盖层：自动默认 + 用户修正（覆盖持久化到 user-config.discCleanOverrides） ----------
/** 实时读取当前覆盖（不缓存：编辑后 save 替换引用，重渲染总能拿到最新） */
function ensureOverrides() {
  const o = readDiscCleanOverrides();
  return o || {};
}
let rerender = () => {};
export function setDiscRerender(fn) {
  rerender = fn;
}
/** 保存覆盖并重渲染（ui.js 注入 render） */
function persist() {
  saveDiscCleanOverrides(ensureOverrides());
  rerender();
}
/** 清掉某套装的空字段/空套装，保持覆盖层干净 */
function prune(name) {
  const s = ensureOverrides()[name];
  if (!s) return;
  for (const k of Object.keys(s)) {
    const v = s[k];
    if (
      v == null ||
      (Array.isArray(v) && !v.length) ||
      (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)
    )
      delete s[k];
  }
  if (!Object.keys(s).length) delete ensureOverrides()[name];
}

const TENDENCY_OPTIONS = ['泛用4件套', '角色专属套', '仅2件套可用', '未来套', '冷门'];
const ARCHETYPE_OPTIONS = Object.keys(ARCHETYPE_MAIN_RULES);

/** 当前实况输入（角色穿戴/官方推荐/盘详情），供覆盖编辑重算用 */
function cleanInputs() {
  const { l4, l2 } = liveRoles();
  return { l4, l2, rec: recommendByName() };
}
function currentDetail(name) {
  return (workshopStats.discDetails || []).find((d) => d.name === name) || null;
}
/** 某套装在给定覆盖下的决策卡（无覆盖 = 纯自动） */
function cleanCard(name, ov) {
  const { l4, l2, rec } = cleanInputs();
  return computeDiscCleanCard({
    setName: name,
    discDetail: currentDetail(name),
    recommend: rec[name] || [],
    live4pc: l4,
    live2pc: l2,
    overrides: ov || {},
  });
}

/** 覆盖编辑操作（ZZZ handler 调用；改完 persist + rerender） */
function ovSet(name) {
  const o = ensureOverrides();
  return (o[name] = o[name] || {});
}
function cycleTendency(name) {
  const cur = ovSet(name).tendency;
  const i = cur ? TENDENCY_OPTIONS.indexOf(cur) : -1; // -1 = 自动
  if (i === -1) ovSet(name).tendency = TENDENCY_OPTIONS[0];
  else if (i === TENDENCY_OPTIONS.length - 1) delete ovSet(name).tendency;
  else ovSet(name).tendency = TENDENCY_OPTIONS[i + 1];
  prune(name);
  persist();
}
function cycleUniversal(name) {
  const cur = ovSet(name).universal2pc;
  if (cur === undefined) ovSet(name).universal2pc = true;
  else if (cur === true) ovSet(name).universal2pc = false;
  else delete ovSet(name).universal2pc;
  prune(name);
  persist();
}
/** 判定 chip 循环（保留→视词条→分解→保留）：首次点击以自动判定种子化该槽覆盖 */
function cycleMain(name, slot, main) {
  const setO = ovSet(name);
  setO.mains = setO.mains || {};
  if (!setO.mains[slot]) {
    const auto = cleanCard(name, {}).mains[slot];
    setO.mains[slot] = {
      keep: auto.filter((m) => m.verdict === 'keep').map((m) => m.name),
      cond: auto.filter((m) => m.verdict === 'cond').map((m) => m.name),
    };
  }
  const spec = setO.mains[slot];
  if (spec.keep.includes(main)) {
    spec.keep = spec.keep.filter((m) => m !== main);
    spec.cond = [...spec.cond, main];
  } else if (spec.cond.includes(main)) {
    spec.cond = spec.cond.filter((m) => m !== main);
  } else {
    spec.keep = [...spec.keep, main];
  }
  prune(name);
  persist();
}
function setListField(name, field, list) {
  const setO = ovSet(name);
  if (list && list.length) setO[field] = [...list];
  else delete setO[field];
  prune(name);
  persist();
}
const SUB_TIER_CN = { core: '核心', high: '重要', mid: '一般', low: '无用' };
const SUB_TIER_CLS = {
  core: 'ad-sub-tier-core',
  high: 'ad-sub-tier-high',
  mid: 'ad-sub-tier-mid',
  low: 'ad-sub-tier-low',
};
/** 副词条优先级档循环（自动→核心→重要→一般→无用→自动），持久化到覆盖 subTiers */
function cycleSubTier(name, sub) {
  const setO = ovSet(name);
  setO.subTiers = setO.subTiers || {};
  const cur = setO.subTiers[sub];
  const seq = ['core', 'high', 'mid', 'low'];
  const i = seq.indexOf(cur);
  if (cur === undefined) setO.subTiers[sub] = 'core';
  else if (i >= seq.length - 1)
    delete setO.subTiers[sub]; // low → 回自动
  else setO.subTiers[sub] = seq[i + 1];
  prune(name);
  persist();
}
function resetOverride(name, field) {
  const s = ensureOverrides()[name];
  if (!s) return;
  // 唯一调用方传整字段名（'archetypes' 等）；「mains.xxx」点路径分支从未触发，已删
  if (field in s) delete s[field];
  prune(name);
  persist();
}
function resetAllOverrides() {
  saveDiscCleanOverrides({});
  rerender();
}

// ---- 多值编辑（适配职业 / 有效副词条）：轻量弹层 ----
let listEditorState = null; // {name, field}
function listBox() {
  let box = document.getElementById('discListEditor');
  if (!box) {
    box = document.createElement('div');
    box.id = 'discListEditor';
    box.className = 'disc-list-editor';
    document.body.appendChild(box);
  }
  return box;
}
function openListEditor(name, field) {
  // 仅剩「适配职业」多选编辑（副词条档位已改表格内逐条循环修正）
  const ov = ensureOverrides()[name] || {};
  const options = ARCHETYPE_OPTIONS;
  const current = ov.archetypes || effectiveMeta(name, ov).archetypes;
  listEditorState = { name, field };
  const box = listBox();
  box.innerHTML =
    `<div class="disc-list-editor-head">适配职业 · ${escapeHtml(name)}</div>` +
    `<div class="disc-list-editor-body">${options
      .map(
        (o) =>
          `<label class="chk"><input type="checkbox" data-v="${escapeJsAttr(o)}"${current.includes(o) ? ' checked' : ''}> ${escapeHtml(o)}</label>`
      )
      .join('')}</div>` +
    `<div class="disc-list-editor-foot">` +
    `<button class="mini" onclick="ZZZ.discSaveList()">保存</button>` +
    `<button class="mini" onclick="ZZZ.discCloseList()">取消</button>` +
    `<button class="mini" onclick="ZZZ.discResetOverride('${escapeJsAttr(name)}', '${field}'); ZZZ.discCloseList()">重置</button>` +
    `</div>`;
  box.classList.add('show');
}
function saveList() {
  const { name, field } = listEditorState || {};
  if (!name || !field) return;
  const checked = [...document.querySelectorAll('#discListEditor input:checked')].map((i) => i.dataset.v);
  setListField(name, field, checked);
  listEditorState = null;
  const box = document.getElementById('discListEditor');
  if (box) box.classList.remove('show');
}
function closeList() {
  listEditorState = null;
  const box = document.getElementById('discListEditor');
  if (box) box.classList.remove('show');
}

registerZZZ({
  discCycleTendency: (name) => cycleTendency(name),
  discCycleUniversal: (name) => cycleUniversal(name),
  discCycleMain: (name, slot, main) => cycleMain(name, slot, main),
  discCycleSubTier: (name, sub) => cycleSubTier(name, sub),
  discOpenList: (name, field) => openListEditor(name, field),
  discSaveList: () => saveList(),
  discCloseList: () => closeList(),
  discResetOverride: (name, field) => resetOverride(name, field),
  discResetAllOverrides: () => resetAllOverrides(),
});

const VERDICT_CN = { keep: '保留', cond: '视词条', drop: '分解' };
const pct = (v) => Math.round((v || 0) * 100);

/** 实况 4件套/2件套 使用者：workshopGrad.roles[].relics 组合按 num 拆分 → Map<套装, Set<对齐后角色名>> */
function liveRoles() {
  const l4 = new Map();
  const l2 = new Map();
  const add = (m, set, char) => {
    if (!m.has(set)) m.set(set, new Set());
    m.get(set).add(char);
  };
  for (const role of workshopGrad.roles || []) {
    const cname = alignRoleName(role.name);
    for (const relic of role.relics || []) {
      for (const s of relic.sets || []) {
        if (s.num === 4) add(l4, s.name, cname);
        else if (s.num === 2) add(l2, s.name, cname);
      }
    }
  }
  return { l4, l2 };
}

/** 官方 wiki 推荐角色：library.discs[].recommend → Map<套装, 原始名[]> */
function recommendByName() {
  const map = {};
  for (const [name, d] of Object.entries(library.discs || {})) {
    map[name] = (d.recommend || []).map((r) => r.name);
  }
  return map;
}

/** 缺数据守卫：驱动盘清理判定需要 属性库 + 工坊实况（grad 角色穿戴 + discDetails 主词条占比） */
function missing() {
  const miss = [];
  if (!Object.keys(library.discs || {}).length) miss.push('驱动盘属性库');
  if (!(workshopStats.discDetails || []).length) miss.push('工坊实况');
  return miss;
}

/** 判定倾向 → 徽章类（总览速查 + 清理决策卡共用一份；曾写两份同键 map，改漏一侧样式漂移） */
const TEND_CLS = {
  泛用4件套: 'ad-tend-high',
  角色专属套: 'ad-tend-exclusive',
  仅2件套可用: 'ad-tend-two',
  未来套: 'ad-tend-future',
  冷门: 'ad-tend-cold',
};

/** 判定倾向徽章（overview / 卡片头部共用） */
function tendTag(tendency) {
  return `<span class="ad-tag ${TEND_CLS[tendency] || 'ad-tend-cold'}">${tendency}</span>`;
}
/** 泛用2件套徽章：与判定倾向并排。show = 有效 universal2pc 且（有散件用户 或 用户显式覆盖为是） */
function universalTag(show) {
  return show ? `<span class="ad-tag ad-tend-universal">泛用2件套</span>` : '';
}

function chip(name, both) {
  return `<span class="ad-chip${both ? ' both' : ''}">${escapeHtml(name)}</span>`;
}
function chips(list, bothSet) {
  if (!list.length) return '<span class="ds-dim">—</span>';
  return list.map((n) => chip(n, bothSet.has(n))).join('');
}

/** ① 适配角色：4件套 官方×实况（金色=双口径一致）；2件套 仅实况 + 泛用说明 */
function rolesHtml(card) {
  const { official4, live4, both4, live2 } = card.roles;
  const b4 = new Set(both4);
  const u2 =
    card.meta.universal2pc && live2.length >= 1
      ? `<span class="ad-note">泛用二件套 — ${card.meta.rule.join('·')} 类角色都可当散件</span>`
      : '';
  return `<div class="ad-sec">
    <h4>适配角色</h4>
    <div class="ad-row"><span class="ad-row-label">4件套 · 官方推荐</span><span class="ad-chips">${chips(official4, b4)}</span></div>
    <div class="ad-row"><span class="ad-row-label">4件套 · 实际使用</span><span class="ad-chips">${chips(live4, b4)}</span></div>
    <div class="ad-row"><span class="ad-row-label">2件套 · 散件</span><span class="ad-chips">${chips(live2, new Set())}</span>${u2}</div>
  </div>`;
}

/** 单槽主词条占比：一根横向堆叠条（每主词条一段色块，宽度=占比）；色板用 visual.js 的 STACK */
/** 一根横向堆叠条：items = [{name, pct}]，每项一段色块（宽度=占比） */
function stackHtml(items) {
  const segs = items
    .filter((x) => x.pct > 0.05)
    .map(
      (x, i) =>
        `<div class="ad-main-seg" style="width:${x.pct.toFixed(1)}%;background:${STACK[i % STACK.length]}" data-detail="${escapeHtml(x.name)} ${x.pct.toFixed(1)}%"></div>`
    )
    .join('');
  if (!segs) return '';
  return `<div class="ad-main-stack">${segs}</div>`;
}
/** 单槽主词条占比：一根横向堆叠条（每主词条一段色块，宽度=占比） */
function mainStackHtml(detail, slot) {
  const denom = detail?.mainDenom?.[slot] || 1;
  const mains = (detail?.main456?.[slot] || [])
    .map((f) => ({ name: f.name, pct: (f.count / denom) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  return stackHtml(mains);
}
/** 副词条出现频率：一根横向堆叠条（每副词条一段色块，宽度=该词条出现次数占比） */
function subStackHtml(detail) {
  const subs = detail?.subs || [];
  const total = subs.reduce((s, f) => s + (f.count || 0), 0);
  if (!total) return '';
  const items = subs.map((f) => ({ name: f.name, pct: ((f.count || 0) / total) * 100 })).sort((a, b) => b.pct - a.pct);
  return stackHtml(items);
}

/** ② 逐槽判定表：每槽 主词条占比条 + 主词条 | 判定 | 实况保留率 | 理由；判定 chip 点击循环（保留→视词条→分解） */
function slotTable(card, slot, detail) {
  const name = card.name;
  const items = card.mains[slot];
  const rows = items
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.name)}</td><td><span class="ad-tag ad-${m.verdict === 'keep' ? 'keep' : m.verdict === 'cond' ? 'cond' : 'drop'} ov-click" data-detail="点击循环：保留→视词条→分解" onclick="ZZZ.discCycleMain('${escapeJsAttr(name)}', ${slot}, '${escapeJsAttr(m.name)}')">${VERDICT_CN[m.verdict]}</span></td><td class="ds-dim">${pct(m.ratio)}%</td><td class="ad-reason">${escapeHtml(m.reason)}</td></tr>`
    )
    .join('');
  return `<div class="ad-slot">
    <h4>${slot} 号位</h4>
    <div class="ad-slot-mainbar">${mainStackHtml(detail, slot)}</div>
    <table class="rec-table ad-verdict-table"><thead><tr><th>主词条</th><th>判定</th><th data-detail="玩家实际穿戴中带此主词条的盘占该槽位的比例">实际占比</th><th>理由</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

/** ③ 副词条筛选：表格（优先级档 + 实况占比 + 搭配率），档位点击循环修正；阈值只提示不判盘 */
function subsHtml(card, detail) {
  const name = card.name;
  // 实况占比：该套装全部盘里带此副词条的比例（discDetails.subs）
  const equips = detail?.equips || 0;
  const subRatio = new Map((detail?.subs || []).map((s) => [s.name, equips ? (s.count || 0) / equips : 0]));
  // 搭配率：代表主词条 = 4号位玩家保留最多的主词条；条件频率 = 那批盘上带此副词条的比例（mainSubCross）
  const mains4 = detail?.main456?.[4] || [];
  const repMain = mains4.length ? mains4.reduce((a, b) => (a.count >= b.count ? a : b)) : null;
  const repCount = repMain?.count || 0;
  const cross = (repMain && detail?.mainSubCross?.[4]?.[repMain.name]) || {};
  const crossRatio = (sub) => (repCount ? (cross[sub] || 0) / repCount : null);
  const repLabel = repMain ? escapeHtml(repMain.name) : '';
  const rows = card.subTiers
    .map((st) => {
      const ratio = subRatio.get(st.name) || 0;
      const cr = crossRatio(st.name);
      return {
        rank: SUB_TIER_RANK[st.tier],
        ratio,
        html:
          `<tr><td>${escapeHtml(st.name)}</td>` +
          `<td><span class="ad-sub-tier ${SUB_TIER_CLS[st.tier]} ov-click" data-detail="点击循环优先级：核心→重要→一般→无用" onclick="ZZZ.discCycleSubTier('${escapeJsAttr(name)}', '${escapeJsAttr(st.name)}')">${SUB_TIER_CN[st.tier]}</span></td>` +
          `<td class="ds-dim">${pct(ratio)}%</td>` +
          `<td class="ds-dim">${cr == null ? '—' : pct(cr) + '%'}</td></tr>`,
      };
    })
    .sort((a, b) => a.rank - b.rank || b.ratio - a.ratio)
    .map((r) => r.html)
    .join('');
  return `<div class="ad-sec">
    <h4>副词条筛选 · 有效 ≥${card.subThreshold} 条才值得留（点击优先级可修正）</h4>
    <div class="ad-slot-mainbar">${subStackHtml(detail)}</div>
    <div class="ad-sub">优先级按该套适配职业合成（核心/重要/一般/无用）；实况占比 = 玩家实际穿戴带此词条的盘占比；搭配率 = 4号位 ${repLabel} 盘上带此词条的比例。只给参考，由你按优先级+实况决定留不留。</div>
    <table class="rec-table ad-sub-table">
      <thead><tr><th>副词条</th><th>优先级</th><th>实况占比</th><th>搭配率（4号位 ${repLabel} 盘上）</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** 主词条 × 副词条协同热图（玩家实况），置于主词条筛选与副词条筛选之间，无外壳包装 */
function crossChartHtml(detail) {
  if (!detail) return '';
  const crossOpt = mainSubCrossOption(detail);
  if (!Object.keys(crossOpt).length) return '';
  const id = `disc-chart-${detail.name}`;
  registerChart(`${id}-cross`, crossOpt);
  const crossTip = `<b>主词条 × 副词条协同</b><br><span style="color:var(--dim)">每槽（4/5/6 号位）一图：行=该槽主词条、列=副词条，色 = 条件频率（该主词条盘中带此副词条的占比）——用于核对「保留清单」里主词条该配哪些副词条</span>`;
  return `<div class="chart-card" style="grid-column:1/-1"><h3>主词条 × 副词条协同 <button class="chart-hint" data-hint="${escapeHtml(crossTip)}">?</button></h3>${chartBox(`${id}-cross`, CHART_HEIGHT.cross)}</div>`;
}

/** 选中套装的清理决策卡（可点修正：判定倾向/泛用标记循环、适配职业/副词条弹层编辑、判定 chip 循环） */
function cleanCardHtml(card, detail) {
  const meta = card.meta;
  const name = card.name;
  const ov = ensureOverrides()[name] || {};
  const labelChips = card.labels.map((l) => chip(l, false)).join('');
  const lib = library.discs?.[name];
  const sets = lib ? discSetEffectsHtml(lib) : '';
  const tips =
    '<b>逐槽判定口径</b><br><span style="color:var(--dim)">主词条：<b>保留</b> = 玩家实际保留占比 ≥3%；<b>视词条而定</b> = 实际使用少但职业规则推荐（泛用二件套/未来套/次选），词条好才留；<b>分解</b> = 实际使用极少且无职业规则支持。<br>副词条：有效词条 ≥N 条才值得留（按该套适配职业的规则表；强攻/命破 更苛刻）。1/2/3 号位主词条固定，只看副词条。<br><b>点击任意判定/徽章可修正</b>（覆盖持久化，金色圆点 = 已手工调整）。</span>';
  const futNote = meta.future
    ? `<span class="ad-note">未来「${meta.archetypes.join('·')}」职业专属（当前无角色），词条好可留，避免批量分解。</span>`
    : '';
  const tendBadge = `<span class="ad-tag ${TEND_CLS[card.tendency] || 'ad-tend-cold'} ov-click" onclick="ZZZ.discCycleTendency('${escapeJsAttr(name)}')" data-detail="点击循环判定倾向（自动→五档）">${card.tendency}</span>`;
  const showUni = meta.universal2pc && (card.roles.live2.length >= 1 || ov.universal2pc === true);
  const uniBadge = showUni
    ? `<span class="ad-tag ad-tend-universal ov-click" onclick="ZZZ.discCycleUniversal('${escapeJsAttr(name)}')" data-detail="点击切换泛用2件套（自动→是→否）">泛用2件套</span>`
    : '';
  const resetAll =
    Object.keys(ensureOverrides()).length > 0
      ? `<button class="mini ov-reset-all" onclick="ZZZ.discResetAllOverrides()" data-detail="清空全部手工调整，恢复自动分类">全部重置</button>`
      : '';
  const arcSec = `<div class="ad-sec">
    <h4>适配职业</h4>
    <div class="ad-row"><span class="ad-chips ov-click" onclick="ZZZ.discOpenList('${escapeJsAttr(name)}', 'archetypes')" data-detail="点击编辑适配职业">${labelChips || '<span class="ds-dim">—</span>'}</span></div>
  </div>`;
  return `<div class="ad-card" id="ad-clean-card">
    <h3>${escapeHtml(name)} · 清理决策卡 ${tendBadge}${uniBadge}${resetAll}${card.equips ? `<span class="ad-sub">统计 ${card.equips.toLocaleString()} 块</span>` : ''}</h3>
    ${sets ? `<div class="ad-sub">${sets}</div>` : ''}
    ${futNote}
    ${arcSec}
    ${rolesHtml(card)}
    <div class="ad-sec">
      <h4>主词条筛选 <button class="chart-hint" data-hint="${escapeHtml(tips)}">?</button></h4>
      <div class="ad-sub">1/2/3 号位主词条固定（生命值/攻击力/防御力），只看副词条；4/5/6 号位见下表。</div>
      <div class="ad-slotgrid">${slotTable(card, 4, detail)}${slotTable(card, 5, detail)}${slotTable(card, 6, detail)}</div>
    </div>
    ${crossChartHtml(detail)}
    ${subsHtml(card, detail)}
  </div>`;
}

/** 总览「4件套 适配角色」角色头像：横排小圆头像，宽度足够时全部展示（flex-wrap 兜底换行，不截断）；
 *  fb = true 表示无实况使用、托底官方 wiki 推荐（头像带「官方」小标 + 悬浮注明） */
function avatarHtml(name, fb) {
  const icon = library.characters?.[name]?.icon || '';
  const detail = escapeHtml(fb ? `官方推荐：${name}` : name);
  const fbCls = fb ? ' fb' : '';
  return icon
    ? `<img class="ad-ov-avatar${fbCls}" src="${icon}" data-detail="${detail}" alt="${detail}">`
    : `<span class="ad-ov-avatar ad-ov-avatar-txt${fbCls}" data-detail="${detail}">${escapeHtml(name.slice(0, 1))}</span>`;
}
function users4Html(users, fb) {
  if (!users?.length) return '<span class="ds-dim">—</span>';
  return `<span class="ad-ov-users">${users.map((n) => avatarHtml(n, fb)).join('')}</span>`;
}

/** 套装图标（library 优先，静态版已内联；总览行名左侧用）；缺失返回空串 */
function discIconHtml(name) {
  const d = library.discs?.[name];
  const icon = d?.roundIcon || d?.icon || '';
  return icon ? `<img class="ad-ov-ico" src="${icon}" alt="">` : '';
}

/** 全套装清理速查总览（判定倾向降序，点击行选中套装） */
function overviewHtml(rows) {
  const trs = rows
    .map(
      (r) =>
        `<tr class="ad-ov-row${r.name === selectedDisc ? ' on' : ''}" data-detail="点击查看「${escapeHtml(r.name)}」的清理决策卡" onclick="ZZZ.selectDisc('${escapeJsAttr(r.name)}')">` +
        `<td class="ad-ov-name"><span class="ad-ov-set">${discIconHtml(r.name)}${escapeHtml(r.name)}</span></td>` +
        `<td>${tendTag(r.tendency)}${universalTag(r.showUniversal)}</td>` +
        `<td>${r.labels.map((l) => `<span class="ad-chip ad-chip-arc">${escapeHtml(l)}</span>`).join('') || '<span class="ds-dim">—</span>'}</td>` +
        `<td class="ad-ov-users-cell">${users4Html(r.users4, r.users4Fb)}</td>` +
        `<td class="ds-dim">${r.n2 ? `${r.n2} 人` : '—'}</td>` +
        `</tr>`
    )
    .join('');
  const tip =
    '<b>全套装清理速查</b><br><span style="color:var(--dim)">判定倾向：<b>泛用4件套</b> = 有 ≥2 名玩家实际用 4件套；<b>角色专属套</b> = 4件套实际使用仅 1 名角色（这套是本命角色专属）；<b>仅2件套可用</b> = 无 4件套使用者但二件套泛用/有人当散件；<b>未来套</b> = 当前无角色、为未实装职业预置；<b>冷门</b> = 无 4件套 且无 2件套 价值。点击行查看该套装的清理决策卡（逐槽主词条判定 + 有效副词条清单）。</span>';
  return `<div class="ad-card ad-overview">
    <h3>全套装清理速查 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>
    <div class="coverage-table-wrap"><table class="rec-table ad-overview-table">
      <thead><tr><th>套装</th><th>判定倾向</th><th>4件套适配职业</th><th data-detail="把这套当 4 件套主套穿戴的角色（工坊玩家实况）；无实况使用时托底官方 wiki 推荐（带「官方」标）">4件套 适配角色</th><th data-detail="把这套当 2 件套散件凑效果的角色（工坊玩家实况）——判断这套的泛用填充价值">2件套 散件</th></tr></thead>
      <tbody>${trs}</tbody>
    </table></div>
  </div>`;
}

/** 一级「驱动盘」视图入口：全套装速查 + 选中套装清理决策卡 */
export function renderDrivenDiscs() {
  const miss = missing();
  if (miss.length) {
    return `<div class="empty">暂无${miss.join('、')}数据。<br>${
      miss.includes('工坊实况')
        ? '请在右上角 <b>同步数据 → 更新工坊数据</b>（全量爬取，耗时数小时）后刷新查看。'
        : '请在右上角 <b>同步数据 → 更新数据库</b> 后刷新查看。'
    }</div>`;
  }
  const discNames = Object.keys(library.discs || {});
  const { l4, l2 } = liveRoles();
  const rec = recommendByName();
  const ov = ensureOverrides();
  const rows = computeDiscCleanOverview({ discNames, recommendByName: rec, live4pc: l4, live2pc: l2, overrides: ov });
  if (!rows.length) {
    return '<div class="empty">暂无驱动盘属性库数据。<br>请在右上角 <b>同步数据 → 更新数据库</b> 后刷新查看。</div>';
  }
  if (!selectedDisc || !library.discs[selectedDisc]) {
    selectedDisc = rows[0].name; // 默认首个（泛用4件套在前）
  }
  const detail = (workshopStats.discDetails || []).find((d) => d.name === selectedDisc) || null;
  const card = computeDiscCleanCard({
    setName: selectedDisc,
    discDetail: detail,
    recommend: rec[selectedDisc] || [],
    live4pc: l4,
    live2pc: l2,
    overrides: ov,
  });
  return `<div class="discstats">${overviewHtml(rows)}${cleanCardHtml(card, detail)}</div>`;
}
