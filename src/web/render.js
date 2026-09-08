// src/web/render.js —— 渲染调度：全局悬浮提示 + 主视图分发
// 「我的角色」汇总渲染与拖拽排序在 myChars.js；资料视图各库归 wiki.js（总览子面板 metaOverview.js）、驱动盘工作台 discstats.js、模拟 simulate.js。
import { grid, myCharacters, userConfig, isStatic, sortRoleNames, saveUserConfig } from './data.js';
import { VIEWS, VIEW_VALUES } from '../lib/constants.js';
import { renderWiki, toggleWikiSort } from './wiki.js';
import { renderDrivenDiscs } from './discstats.js';
import { renderSimulate } from './simulate.js';
import { refreshDirState, pruneDpCharts } from './discProb.js';
import { pruneDetachedCharts, mountCharts, clearCharts } from './charts.js';
import { clampTip } from './shared.js';
import { myCharsShell, renderTable, toggleTableSort, setMyCharsRerender } from './myChars.js';

// ---------- 悬浮提示 ----------
const tipEl = document.createElement('div');
tipEl.className = 'tip';
document.body.appendChild(tipEl);
let tipPinned = false; // 触屏/点击固定模式：不随鼠标移动
let tipAnchor = null; // 当前显示的 data-detail 元素
/** 统一显示：写入内容 + 滚动归顶（共享元素复用，二次打开应从顶部开始）+ 显示 */
function showTip(html) {
  tipEl.innerHTML = html;
  tipEl.scrollTop = 0;
  tipEl.style.display = 'block';
}
function positionTip(x, y) {
  const r = tipEl.getBoundingClientRect();
  if (x + r.width > innerWidth) x -= r.width + 24;
  if (y + r.height > innerHeight) y -= r.height + 24;
  // 钳制到视口内：旧版只翻转右/下溢出，超高翻转后顶部出屏且不可达（悬浮框超高滚动改造 2026-08）
  [x, y] = clampTip(x, y, r.width, r.height, innerWidth, innerHeight, 8);
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
}
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest ? e.target.closest('[data-detail]') : null;
  if (t) {
    showTip(t.dataset.detail);
    tipPinned = false; // hover 显示 → 跟随鼠标
    tipAnchor = t;
  }
});
document.addEventListener('mousemove', (e) => {
  if (tipEl.style.display === 'none' || tipPinned) return;
  // 指针进入悬浮框：暂停跟随（否则悬浮框追着鼠标抖，滚轮也滚不到内容）
  if (e.target.closest && e.target.closest('.tip')) return;
  positionTip(e.clientX + 14, e.clientY + 14);
});
document.addEventListener('mouseout', (e) => {
  if (tipPinned) return;
  // 关闭条件 = 离开「触发元素 ∪ 悬浮框」组合且未进入另一触发元素/悬浮框。
  // 悬浮框可交互后移进它滚动内容不能关；旧版只认 [data-detail] 会让「移进悬浮框」即关。
  const from = e.target.closest ? e.target.closest('[data-detail], .tip') : null;
  const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-detail], .tip') : null;
  if (from && !to) hideTip();
});
// 触屏/点击：点 data-detail 切换显示（固定在元素下方，不随鼠标），点空白隐藏
document.addEventListener('click', (e) => {
  // 说明按钮（data-hint，统计图表标题右方的「?」）：点击弹出/收起详细说明（固定显示，不走 hover）
  const h = e.target.closest ? e.target.closest('[data-hint]') : null;
  if (h) {
    if (tipAnchor === h && tipEl.style.display !== 'none') {
      hideTip();
    } else {
      showTip(h.dataset.hint);
      tipPinned = true;
      tipAnchor = h;
      const r = h.getBoundingClientRect();
      positionTip(r.left, r.bottom + 6);
    }
    return;
  }
  const t = e.target.closest ? e.target.closest('[data-detail]') : null;
  if (t) {
    if (tipAnchor === t && tipEl.style.display !== 'none') {
      hideTip();
    } else {
      showTip(t.dataset.detail);
      tipPinned = true;
      tipAnchor = t;
      const r = t.getBoundingClientRect();
      positionTip(r.left, r.bottom + 6);
    }
  } else if (!e.target.closest || !e.target.closest('.tip')) {
    hideTip();
  }
});
/** 强制隐藏悬浮框：render() 整块替换 innerHTML 时元素被直接移除，不再派发 mouseout，提示框会残留 */
function hideTip() {
  tipEl.style.display = 'none';
  tipPinned = false;
  tipAnchor = null;
}

// ---------- 表头点击排序（wiki/汇总表格共用，经 data-sort 委托） ----------
grid.addEventListener('click', (e) => {
  const th = e.target.closest ? e.target.closest('th[data-sort]') : null;
  if (!th) return;
  const key = th.dataset.sort;
  if (th.closest('.wiki-table')) toggleWikiSort(key);
  else if (th.closest('table.tbl')) toggleTableSort(key);
  else return;
  render();
});

