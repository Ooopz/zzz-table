// src/web/shared.js —— 浏览器端共享渲染辅助（纯 HTML 字符串，无数据层/DOM 依赖）：收敛四处重复的驱动盘套装悬浮、富文本条目、技能图标。
import { escapeHtml } from '../lib/util.js';
import { richWeb } from './visual.js';

/** 统一空态：msg 为说明、hint 为操作提示/按钮（可选） */
export function emptyState(msg, hint = '') {
  return `<div class="empty">${msg}${hint ? `<br>${hint}` : ''}</div>`;
}

/** 悬浮框视口钳制（render.js positionTip 在现有翻转后调用）：把左上角钳进 [gap, 视口尺寸-尺寸-gap]。
 *  防超高/超宽或指针贴近顶/左缘时内容出屏——旧版只翻转右/下溢出，超高翻转后顶部不可达。
 *  纯函数，单测直接断言；gap 默认 8px，与 .tip max-height 的 calc(100vh - 16px) 边距同值。 */
export function clampTip(x, y, w, h, vw, vh, gap = 8) {
  const minX = gap;
  const minY = gap;
  const maxX = Math.max(minX, vw - w - gap);
  const maxY = Math.max(minY, vh - h - gap);
  return [Math.min(Math.max(x, minX), maxX), Math.min(Math.max(y, minY), maxY)];
}

/** 驱动盘 2/4 件套效果 HTML（表格/驱动盘视图悬浮共用）；颜色走语义类（CSS 定义，非内联） */
export function discSetEffectsHtml(discLib) {
  return (
    (discLib?.set2Text ? `<br><span class="disc-set-2">【2件套】${richWeb(discLib.set2Text)}</span>` : '') +
    (discLib?.set4Text ? `<br><span class="disc-set-4">【4件套】${richWeb(discLib.set4Text)}</span>` : '')
  );
}

/** 富文本条目：标题加粗 + 富文本描述（技能/影画/觉醒悬浮共用）。
 *  字段名差异（name/desc 与 title/text）由调用方归一化后传入。 */
/** 副词条命中次数标记：'>' 重复 roll 次（统一视觉口径，替代旧 ×N 写法；roll = 1 + 强化次数）。
 *  全项目唯一实现——表格悬浮/手风琴盘卡/盘体检悬浮都走这里。 */
export function substatRollsMark(growthCount) {
  return '>'.repeat(1 + (growthCount || 0));
}

export function richItemHtml(title, desc) {
  return `<b>${escapeHtml(title)}</b>${desc ? `<br>${richWeb(desc)}` : ''}`;
}

// ---------- 技能图标（数字 type 与字符串键共用同一路径表） ----------
const SKILL_ICON = {
  normal: '/assets/img/skill-normal.png',
  dodge: '/assets/img/skill-dodge.png',
  support: '/assets/img/skill-support.png',
  special: '/assets/img/skill-special.png',
  ultimate: '/assets/img/skill-ultimate.png',
  core: '/assets/img/skill-passive.png',
};
export function skillIcon(key) {
  return SKILL_ICON[key] || SKILL_ICON.core;
}

// ---------- 属性/职业/稀有度 图标（中文字段值 → assets/img 英文名；未知值回退文字） ----------
const META_ICON = {
  电: '/assets/img/element-electric.png',
  冰: '/assets/img/element-ice.png',
  火: '/assets/img/element-fire.png',
  物理: '/assets/img/element-physical.png',
  风: '/assets/img/element-wind.png',
  以太: '/assets/img/element-ether.png',
  流明: '/assets/img/element-lumiflux.png',
  凛刃: '/assets/img/element-frostblade.png',
  玄墨: '/assets/img/element-ink.png',
  烈霜: '/assets/img/element-rime.png',
  锋御: '/assets/img/trait-vanguard.png',
  强攻: '/assets/img/trait-attack.png',
  击破: '/assets/img/trait-stun.png',
  支援: '/assets/img/trait-support.png',
  防护: '/assets/img/trait-defense.png',
  异常: '/assets/img/trait-anomaly.png',
  命破: '/assets/img/trait-pierce.png',
};
const RANK_ICON = { S: '/assets/img/rank-S.png', A: '/assets/img/rank-A.png' };
/** 属性/职业值 → 小图标 <img>（悬浮 data-detail 显中文名）；无图标/空值返回 ''，调用方回退文字 */
export function metaIconHtml(value) {
  const src = META_ICON[value];
  if (!src) return '';
  const esc = escapeHtml(value);
  return `<img class="meta-ico" src="${src}" alt="${esc}" title="${esc}" data-detail="${esc}">`;
}
/** 稀有度（S/A）→ 小图标；B 及未知返回 '' */
export function rankIconHtml(rank) {
  const src = RANK_ICON[rank];
  if (!src) return '';
  return `<img class="meta-ico" src="${src}" alt="${escapeHtml(rank)}" title="${escapeHtml(rank)}" data-detail="${escapeHtml(rank)}">`;
}
/** 把对象合并进 window.ZZZ（内联 onclick 引用的全局注册，wiki/ui 共用） */
export function registerZZZ(obj) {
  window.ZZZ = window.ZZZ || {};
  Object.assign(window.ZZZ, obj);
}

/** 排序表 HTML（wiki 视图）：表头三态排序标注由 sort 状态对象（createSort 产物）驱动；
 *  cls 为表格类名（wiki-table/rec-table），className 追加额外类。 */
export function tableHtml(
  headers,
  rows,
  sortable = new Set(),
  { cls = 'wiki-table', sort = null, className = '' } = {}
) {
  const head = headers
    .map((h) => {
      if (!sortable.has(h)) return `<th>${h}</th>`;
      const on = sort ? sort.key === h : false;
      return `<th data-sort="${h}"${on ? ' class="sorted"' : ''}>${h}${on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
    })
    .join('');
  return `<div class="wiki-wrap"><table class="${cls}${className ? ' ' + className : ''}"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
