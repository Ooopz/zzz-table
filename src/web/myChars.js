// src/web/myChars.js —— 「我的角色」视图渲染（汇总表、行/列拖拽排序）
// 拖拽后重渲染经 setMyCharsRerender 注入 render()（避免反向依赖 render.js 成环）
import {
  grid,
  library,
  discIndex,
  statEntries,
  readNote,
  readValidStats,
  readCharTarget,
  readColOrder,
  readRowOrder,
  saveRowOrder,
  saveColOrder,
} from './data.js';
import { resolveEntry, CATEGORY } from '../lib/names.js';
import { renderGoalAccordionHtml, charTargetInfo } from './goalView.js';
import {
  rateClass,
  isDamageBonus,
  targetStats,
  targetPercents,
  targetGap,
  resolveStatCurrent,
  percentSubstats,
} from '../lib/calc.js';
import { escapeHtml, escapeJsAttr, formatValue, createSort } from '../lib/util.js';
import { STAT } from '../game/index.js';
import { discSetEffectsHtml, substatRollsMark } from './shared.js';
import { mountCharts } from './charts.js';

// 重渲染回调（拖拽排序后调用；由 render.js 注入 render()）
let rerender = () => {};
export function setMyCharsRerender(fn) {
  rerender = fn;
}

// ---------- 渲染辅助 ----------
/** 音擎展示信息（名称/精炼/图标/基础攻击/副属性/特效） */
function wengineInfo(character, R) {
  const wengine = character.wengine || {};
  const libWengine = R.libWengine;
  const mainStats = statEntries(wengine.mainStats);
  const subStats = statEntries(wengine.subStats);
  return {
    wengine,
    libWengine,
    icon: libWengine?.icon || wengine.icon || '', // library 图优先（静态版已内联，离线可用）；采集远程图兜底
    baseAtk: mainStats.find((t) => t.name === '基础攻击力')?.value ?? libWengine?.baseAtk ?? null,
    subStats: subStats.length ? subStats : statEntries(libWengine?.subStats),
    specialEffect: (wengine.specialEffect || libWengine?.specialEffect || '').replace(/<[^>]*>/g, ''),
  };
}
/** 驱动盘详情数据（表格悬浮用）：库引用、主词条、副词条行、命中数、套装效果 */
function discDetail(d, validSet) {
  const discLib = resolveEntry(CATEGORY.DISC, discIndex, d.set);
  const main =
    statEntries(d.mainStats)
      .map((t) => `${t.name} ${formatValue(t.name, t.value)}`)
      .join('　') || '—';
  const subs = (d.growth || []).map((g) => {
    return {
      content: `${g.name} ${formatValue(g.name, g.value)} <span class="rolls">${substatRollsMark(g.growthCount)}</span>`,
      hit: validSet.has(g.type),
    };
  });
  return { discLib, main, subs, discHits: d.getHitCount(validSet), setEffects: discSetEffectsHtml(discLib) };
}

/** 驱动盘悬浮详情（供表格图标用）：命中 + 主词条 + 副词条(> + 高亮) + 2/4件套 */
function discTooltipFull(d, validSet) {
  const { main, subs, discHits, setEffects } = discDetail(d, validSet);
  const sub = subs.map((s) => (s.hit ? `<span class="hit">${s.content}</span>` : s.content)).join('<br>');
  return (
    `<b>${escapeHtml(d.set)}</b>　槽位${d.slot}${d.level ? ` +${d.level}` : ''}` +
    (discHits != null ? `<br><span style="color:var(--acc)">副词条命中：${discHits}</span>` : '') +
    `<br><span style="color:var(--dim)">主词条</span> ${main}` +
    (sub ? `<br><span style="color:var(--dim)">副词条</span><br>${sub}` : '') +
    setEffects
  );
}