/** 主视图解析：URL/配置中的 view 值；非法值（含已迁移的旧值）回退 mychars */
function resolveView() {
  const raw = new URLSearchParams(location.search).get('view') || userConfig.view || VIEWS.ROLES;
  return { view: VIEW_VALUES.has(raw) ? raw : VIEWS.ROLES };
}

// ---------- 渲染调度 ----------
/** 二级 tab 栏高度写入 --tabs-h：表格吸顶表头需让开「header + 二级 tab」两层高度（tab 栏随 body 滚动吸顶） */
function measureTabs() {
  const tabs = grid.querySelector('.wiki-tabs');
  document.documentElement.style.setProperty('--tabs-h', (tabs ? tabs.offsetHeight : 0) + 'px');
}
export function render() {
  const { view } = resolveView();
  hideTip();
  // 当前视图用 .on 表达（视觉）；aria-current 让读屏/无 class 快照知道选中项
  document.querySelectorAll('.view-tab').forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle('on', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  grid.innerHTML = '';
  // 统一回收旧图表容器：覆盖所有提前 return 的分支（切数据库/我的角色不走 mountCharts，只靠它清理会漏图）
  pruneDetachedCharts();
  // dp 旁路图（驱动盘提升模拟）单独回收：不进 charts 主注册表，切走模拟视图须在此 dispose，否则实例驻留整个会话
  pruneDpCharts();
  // 统一清空 pending 图表注册：渲染期各视图 registerChart，分发后由所在分支 mountCharts 挂载。
  // 清空上移到 render() 后，同一渲染流程里先清后注册的时序对任何宿主（wiki 总览 / 我的角色）都成立。
  clearCharts();
  settleReveal();
  if (view === VIEWS.SIMULATE) {
    // 模拟视图：驱动盘提升模拟的 dpCalc 旁路自挂图；frontier 含 3D 图
    grid.innerHTML = renderSimulate();
    measureTabs();
    // 定向副词条门控需 DOM 就位后主动刷一次：refreshDirState 只在 dpDirChange（onchange）里被调，整块重建后不会触发，
    // 否则初次渲染「定向副词条」全部可选，与「需先定向主词条」的提示矛盾。
    for (const sel of grid.querySelectorAll('.dp-dir-main')) refreshDirState(Number(sel.dataset.pos));
    // 先让浏览器完成首帧绘制，再挂载图表，避免图表初始化阻塞面板加载。
    setTimeout(() => mountCharts(), 0);
    return;
  }
  if (view === VIEWS.WIKI) {
    grid.innerHTML = renderWiki();
    measureTabs();
    mountCharts();
    return;
  }
  if (view === VIEWS.DISC) {
    grid.innerHTML = renderDrivenDiscs();
    measureTabs();
    mountCharts();
    return;
  }
  // 「角色」视图：已拥有角色置顶（Character 实例，可拖/排序）+ 未拥有角色灰显
  const ownedSet = new Set(myCharacters.map((c) => c.name));
  const showUnowned = userConfig.showAll !== false; // 默认全显（含未拥有灰行）
  const unowned = showUnowned ? sortRoleNames(null).filter((n) => !ownedSet.has(n)) : [];
  // 完全无账号数据（公开站首访/从未导入）：整页全灰 + 顶部引导
  let banner = '';
  if (!myCharacters.length) {
    banner = `<div class="empty">${
      isStatic()
        ? '这是全部角色（灰 = 未拥有）。导入你的账号角色后可看个人练度：右上角 <b>「同步数据」→ 数据导入</b>（数据只存本浏览器）。'
        : '这是全部角色（灰 = 未拥有）。更新你的账号角色后可看个人练度：右上角 <b>更新我的角色</b>。'
    }</div>`;
  }
  const tools = `<div class="roles-tools"><label class="roles-show-unowned"><input type="checkbox" id="roles-show-unowned"${showUnowned ? ' checked' : ''} /> 显示未拥有（灰）</label></div>`;
  grid.innerHTML = myCharsShell(banner + tools);
  measureTabs(); // 无二级 tab 栏 → --tabs-h 置 0，汇总表吸顶只让开 header
  const body = grid.querySelector('.mychars-body');
  body.className = 'mychars-body';
  renderTable(myCharacters, body, { unowned });
  const t = body.querySelector('#roles-show-unowned');
  if (t) {
    t.addEventListener('change', () => {
      userConfig.showAll = t.checked;
      saveUserConfig();
      render();
    });
  }
  mountCharts(); // 汇总表：展开的手风琴行可能注册了技能分布图（render 开头已 prune+clear 旧图）
}

// 首屏错峰只播一次：首次渲染 500ms（动画播完）后装 .settled，此后视图重渲染不再逐卡入场
let _settled = false;
function settleReveal() {
  if (_settled) return;
  _settled = true;
  setTimeout(() => grid.classList.add('settled'), 500);
}

// 拖拽排序后的重渲染由 myChars.js 反向注入（myChars 不 import 本模块，避免循环依赖）
setMyCharsRerender(render);
