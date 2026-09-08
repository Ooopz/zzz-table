// src/web/ui.js —— 交互层：目标/有效/备注/技能弹窗、事件绑定、初始化（URL 状态见 urlState.js，同步中心见 sync.js）
import { escapeHtml, escapeJsAttr, formatValue } from '../lib/util.js';
import { createSort } from '../lib/sort.js';
import { registerZZZ } from './shared.js';
// (弹窗勾选现为副词条粒度，无需 percentSubstats)
import {
  TARGET_KEYS,
  MAIN_STAT_OPTIONS,
  SUBSTAT_TYPE_SET,
  mainStatName,
  VIEWS,
  EFFECTIVE_SUBSTAT_OPTIONS,
} from '../lib/constants.js';
import { notify } from './api.js';
import {
  readCharTarget,
  saveCharTarget,
  readValidStats,
  readNote,
  saveNote,
  userConfig,
  saveUserConfig,
  loadUserConfig,
  plansByName,
  library,
} from './data.js';
import { render } from './render.js';
import { toggleGoalAccRow, syncGoalAccRowInDom, expandedChar } from './myChars.js';
import { setWikiTab } from './wiki.js';
import { setSelectedDisc, setDiscRerender } from './discstats.js';
import { goalChar, setGoalChar, setPanelDistScope as setPdScope, setScatterPair } from './goalView.js';
import { setSimRerender, setSimTab, simSelect, simAxis, simAddChart, simRemoveChart } from './simulate.js';
import { setDpRerender, setDpRole } from './discProb.js';
import { migrateViewState, syncUrl, applyUrlState } from './urlState.js';
import { initSync } from './sync.js';

// ---------- 目标设置弹窗 ----------
let currentTargetChar = null;

/** 填充「推荐音擎」下拉：候选仅限属性库（wiki）中的音擎 */
function fillWengineSelect() {
  const sel = document.getElementById('targetWengine');
  const names = Object.keys(library.wengines || {}).sort((a, b) => a.localeCompare(b, 'zh'));
  sel.innerHTML =
    '<option value="">—</option>' +
    names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}
function fillMainSelect(slot) {
  const sel = document.getElementById('targetMain' + slot);
  sel.innerHTML =
    '<option value="">—</option>' +
    MAIN_STAT_OPTIONS[slot].map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}

function openTargetSettings(name) {
  if (currentTargetChar !== name) planSort.reset(); // 切换角色时重置方案排序
  currentTargetChar = name;
  const target = readCharTarget(name);
  document.getElementById('targetChar').textContent = name || '';
  // 目标数值网格已删（编辑入口 = 汇总表属性列「目标 N」子行）；本弹窗只管 低频配置
  fillWengineSelect();
  for (const slot of [4, 5, 6]) fillMainSelect(slot);
  document.getElementById('targetWengine').value = target[TARGET_KEYS.WENGINE] || '';
  document.getElementById('targetMain4').value = target[TARGET_KEYS.MAIN4] || '';
  document.getElementById('targetMain5').value = target[TARGET_KEYS.MAIN5] || '';
  document.getElementById('targetMain6').value = target[TARGET_KEYS.MAIN6] || '';
  // 有效副词条（副词条粒度，攻击/生命/防御 % 与固定分开勾选）；预勾选 = 当前生效集
  // （手动保存 → 游戏推荐 equipPlan 兜底）。命中/概率统一 % 口径，固定值不计命中
  const validSet = new Set(readValidStats(name));
  document.getElementById('effGrid').innerHTML = EFFECTIVE_SUBSTAT_OPTIONS.map(
    (o) =>
      `<label class="chk"><input type="checkbox" data-type="${escapeHtml(o.type)}" ${validSet.has(o.type) ? 'checked' : ''}> ${escapeHtml(o.label)}</label>`
  ).join('');
  renderPlanTable(name);
  document.getElementById('targetModal').classList.add('show');
}
async function saveTargetSettings() {
  if (!currentTargetChar) return;
  // ⚠️ 从现有 targets 合并（不得整体替换）：弹窗只管 音擎/主词条/有效副词条，
  // 属性目标值（应用方案/goalEdit/设定目标 写入的）必须保留——曾用 {} 整体覆盖导致「应用了没生效」
  const target = { ...readCharTarget(currentTargetChar) };
  // 音擎/主词条：空值不覆盖
  const w = document.getElementById('targetWengine').value.trim();
  if (w) target[TARGET_KEYS.WENGINE] = w;
  for (const [id, key] of [
    ['targetMain4', TARGET_KEYS.MAIN4],
    ['targetMain5', TARGET_KEYS.MAIN5],
    ['targetMain6', TARGET_KEYS.MAIN6],
  ]) {
    const v = document.getElementById(id).value.trim();
    if (v) target[key] = v;
  }
  // 有效副词条：副词条粒度勾选（攻击/生命/防御 % 与固定分开）；空勾选 = 显式清空 → 覆盖默认游戏推荐
  target[TARGET_KEYS.VALID_STATS] = [...document.querySelectorAll('#effGrid input:checked')].map(
    (inp) => inp.dataset.type
  );
  // 保存失败时 saveCharTarget 已弹失败提示，这里不要再报「已保存」把它顶掉
  const ok = await saveCharTarget(currentTargetChar, target);
  document.getElementById('targetModal').classList.remove('show');
  render();
  if (ok) notify(`${currentTargetChar} 养成配置已保存`);
}