/** 目标副词条缺口悬浮提示（表格「命中」用）。
 *  未配置目标时返回空串（不加悬浮）；已全部达成时提示无需额外副词条。
 *  ⚠️ 本函数返回体最终经 escapeHtml 存入 data-detail 属性，浏览器读 .dataset 时解码一次后按 HTML 执行
 *  （render.js showTip → tipEl.innerHTML 汇点）——凡是拼接进来的数据字面片段必须先 escapeHtml（与 charNote 同款约定）。 */
function gapAdviceHtml(character, R) {
  const g = targetGap(character, R);
  if (!g) return '';
  if (!g.items.length) return `<b>${escapeHtml(character.name)}</b><br>目标属性已全部达成，无需额外副词条`;
  const rows = g.items
    .map((it) => {
      const label = escapeHtml(it.type || it.name);
      let count;
      if (it.count != null) {
        count = `约 ${it.count} 个`;
        // 攻击/生命/防御有固定值词条形态，作为备选提示（与百分比词条数量不同时才展示）
        if (it.countFlat != null && it.countFlat !== it.count) count += `（固定值约 ${it.countFlat} 个）`;
      } else {
        count = '副词条不可达成';
      }
      return `<span style="color:var(--acc)">${label}</span> ${count}<br><span style="color:var(--dim)">${formatValue(it.name, it.current)} → ${formatValue(it.name, it.target)}</span>`;
    })
    .join('<br>');
  return `<b>${escapeHtml(character.name)}</b><br>还差 <b>${g.total}</b> 个副词条达成目标<br>${rows}`;
}

/** 缺口列（原副词条命中改造）：毕业状态 + 缺口明细 + 命中总数，免悬浮直接可见。
 *  毕业状态：已毕业 ✓（无缺口）/ 缺口 N（N = 总缺词条数）/ 未设目标；缺口明细逐行「属性 差N条」，
 *  无法靠副词条补足的标「不可补」；悬浮保留完整 current→target 明细。 */
function gapCellHtml(character, R) {
  const hits = character.hitCount(); // % 口径有效命中总数
  const hitSpan = hits != null ? `<span class="gap-hits">命中 ${hits}</span>` : '';
  const g = targetGap(character, R);
  if (!g) return `<td class="thit"><span class="gap-state">未设目标</span></td>`;
  if (!g.items.length) {
    return `<td class="thit"><span class="gap-state good">已毕业 ✓</span>${hitSpan}</td>`;
  }
  const short = g.items.filter((it) => it.count != null && it.count > 0);
  const unsup = g.items.filter((it) => it.count == null);
  const rows = short
    .map(
      (it) =>
        `<div class="gap-row"><span class="gap-name">${escapeHtml(it.name)}</span><span class="gap-count">差${Math.ceil(it.count)}条</span></div>`
    )
    .join('');
  const unsupRow = unsup.length
    ? `<div class="gap-row gap-unsup">${unsup.map((it) => escapeHtml(it.name)).join('/')} 不可补</div>`
    : '';
  const tip = gapAdviceHtml(character, R);
  return `<td class="thit"${tip ? ` data-detail="${escapeHtml(tip)}"` : ''}>
    <span class="gap-state mid">缺口 ${g.total}</span>${hitSpan}
    ${rows}
    ${unsupRow}
  </td>`;
}