/** 方案表格排序（三态：升序→降序→恢复默认，走 src/lib/sort.js） */
const planSort = createSort();
function togglePlanSort(key) {
  planSort.toggle(key);
}
/** 排序取值：属性列取 panel.high，发布时间取时间戳，其余按展示文本 */
function planSortValue(p, key) {
  if (key === '方案') return p.name;
  if (key === '发布时间') return Number(p.releasedAt) || 0;
  if (key === '推荐音擎') return p.weapon?.main || '';
  if (key === '二件套')
    return (
      (p.sets || [])
        .filter((s) => s.cnt === 2)
        .map((s) => s.name)
        .join('、') || ''
    );
  if (key === '四件套')
    return (
      (p.sets || [])
        .filter((s) => s.cnt === 4)
        .map((s) => s.name)
        .join('、') || ''
    );
  if (key === '4号位') return p.mainProps?.[4] || '';
  if (key === '5号位') return p.mainProps?.[5] || '';
  if (key === '6号位') return p.mainProps?.[6] || '';
  if (key === '推荐副词条') return (p.subStats || []).join('、') || '';
  const a = (p.panel || []).find((x) => x.name === key);
  return a?.high ?? null;
}

/** 推荐方案表格：动态属性列（方案面板属性并集，取 high 档）+ 音擎/456 主词条/副词条；排序后「应用」仍按原始下标取方案。 */
function renderPlanTable(name) {
  const container = document.getElementById('planTable');
  const entry = plansByName[name];
  if (!entry || !entry.plans?.length) {
    container.innerHTML =
      '<p style="padding:var(--sp-4);color:var(--dim)">暂无推荐方案 —— 可在「同步数据 → 更新推荐方案」后刷新查看</p>';
    return;
  }
  const plansList = entry.plans;
  // 动态列：方案面板属性并集（不同角色/方案属性不同）
  const statNames = [];
  for (const p of plansList) for (const a of p.panel || []) if (!statNames.includes(a.name)) statNames.push(a.name);

  // 排序：空值行恒排最后，不受升降序影响
  const list = planSort.apply(plansList, planSortValue);
  // 方案 → 原始下标映射（「应用」要写回原方案；排序后 indexOf 是 O(n²)）
  const planIndex = new Map(plansList.map((p, i) => [p, i]));

  const heads = [
    '',
    '方案',
    '发布时间',
    ...statNames,
    TARGET_KEYS.WENGINE,
    '二件套',
    '四件套',
    '4号位',
    '5号位',
    '6号位',
    '推荐副词条',
  ];
  const rows = list.map((p) => {
    const statMap = {};
    for (const a of p.panel || []) statMap[a.name] = a;
    // releasedAt 为 Unix 秒
    let released = '—';
    if (p.releasedAt) {
      const d = new Date(Number(p.releasedAt) * 1000);
      if (!Number.isNaN(d.getTime())) {
        const pad = (x) => String(x).padStart(2, '0');
        released = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
    }
    // 二/四件套名（部分方案 2+2 无四件套，可能同名多套）
    const setName = (cnt) =>
      (p.sets || [])
        .filter((s) => s.cnt === cnt)
        .map((s) => s.name)
        .join('、') || '—';
    const cells = [
      `<td><button class="mini apply-btn" onclick="window.ZZZ.applyPlan('${escapeJsAttr(name)}', ${planIndex.get(p)})">应用</button></td>`,
      `<td class="pname" data-detail="${escapeHtml(p.name)}">${escapeHtml(p.name)}</td>`,
      `<td>${released}</td>`,
      ...statNames.map((n) => {
        const a = statMap[n];
        const val = a && a.high != null ? (a.percent ? `${(a.high * 100).toFixed(1)}%` : formatValue(n, a.high)) : '—';
        return `<td>${val}</td>`;
      }),
      `<td>${escapeHtml(p.weapon?.main || '—')}</td>`,
      `<td>${escapeHtml(setName(2))}</td>`,
      `<td>${escapeHtml(setName(4))}</td>`,
      `<td>${escapeHtml(p.mainProps?.[4] || '—')}</td>`,
      `<td>${escapeHtml(p.mainProps?.[5] || '—')}</td>`,
      `<td>${escapeHtml(p.mainProps?.[6] || '—')}</td>`,
      `<td class="subs">${escapeHtml((p.subStats || []).join('、'))}</td>`,
    ];
    return `<tr>${cells.join('')}</tr>`;
  });
  container.innerHTML = `<table class="plantable"><thead><tr>${heads
    .map((h) => {
      if (!h) return '<th></th>'; // 应用列不可排序
      const on = planSort.key === h;
      return `<th data-sort="${escapeHtml(h)}"${on ? ' class="sorted"' : ''}>${escapeHtml(h)}${on ? (planSort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
    })
    .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

async function applyPlan(name, idx) {
  const entry = plansByName[name];
  const p = entry?.plans?.[idx];
  if (!p) return;
  const target = readCharTarget(name);
  for (const a of p.panel || []) {
    if (a.high == null) continue;
    // 百分比属性填整数（60 = 60%），其余填实际数值
    target[a.name] = a.percent ? Math.round(a.high * 100) : a.high;
  }
  if (p.weapon?.main) target[TARGET_KEYS.WENGINE] = p.weapon.main;
  // 456 主词条恒为百分比：mainStatName 兜底把固定值名转百分比（攻击力→攻击力%）
  if (p.mainProps?.[4]) target[TARGET_KEYS.MAIN4] = mainStatName(p.mainProps[4]);
  if (p.mainProps?.[5]) target[TARGET_KEYS.MAIN5] = mainStatName(p.mainProps[5]);
  if (p.mainProps?.[6]) target[TARGET_KEYS.MAIN6] = mainStatName(p.mainProps[6]);
  // 推荐副词条 → 有效副词条（仅保留合法类型）
  if (p.subStats?.length) target[TARGET_KEYS.VALID_STATS] = p.subStats.filter((s) => SUBSTAT_TYPE_SET.has(s));
  const ok = await saveCharTarget(name, target);
  render(); // 汇总表属性列目标子行即时更新（弹窗无目标数值网格，应用后的值在汇总表可见）
  openTargetSettings(name); // 重新渲染弹窗（音擎/主词条/有效副词条）
  if (ok) notify(`${name} 已应用「${p.name}」推荐值`);
}
registerZZZ({ applyPlan });

// 练度规划·目标数值行内编辑（汇总表属性列点击「目标 N」→ 弹窗手改单个属性；name 传角色名，定 goalChar）
let goalEditAttr = null;
function openGoalEdit(name, attr) {
  if (name) setGoalChar(name);
  goalEditAttr = attr;
  document.getElementById('goalEditAttrName').textContent = `${goalChar} · ${attr}`;
  const saved = Number(readCharTarget(goalChar)[attr]);
  document.getElementById('goalEditInput').value = Number.isFinite(saved) && saved > 0 ? saved : '';
  document.getElementById('goalEditModal').classList.add('show');
  document.getElementById('goalEditInput').focus();
}
async function commitGoalEdit(raw) {
  if (!goalEditAttr) return;
  const target = { ...readCharTarget(goalChar) };
  const num = Number(raw);
  if (raw !== '' && raw != null && Number.isFinite(num) && num > 0) target[goalEditAttr] = num;
  else delete target[goalEditAttr];
  await saveCharTarget(goalChar, target);
  goalEditAttr = null;
  document.getElementById('goalEditModal').classList.remove('show');
  render();
}
function saveGoalEdit() {
  commitGoalEdit(document.getElementById('goalEditInput').value);
}

// 备注弹窗（点击头像）
let currentNoteChar = null;
function openNote(name) {
  currentNoteChar = name;
  document.getElementById('noteChar').textContent = name || '';
  document.getElementById('noteInput').value = readNote(name);
  document.getElementById('noteModal').classList.add('show');
}
async function saveNoteModal() {
  if (!currentNoteChar) return;
  const ok = await saveNote(currentNoteChar, document.getElementById('noteInput').value.trim());
  document.getElementById('noteModal').classList.remove('show');
  render();
  if (ok) notify(`${currentNoteChar} 备注已保存`);
}

// 被表格内联 onclick 引用的函数，需挂到全局
window.openNote = openNote;

/** 初始化交互：绑定事件、加载配置（main.js 数据就绪后调用） */
export function initUi() {
  // 视图持久化值一次性迁移（旧书签 ?view=recommend/discstats/card/table），必须先于 applyUrlState
  migrateViewState();
  // 从 URL 恢复子 tab/角色/盘状态（在首次 render 之前）
  applyUrlState();
  // 图片加载失败：有 data-fallback 的先回退到备用地址（本地资源优先、缺图用远程链接），回退仍失败才隐藏破图（error 事件不冒泡，需捕获阶段）
  document.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG') {
        if (t.dataset.fallback && t.src !== t.dataset.fallback) {
          t.src = t.dataset.fallback;
          delete t.dataset.fallback; // 防止回退又失败时死循环
          return;
        }
        t.style.visibility = 'hidden';
      }
    },
    true
  );
  // Esc / 点击遮罩可关闭的弹窗（goalEditModal 行内目标编辑此前漏在两份硬编码列表之外 → 只能点「关闭」按钮；
  // 用单一数组消除两份列表漂移）
  const MODAL_IDS = ['targetModal', 'noteModal', 'helpModal', 'syncModal', 'skillModal', 'importModal', 'goalEditModal'];
  // Esc 关闭当前弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const id of MODAL_IDS) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('show');
    }
  });
  // 点击遮罩（modal 背景，非弹窗内容）关闭——与 Esc 等价的最常见习惯操作
  for (const id of MODAL_IDS) {
    document.getElementById(id).addEventListener('click', (e) => {
      if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
    });
  }
  // ---------- 事件绑定 ----------
  document
    .getElementById('targetClose')
    .addEventListener('click', () => document.getElementById('targetModal').classList.remove('show'));
  document.getElementById('targetSave').addEventListener('click', saveTargetSettings);
  document.getElementById('targetClear').addEventListener('click', async () => {
    if (!currentTargetChar) return;
    const ok = await saveCharTarget(currentTargetChar, {});
    document.getElementById('targetModal').classList.remove('show');
    render();
    if (ok) notify('已清空该角色养成配置');
  });
  document
    .getElementById('noteClose')
    .addEventListener('click', () => document.getElementById('noteModal').classList.remove('show'));
  document.getElementById('noteSave').addEventListener('click', saveNoteModal);
  document.getElementById('noteClear').addEventListener('click', async () => {
    if (!currentNoteChar) return;
    const ok = await saveNote(currentNoteChar, '');
    document.getElementById('noteModal').classList.remove('show');
    render();
    if (ok) notify('已清空该角色备注');
  });
  // 技能每级数值弹窗（wiki 数据库视图技能图标点击打开）
  document
    .getElementById('skillClose')
    .addEventListener('click', () => document.getElementById('skillModal').classList.remove('show'));
  // 目标数值行内编辑弹窗（汇总表属性列「目标 N」子行点击打开）
  document
    .getElementById('goalEditClose')
    .addEventListener('click', () => document.getElementById('goalEditModal').classList.remove('show'));
  document.getElementById('goalEditSave').addEventListener('click', saveGoalEdit);
  document.getElementById('goalEditClear').addEventListener('click', () => commitGoalEdit(''));
  document.getElementById('goalEditInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveGoalEdit();
  });
  // 方案表格表头点击排序（targetModal 不在 grid 内，需单独委托）
  document.getElementById('planTable').addEventListener('click', (e) => {
    const th = e.target.closest ? e.target.closest('th[data-sort]') : null;
    if (!th) return;
    togglePlanSort(th.dataset.sort);
    renderPlanTable(currentTargetChar);
  });
  // 同步中心（initSync 在 sync.js 绑定弹窗与执行）
  initSync();
  // 视图切换：切视图并同步 URL 与配置
  document.querySelectorAll('.view-tab').forEach((b) =>
    b.addEventListener('click', () => {
      userConfig.view = b.dataset.view;
      saveUserConfig();
      syncUrl(b.dataset.view);
      render();
    })
  );
  // 模拟视图重渲染回调（simulate.js 不反向依赖 render.js）
  setSimRerender(render);
  setDpRerender(render); // 驱动盘提升模拟切换角色后重挂面板（加载新角色的权重与当前盘）
  setDiscRerender(render); // 驱动盘清理覆盖编辑后重渲染（自动默认 + 用户修正）

  // 子面板切换与模拟/同步入口（挂到 ZZZ 供渲染层内联引用）
  registerZZZ({
    wikiTab: (key) => {
      setWikiTab(key);
      syncUrl();
      render();
    },
    selectDisc: (name) => {
      setSelectedDisc(name); // 驱动盘清理视图：总览行/下拉 → 选中套装
      syncUrl();
      render();
      // 总览在顶部、清理卡在下方，点击行后滚到清理卡（异步：等图表挂载后布局稳定）
      setTimeout(
        () => document.getElementById('ad-clean-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        30
      );
    },
    goalEdit: openGoalEdit,
    goalConfig: openTargetSettings, // 汇总表角色列「配置」按钮 → 养成配置弹窗（唯一入口）
    setPanelDistScope: (scope) => {
      // 手风琴底部「分布×三档」图属性范围切换：设模块态后就地重渲染手风琴行（复用 toggleGoalAcc 机制）
      setPdScope(scope);
      syncGoalAccRowInDom();
    },
    setScatterPair: (idx, key) => {
      // 底部「配比散点」两图的下拉切属性对：设模块态后就地重渲染手风琴行
      setScatterPair(idx, key);
      syncGoalAccRowInDom();
    },
    toggleGoalAcc: (name) => {
      // 就地插入/移除手风琴行（不触发全量 render——慢且丢滚动位置）；排序/拖拽的全量 render 由 expandedChar 兜底重建
      toggleGoalAccRow(name); // 汇总表「养成」手风琴：唯一实例跟随角色
      syncUrl();
      syncGoalAccRowInDom();
      // 无 render：手动同步「养成」按钮的 on 高亮（单实例，仅当前展开角色亮）。
      // 只挑 .t-goal（养成）按钮——同行的「配置」按钮同为 .mini，全选会让它跟着亮
      document.querySelectorAll('tr[data-char] button.mini.t-goal').forEach((b) => {
        b.classList.toggle('on', b.closest('tr[data-char]')?.dataset.char === name && expandedChar === name);
      });
    },
    simTab: (t) => {
      setSimTab(t); // 模拟视图二级 tab
      syncUrl();
      render();
    },
    jumpSimProb: (name) => {
      // 手风琴「驱动盘提升」→ 模拟视图驱动盘提升模拟 tab，并预选当前角色
      setSimTab('prob');
      setDpRole(name);
      syncUrl(VIEWS.SIMULATE);
      render();
    },
    simSelect,
    simAxis,
    simAddChart,
    simRemoveChart,
  });
  document
    .getElementById('helpBtn')
    .addEventListener('click', () => document.getElementById('helpModal').classList.add('show'));
  document
    .getElementById('helpClose')
    .addEventListener('click', () => document.getElementById('helpModal').classList.remove('show'));

  loadUserConfig().then(() => render());
}