// ---------- 汇总表视图 ----------
// 表头排序状态（asc → desc → 恢复默认 三态，统一走 src/lib/util.js）
const tableSort = createSort();
export function toggleTableSort(col) {
  tableSort.toggle(col);
}
/** 汇总表属性格悬浮：计算详情——当前/目标达成率 + 基础→加成→最终分解 + 各来源明细 + 账号实测差异 */
function statDetailHtml(R, s, current, targetVal, rate) {
  const fmt = (v) => formatValue(s, v);
  let src = s;
  let base = R.base?.[s];
  let bonus = R.bonus?.[s];
  let final = R.final?.[s];
  // 「属性伤害加成」目标：实际键取 final 首个伤害加成键（来源明细按实际键列）
  if (s === '属性伤害加成') {
    const dbKey = Object.keys(R.final || {}).find((k) => isDamageBonus(k));
    if (dbKey) {
      src = dbKey;
      base = null;
      bonus = null;
      final = R.final[dbKey];
    }
  }
  const parts = [`<b>${s}</b>　当前 <b>${fmt(current)}</b>`];
  if (targetVal != null && rate != null) {
    const targetInternal = targetPercents.has(s) ? Number(targetVal) / 100 : Number(targetVal);
    parts.push(
      `<span style="color:var(--dim)">目标 ${fmt(targetInternal)} → 达成 <span class="${rateClass(rate)}">${(rate * 100).toFixed(0)}%</span></span>`
    );
  }
  if (final != null && base != null) {
    parts.push(`基础 ${fmt(base)} + 加成 ${fmt(bonus)} = 最终 <b>${fmt(final)}</b>`);
  } else if (final != null) {
    parts.push(`合计 <b>${fmt(final)}</b>`);
  }
  const srcs = R.sources?.[src];
  if (srcs?.length) parts.push(srcs.map((t) => `<span style="color:var(--dim)">· ${t}</span>`).join('<br>'));
  // 账号实测与推算差异（实测为展示主值；差异超阈值才提示，避免取整噪音）
  const act = R.actual?.[s]?.final;
  if (act != null && final != null && Math.abs(act - final) > (targetPercents.has(s) ? 0.005 : 1))
    parts.push(
      `<span style="color:var(--dim);font-size:var(--fs-sm)">账号实测 ${fmt(act)}（推算 ${fmt(final)}）</span>`
    );
  return parts.join('<br>');
}
function cellStats(R, target, s, tInfo, name) {
  const current = resolveStatCurrent(R, s);
  if (current == null) return `<td class="tstat">—<div class="tbar tbar-empty"></div></td>`;
  // 属性伤害列标元素（如 冰 62.4%）：取最终面板首个伤害加成键，剥出元素名
  let label = '';
  if (s === '属性伤害加成') {
    const dbKey = Object.keys(R.final || {}).find((k) => isDamageBonus(k));
    if (dbKey) label = dbKey.replace('属性伤害加成', '').replace('伤害加成', '') + ' ';
  }
  const targetVal = target[s];
  const rate =
    targetVal == null || !Number(targetVal)
      ? null
      : current / (targetPercents.has(s) ? Number(targetVal) / 100 : Number(targetVal));
  const tip = ` data-detail="${escapeHtml(statDetailHtml(R, s, current, targetVal, rate))}"`;
  // 目标子行（并入列内）：已设目标 → 显示目标+P（点击手改）；未设但有建议 → 「设定目标」打开弹窗；两者都无 → 空
  const info = tInfo?.[s];
  let sub = '';
  if (info?.target != null) {
    sub = `<span class="t-target" onclick="ZZZ.goalEdit('${escapeJsAttr(name)}','${escapeJsAttr(s)}')">目标 ${info.target}</span>`;
  } else if (info?.suggestion != null) {
    // 未设目标但有建议 → 「设定目标」打开 goalEdit 弹窗，用户自行填写（不自动填默认值）
    sub = `<span class="t-target t-set" onclick="ZZZ.goalEdit('${escapeJsAttr(name)}','${escapeJsAttr(s)}')">设定目标</span>`;
  }
  const row = (statusHtml) =>
    `<div class="tstat-row"><span class="tv">${label}${formatValue(s, current)}</span>${statusHtml}</div>`;
  if (rate == null) return `<td class="tstat"${tip}>${row('')}${sub}</td>`;
  // 达成率：圆形环绕百分比（替代横条+文字），绿/黄/红按 rateClass
  const pct = Math.min(100, rate * 100).toFixed(0);
  const ringC = { good: 'var(--green)', mid: 'var(--amber)', bad: 'var(--red)' }[rateClass(rate)] || 'var(--amber)';
  const ringHtml = `<div class="ring" style="--pct:${pct}%;--ring-c:${ringC}"><span class="ring-pct">${pct}%</span></div>`;
  return `<td class="tstat"${tip}>${row(ringHtml)}${sub}</td>`;
}

/** 未拥有角色灰行：库基础（图标/职业/属性）照常，个人数值/装备一律 —；不回退 wiki 推算。
 *  带「养成」（展开全服/推荐参考手风琴）与禁用的「配置」按钮；整行不可拖、不参与排序/行序。 */
function unownedRowHtml(name, colOrder) {
  const libChar = library.characters?.[name] || {};
  const icon = libChar.icon || '';
  const meta = [libChar.rarity, libChar.element, libChar.trait, libChar.faction]
    .filter(Boolean)
    .map((s) => escapeHtml(s))
    .join(' · ');
  const tip = `<b>${escapeHtml(name)}</b><br>${meta}<br><span style="color:var(--dim)">未拥有该角色，仅全服/推荐参考</span>`;
  const img = icon
    ? `<img class="t-ico" src="${escapeHtml(icon)}" loading="lazy" data-detail="${escapeHtml(tip)}">`
    : escapeHtml(name);
  const isOpen = expandedChar === name;
  const actions = `<span class="t-actions">
    <button class="mini t-goal${isOpen ? ' on' : ''}" data-detail="查看该角色的全服/推荐参考（未拥有，无个人练度）" onclick="ZZZ.toggleGoalAcc('${escapeJsAttr(name)}')">养成</button>
    <button class="mini" disabled data-detail="未拥有该角色，无法配置个人目标">配置</button>
  </span>`;
  const cell = {};
  cell['角色'] = `<td class="tchar"><span class="t-char-cell">${img}${actions}</span></td>`;
  cell['等级'] = `<td class="tlv"><span class="ds-dim">—</span></td>`;
  cell['职业'] = `<td class="tcls">${escapeHtml(libChar.trait || '—')}</td>`;
  cell['属性'] = `<td class="telm">${escapeHtml(libChar.element || '—')}</td>`;
  cell['音擎'] = `<td class="twe"><span class="ds-dim">—</span></td>`;
  cell['驱动盘'] = `<td class="tdisc"><span class="ds-dim">—</span></td>`;
  cell['缺口'] = `<td class="thit"><span class="ds-dim">—</span></td>`;
  for (const s of targetStats)
    cell[s] = `<td class="tstat"><span class="ds-dim">—</span><div class="tbar tbar-empty"></div></td>`;
  const cells = colOrder.map((c) => cell[c]).join('');
  const acc = isOpen
    ? `<tr class="goal-acc-row"><td colspan="${colOrder.length}"><div class="goal-acc-body">${renderGoalAccordionHtml(name)}</div></td></tr>`
    : '';
  return `<tr class="row-unowned" data-char="${escapeHtml(name)}" data-unowned="1">${cells}</tr>${acc}`;
}

export function renderTable(ownedList, container, { unowned = [] } = {}) {
  const allColumns = ['角色', '等级', '职业', '属性', '音擎', '驱动盘', '缺口', ...targetStats];
  // 列序：优先用保存的顺序（过滤掉已不存在的列），新列补到末尾
  let colOrder = (readColOrder() || []).filter((c) => allColumns.includes(c));
  colOrder.push(...allColumns.filter((c) => !colOrder.includes(c)));

  // 行序：优先用保存的（新角色排末尾）
  const savedRowOrder = readRowOrder() || [];
  const rowOrder = savedRowOrder.length
    ? [...ownedList].sort((a, b) => {
        const ia = savedRowOrder.indexOf(a.name),
          ib = savedRowOrder.indexOf(b.name);
        return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
      })
    : ownedList;

  const SORTABLE_COLS = new Set(['角色', '等级', '职业', '属性', '音擎', '缺口', ...targetStats]);
  const header = `<tr>${colOrder
    .map((c) => {
      const sortable = SORTABLE_COLS.has(c);
      const on = tableSort.key === c;
      return `<th draggable="true" data-detail="拖动可排序" data-col="${c}"${sortable ? ` data-sort="${c}"${on ? ' class="sorted"' : ''}` : ''}>${c}${on ? (tableSort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
    })
    .join('')}</tr>`;

  let rowObjs = rowOrder.map((character) => {
    const R = character.calculate();
    const target = readCharTarget(character.name);
    const libCharacter = R.libCharacter;
    const {
      wengine,
      icon: wengineIcon,
      baseAtk: wengineBaseAtk,
      subStats: wengineSubStats,
      specialEffect: wengineEffect,
    } = wengineInfo(character, R);
    const charValidSet = new Set(percentSubstats(readValidStats(character.name))); // % 口径（固定值不参与命中/高亮）
    const cell = {};

    const charIcon = libCharacter?.icon || character.icon || ''; // library 优先（已内联）
    const charNote = readNote(character.name);
    // ⚠️ 备注是用户数据，必须先 escapeHtml 再拼入 charDetail：外层 :258 的 escapeHtml 只护 data-detail 属性，
    // 而浏览器读 .dataset 时已把实体解码回去（render.js showTip → tipEl.innerHTML 汇点会按原文执行）。
    // 双层转义后悬浮框内显示字面文本，而非把备注里的标记当 HTML 执行。同一约定适用于下行的所有数据字面片段
    //（角色名/职业属性等虽目前是游戏常量，仍统一 embed 转义，防未来混入用户可控字段）。
    const charMeta = [libCharacter?.rarity || '', libCharacter?.element || '', libCharacter?.trait || '', character.faction || libCharacter?.faction || '']
      .filter(Boolean)
      .map((s) => escapeHtml(s))
      .join(' · ');
    const charDetail = `<b>${escapeHtml(character.name)}</b>${character.level ? `<br><span style="color:var(--dim)">Lv.${character.level}</span>` : ''}<br>${charMeta}${charNote ? `<br><span style="color:var(--acc)">备注：${escapeHtml(charNote)}</span>` : ''}`;
    cell['角色'] =
      `<td class="tchar"><span class="t-char-cell">${charIcon ? `<img class="t-ico" src="${charIcon}" loading="lazy" data-detail="${escapeHtml(charDetail)}" onclick="openNote('${escapeJsAttr(character.name)}')">` : escapeHtml(character.name)}<span class="t-actions"><button class="mini t-goal${expandedChar === character.name ? ' on' : ''}" data-detail="展开该角色的养成面板（技能/影画/觉醒 + 驱动盘重刷参考）" onclick="ZZZ.toggleGoalAcc('${escapeJsAttr(character.name)}')">养成</button><button class="mini" data-detail="配置该角色的推荐音擎/主词条/有效副词条" onclick="ZZZ.goalConfig('${escapeJsAttr(character.name)}')">配置</button></span></span></td>`;
    cell['等级'] =
      `<td class="tlv">${character.level ? `Lv.${character.level}` : '<span class="ds-dim">—</span>'}</td>`;
    cell['职业'] = `<td class="tcls">${escapeHtml(libCharacter?.trait || '—')}</td>`;
    cell['属性'] = `<td class="telm">${escapeHtml(libCharacter?.element || '—')}</td>`;

    const wengineDetail =
      `<b>${escapeHtml(wengine.name || '未佩戴')}</b>${wengine.refinement ? ` ★${wengine.refinement}` : ''}` +
      (wengineBaseAtk != null ? `<br>基础攻击 ${formatValue(STAT.ATK, wengineBaseAtk)}` : '') +
      (wengineSubStats.length
        ? `<br>${wengineSubStats.map((t) => `${escapeHtml(t.name)} ${formatValue(t.name, t.value)}`).join('　')}`
        : '') +
      (wengineEffect
        ? `<br><span style="color:var(--dim);font-size:var(--fs-sm)">${escapeHtml(wengineEffect.length > 110 ? wengineEffect.slice(0, 110) + '…' : wengineEffect)}</span>`
        : '');
    cell['音擎'] =
      `<td class="twe">${wengineIcon ? `<img class="t-ico" src="${wengineIcon}" data-detail="${escapeHtml(wengineDetail)}">` : wengine.name || '未佩戴'}</td>`;

    const discIcons = (character.discs || [])
      .filter(Boolean)
      .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
      .slice(0, 6)
      .map((d) => {
        const discLib = resolveEntry(CATEGORY.DISC, discIndex, d.set);
        const icon = discLib?.roundIcon || discLib?.icon || d.icon || ''; // library 优先（已内联）
        if (!icon) return '<span class="d-ico" style="border-color:var(--line2)"></span>';
        return `<img class="d-ico" src="${icon}" data-detail="${escapeHtml(discTooltipFull(d, charValidSet))}">`;
      })
      .join('');
    cell['驱动盘'] = `<td class="tdisc"><div class="tdisc-ico">${discIcons || '未佩戴'}</div></td>`;

    cell['缺口'] = gapCellHtml(character, R);
    const gapTotal = targetGap(character, R)?.total ?? null; // 缺口列排序值

    const tInfo = charTargetInfo(character.name, targetStats); // 属性列目标子行信息（每角色一次）
    for (const s of targetStats) cell[s] = cellStats(R, target, s, tInfo, character.name);

    // 各列排序取值（点击表头排序用）
    const sortVals = {
      角色: character.name,
      等级: character.level || null, // 未满级/缺省沉底
      职业: libCharacter?.trait || '',
      属性: libCharacter?.element || '',
      音擎: wengine.name || R.libWengine?.name || '',
      缺口: gapTotal,
    };
    for (const s of targetStats) sortVals[s] = resolveStatCurrent(R, s);

    const cells = colOrder.map((c) => cell[c]).join('');
    // 「提升」手风琴行：嵌在本角色行 html 内（唯一实例跟随角色），行拖拽/表头排序时自动跟随
    const acc =
      expandedChar === character.name
        ? `<tr class="goal-acc-row"><td colspan="${colOrder.length}"><div class="goal-acc-body">${renderGoalAccordionHtml(character.name)}</div></td></tr>`
        : '';
    return {
      html: `<tr draggable="true" data-char="${escapeHtml(character.name)}">${cells}</tr>` + acc,
      sortVals,
    };
  });
  if (tableSort.active) {
    rowObjs = tableSort.apply(rowObjs, (row, key) => row.sortVals[key]);
  }
  // 未拥有灰行固定在拥有行之后：不参与行序/表头排序（分组钉死，见 Q12）
  const unownedRows = unowned.map((name) => unownedRowHtml(name, colOrder)).join('');
  container.innerHTML = `<div class="tbl-wrap"><table class="tbl" id="汇总表">${header}${rowObjs
    .map((r) => r.html)
    .join('')}${unownedRows}</table></div>`;
}

// ---------- 表格拖拽排序（行/列） ----------
/** 当前可见行/列序（DOM 实时，含默认数据序/表头排序后的显示序/新加行）。
 *  拖拽基序必须完整：readRowOrder()/readColOrder() 的默认 [] 是 truthy，`|| 默认序.map` 类兜底不触发，
 *  曾导致「首个拖拽只存被拖的那一行/列，其余从未拖过的行列永远排不进自定义序」。 */
// 行序只含已拥有行（未拥有灰行 data-unowned，不参与行序/拖拽）
const visibleRowNames = () =>
  [...grid.querySelectorAll('tr[data-char]')].filter((tr) => !tr.dataset.unowned).map((tr) => tr.dataset.char);
const visibleColNames = () => [...grid.querySelectorAll('th[data-col]')].map((th) => th.dataset.col);
let dragRow = null,
  dragCol = null;
grid.addEventListener('dragstart', (e) => {
  if (!e.target.closest('table.tbl')) return;
  const tr = e.target.closest('tr[data-char]');
  const th = e.target.closest('th[data-col]');
  if (tr) {
    dragRow = tr.dataset.char;
    tr.style.opacity = 0.35;
  } else if (th) {
    dragCol = th.dataset.col;
    th.style.opacity = 0.35;
  }
  if (dragRow || dragCol) e.dataTransfer.effectAllowed = 'move';
});
grid.addEventListener('dragover', (e) => {
  if (!dragRow && !dragCol) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  grid.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
  const tr = e.target.closest('tr[data-char]');
  const th = e.target.closest('th[data-col]');
  // 未拥有灰行不可作为拖拽落点（拥有组固定在前）
  if (dragRow && tr && !tr.dataset.unowned && tr.dataset.char !== dragRow) tr.classList.add('drag-over');
  if (dragCol && th && th.dataset.col !== dragCol) th.classList.add('drag-over');
});
grid.addEventListener('drop', (e) => {
  if (!e.target.closest('table.tbl')) return;
  const tr = e.target.closest('tr[data-char]');
  const th = e.target.closest('th[data-col]');
  if (dragRow && tr && !tr.dataset.unowned && tr.dataset.char !== dragRow) {
    // 以当前可见行序为基（完整含全部行）：被拖行移除后插到目标行原位置，保存为全局行序
    const order = visibleRowNames().filter((n) => n !== dragRow);
    const idx = order.indexOf(tr.dataset.char);
    order.splice(idx < 0 ? order.length : idx, 0, dragRow);
    tableSort.reset(); // 拖拽 = 固化自定义行序，退出表头临时排序（否则 rerender 会按残留排序覆盖拖拽结果）
    saveRowOrder(order);
    rerender();
  } else if (dragCol && th && th.dataset.col !== dragCol) {
    // 列同：以当前可见列序为基，被拖列插到目标列原位置
    const order = visibleColNames().filter((c) => c !== dragCol);
    const idx = order.indexOf(th.dataset.col);
    order.splice(idx < 0 ? order.length : idx, 0, dragCol);
    saveColOrder(order);
    rerender();
  }
});
grid.addEventListener('dragend', () => {
  grid.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
  grid.querySelectorAll('tr[data-char], th[data-col]').forEach((x) => (x.style.opacity = ''));
  dragRow = null;
  dragCol = null;
});

// ---------- 我的角色视图（汇总表 + 手风琴练度面板） ----------
/** 汇总表「提升」手风琴的展开角色（唯一实例跟随角色；'' = 全部收起） */
export let expandedChar = '';
export function setExpandedChar(name) {
  expandedChar = name || '';
}
export function toggleGoalAccRow(name) {
  expandedChar = expandedChar === name ? '' : name;
}
/** 就地同步手风琴行（点「养成」用，不触发全量 render）：按 expandedChar 插入/移除 `.goal-acc-row`。
 *  ⚠️ 全量 render（排序/拖拽）仍由 renderTable 的 acc 重建；本函数只管就地增删，不碰滚动位置。 */
export function syncGoalAccRowInDom() {
  const old = grid.querySelector('tr.goal-acc-row');
  if (old) old.remove();
  if (!expandedChar) {
    mountCharts(); // 收起：回收已移除手风琴行的图实例（mountCharts 内部 pruneDetachedCharts）
    return;
  }
  const target = grid.querySelector(`tr[data-char="${CSS.escape(expandedChar)}"]`);
  if (!target) {
    mountCharts();
    return;
  }
  const accHtml = renderGoalAccordionHtml(expandedChar); // 未拥有/拥有共用同构面板（内部按账号有无输出 —）
  const colCount = grid.querySelectorAll('th[data-col]').length || 1;
  const tr = document.createElement('tr');
  tr.className = 'goal-acc-row';
  tr.innerHTML = `<td colspan="${colCount}"><div class="goal-acc-body">${accHtml}</div></td>`;
  target.insertAdjacentElement('afterend', tr);
  mountCharts(); // 就地展开：挂载新手风琴行的技能分布图（pending 里是刚 register 的 goal-skill-dist）
}
/** 我的角色视图外壳：无二级 tab 栏（角色诊断已删），直接内容容器（bodyContent 可选，放空态提示等） */
export function myCharsShell(bodyContent = '') {
  return `<div class="wiki"><div class="mychars-body">${bodyContent}</div></div>`;
}
