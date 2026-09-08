// src/web/discProb.js —— 「模拟 → 驱动盘提升模拟」子面板
// 驱动盘练度提升概率计算（移植 ZZZ-DDC）：按角色副词条价值权重，计算随机掉落+强化达到目标分的概率。
// 计算逻辑在 src/lib/discRules.js（双端共享纯函数，规则 A-H 编号见其顶部注释）；本文件只做表单与结果渲染。
// 角色价值权重 = workshop-weights（经 workshop-grad 对齐 wiki 角色名）；词条/主词条名称与 constants 统一。
import {
  myCharacters,
  workshopGrad,
  workshopStats,
  sortRoleNames,
  roleOptionsHtml,
  readDiscWeights,
  saveDiscWeights,
  readValidStats,
} from './data.js';
import {
  DISC_SUBSTATS,
  MAIN_STAT_OPTIONS,
  mainStatName,
  FIXED_SUBSTATS,
} from '../game/index.js';
// discRules 领域规则符号（按规则组标注：A5/H1 主词条与副词条池、A3/A4 成长表、D1-D4 权重、B/E 生成模型与保词条）
import {
  // A5：123 号位主词条固定；H1：副词条池配对/展示顺序
  SLOT_FIXED_MAIN,
  DP_ROW_PAIRS,
  DP_SUB_ORDER,
  // A3/A4：成长表与形态判定
  substatGrowthTable,
  substatType,
  // H1：10 词条池构造（rest 同盘不重复 / blockedIdx 主词条同类屏蔽 / specialWeight 加权）
  buildTypes,
  // D1-D4：权重来源
  roleWeightsFromWs,
  DEFAULT_WEIGHTS,
  // B/E：生成模型与保词条比较
  computePosProb,
  computePosProbKeep,
} from '../game/index.js';
import { escapeHtml, formatValue } from '../lib/util.js';
import { registerZZZ } from './shared.js';
import { chartBox, dpProbBarOption } from './charts.js';
import { CHART_HEIGHT } from './visual.js';
/* global echarts */

/** dpResult 图表的手动挂载（dpCalc 更新数据，不走主 render 的 mountCharts）。
 *  预置的 .chart-init 容器跨点击常驻：首次 init（并移除占位文字），之后仅 setOption 更新数据、不重建 DOM */
const dpCharts = new Map();
function mountDpChart(key, opt) {
  const el = document.querySelector(`.chart-init[data-chart="${key}"]`);
  if (!el || typeof echarts === 'undefined') return;
  const existing = echarts.getInstanceByDom(el);
  if (existing) {
    existing.setOption(opt);
    return;
  }
  // 视图重进后旧实例仍挂在已脱离 DOM 的容器上（dp 旁路不进 charts 注册表，pruneDetachedCharts 管不到）：
  // 同 key 先 dispose 再 init，避免每次进出模拟视图累积一个泄漏实例
  const prev = dpCharts.get(key);
  if (prev) prev.dispose();
  const chart = echarts.init(el);
  chart.setOption(opt);
  dpCharts.set(key, chart);
  const tip = el.parentElement?.querySelector('.dp-skeleton-tip');
  if (tip) tip.remove();
}

/** 回收已脱离 DOM 的 dp 旁路图实例。dpCharts 不进 charts 注册表（pruneDetachedCharts 管不到），
 *  离开「模拟」视图后实例仍持着已移除的容器——render() 每次整块清空 grid 后调用（render.js），把断连的 dispose。 */
export function pruneDpCharts() {
  for (const [key, chart] of dpCharts) {
    if (!chart.getDom()?.isConnected) {
      chart.dispose();
      dpCharts.delete(key);
    }
  }
}

/** 角色当前装备的 6 盘（按 1-6 号位排序，缺槽为 null） */
function roleDiscs(name) {
  const arr = (myCharacters.find((c) => c.name === name)?.discs || [])
    .filter((d) => d && d.slot != null)
    .sort((a, b) => a.slot - b.slot);
  return [1, 2, 3, 4, 5, 6].map((pos) => arr.find((d) => d.slot === pos) || null);
}

/** 盘主词条名（456 号位固定值名归一化为百分比；无盘返回空） */
function mainOf(d) {
  if (!d) return '';
  const entry = (d.mainStats || []).find((t) => t && t.name != null);
  return entry ? mainStatName(entry.name) : '';
}

/** 盘副词条名列表（0-4 个，已区分 % 与固定值：账号原始名不带 %，按 value 量级经 substatType 归一为标准名）；无盘返回空 */
function subsOf(d) {
  if (!d) return [];
  return (d.subStats || [])
    .filter((t) => t && t.name != null && t.value != null)
    .map((t) => substatType(t.name, t.value));
}

/** 单个驱动盘卡：主词条（123 固定 / 456 下拉）+ 目标主词条（456，默认当前）+ 4 行副词条（词条 | 命中 | 基础值×命中）
 *  + 定向主词条（全部盘，道具：位置+主词条必出，默认不限）+ 定向副词条 ×2（需先定向主词条）。
 *  main/subs 为角色当前装备值（默认选中）；growth 为当前盘各副词条成长信息（默认命中 = 1+强化次数）。 */
function slotHtml(pos, main, subs, growth) {
  const mainHtml =
    SLOT_FIXED_MAIN[pos] != null
      ? `<div class="dp-row"><label>主词条</label><div class="dp-slot-main-fixed">${SLOT_FIXED_MAIN[pos]}</div></div>`
      : `<div class="dp-row"><label>主词条</label><select class="dp-slot-main" data-pos="${pos}"><option value=""${main === '' ? ' selected' : ''}>—</option>${(
          MAIN_STAT_OPTIONS[pos] || []
        )
          .map((m) => `<option value="${escapeHtml(m)}"${main === m ? ' selected' : ''}>${escapeHtml(m)}</option>`)
          .join('')}</select></div>`;
  const targetMain =
    pos >= 4
      ? `<div class="dp-row"><label>目标主词条</label><select class="dp-target-main" data-pos="${pos}"><option value=""${!main ? ' selected' : ''}>—（不限）</option>${(
          MAIN_STAT_OPTIONS[pos] || []
        )
          .map((m) => `<option value="${escapeHtml(m)}"${main === m ? ' selected' : ''}>${escapeHtml(m)}</option>`)
          .join('')}</select></div>`
      : '';
  const subOptions = (sel) =>
    `<option value=""${sel === '' || sel == null ? ' selected' : ''}>—</option>${DP_SUB_ORDER.map(
      (i) =>
        `<option value="${escapeHtml(DISC_SUBSTATS[i])}"${sel === DISC_SUBSTATS[i] ? ' selected' : ''}>${escapeHtml(DISC_SUBSTATS[i])}</option>`
    ).join('')}`;
  const subSelects = [0, 1, 2, 3]
    .map((k) => {
      const name = subs[k] || '';
      const hit = name ? 1 + (growth?.[k]?.growthCount ?? 0) : 1; // 默认命中 = 词条 1 次 + 强化次数
      const base = substatGrowthTable.S[name];
      const val = name && base ? formatValue(name, base * hit) : '';
      return (
        `<div class="dp-row dp-sub-row">` +
        `<select class="dp-slot-sub" data-pos="${pos}" data-sub="${k}" onchange="ZZZ.dpSubChange(this, ${pos}, ${k})">${subOptions(name)}</select>` +
        `<input class="dp-hit-sub" data-pos="${pos}" data-sub="${k}" type="number" min="0" step="1" value="${hit}" oninput="ZZZ.dpHitChange(this, ${pos}, ${k})" data-detail="该词条命中次数（1 + 强化次数）">` +
        `<span class="dp-sub-val" data-pos="${pos}" data-sub="${k}" data-detail="基础值 × 命中次数">${val}</span></div>`
      );
    })
    .join('');
  // 定向主词条（道具：消耗后位置与主词条必出）；123 号位选项 = 固定值（相当于指定位置），456 = 全部主词条
  const dirMainOpts =
    SLOT_FIXED_MAIN[pos] != null
      ? `<option value="" selected>—（不限）</option><option value="${SLOT_FIXED_MAIN[pos]}">${SLOT_FIXED_MAIN[pos]}</option>`
      : `<option value="" selected>—（不限）</option>${(MAIN_STAT_OPTIONS[pos] || [])
          .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
          .join('')}`;
  const dirMain = `<div class="dp-row"><label>定向主词条</label><select class="dp-dir-main" data-pos="${pos}" onchange="ZZZ.dpDirChange(this, ${pos})" data-detail="消耗道具：指定位置且主词条必出">${dirMainOpts}</select></div>`;
  const dirSubs = [0, 1]
    .map(
      (k) =>
        `<div class="dp-row"><label>定向副词条${k + 1}</label><select class="dp-dir-sub" data-pos="${pos}" data-k="${k}" onchange="ZZZ.dpDirChange(this, ${pos})" data-detail="需先定向主词条"><option value="" selected>—（不限）</option>${DP_SUB_ORDER.map(
          (i) => `<option value="${escapeHtml(DISC_SUBSTATS[i])}">${escapeHtml(DISC_SUBSTATS[i])}</option>`
        ).join('')}</select></div>`
    )
    .join('');
  const dirBlock = `<div class="dp-dir-block"><div class="dp-dir-head">定向（消耗道具）</div>${dirMain}${dirSubs}</div>`;
  return `<div class="dp-slot" data-pos="${pos}"><div class="dp-slot-head">${pos}号位</div>${mainHtml}${targetMain}${subSelects}${dirBlock}</div>`;
}

/** 刷新某副词条行的第三列显示值 = 基础值 × 该行命中次数 */
function refreshSubVal(pos, k) {
  const name = document.querySelector(`.dp-slot-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value || '';
  const hit = Number(document.querySelector(`.dp-hit-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value) || 0;
  const span = document.querySelector(`.dp-sub-val[data-pos="${pos}"][data-sub="${k}"]`);
  if (!span) return;
  const base = name ? substatGrowthTable.S[name] : 0;
  span.textContent = name && base ? formatValue(name, base * hit) : '';
}

/** 副词条下拉切换：更新该行第三列（基础值 × 当前命中次数） */
function dpSubChange(sel, pos, k) {
  refreshSubVal(pos, k);
}

/** 命中次数输入变化：更新该行第三列 */
function dpHitChange(inp, pos, k) {
  refreshSubVal(pos, k);
}

/** 该盘所有定向下拉（定向主词条 + 定向副词条） */
function dirSelects(pos) {
  return [
    ...document.querySelectorAll(`.dp-dir-main[data-pos="${pos}"]`),
    ...document.querySelectorAll(`.dp-dir-sub[data-pos="${pos}"]`),
  ];
}

/** 刷新某盘定向状态：①定向副词条必须已定向主词条才可选；②定向系列词条互斥（同盘词条不重复）。
 *  ⚠️ 需在对应盘 DOM 就位后调用——render() 整块重建表单后不会触发 onchange，须由挂载点主动刷一次（render.js SIMULATE 分支）。 */
export function refreshDirState(pos) {
  const sels = dirSelects(pos);
  const dirMain = document.querySelector(`.dp-dir-main[data-pos="${pos}"]`);
  const mainChosen = !!dirMain?.value;
  for (const s of sels) {
    const taken = new Set(
      sels
        .filter((x) => x !== s)
        .map((x) => x.value)
        .filter(Boolean)
    );
    for (const opt of s.options) {
      // 互斥禁用 + 定向副词条需先定向主词条
      opt.disabled = (!!opt.value && taken.has(opt.value)) || (s.classList.contains('dp-dir-sub') && !mainChosen);
    }
  }
}

/** 定向下拉变化：若选中的词条已被本盘其他定向下拉占用则回退为不定向，并刷新禁用状态 */
function dpDirChange(sel, pos) {
  const sels = dirSelects(pos);
  const others = new Set(
    sels
      .filter((x) => x !== sel)
      .map((x) => x.value)
      .filter(Boolean)
  );
  if (sel.value && others.has(sel.value)) sel.value = '';
  refreshDirState(pos);
}

/** 当前角色的 10 维价值权重：优先用户保存的（点计算时写入），其次 workshop-weights，最后默认模板 */
function weightsFor(name) {
  return (
    readDiscWeights(name) ?? roleWeightsFromWs(name, workshopStats.weightJson, workshopGrad.roles) ?? DEFAULT_WEIGHTS
  );
}

/** 驱动盘提升模拟面板的模块态：dpRole = 当前角色（独立下拉选择或 URL 联动带入）。
 *  dpRerender = 重渲染回调（打破循环依赖：ui.js 注入 render，切换角色后重挂面板以加载新角色的权重与当前盘）。 */
export let dpRole = '';
export function setDpRole(name) {
  dpRole = name || '';
}
let dpRerender = null;
export function setDpRerender(fn) {
  dpRerender = fn;
}

/** 渲染驱动盘提升模拟面板（「模拟」视图 prob tab）：读 dpRole 模块态。
 *  表单默认预填该角色当前装备盘（词条 + 命中次数 = 1 + 强化次数）与三级回退的权重（用户保存 → 工坊流派 → 默认模板）。 */
export function renderProbPanel() {
  const roles = sortRoleNames();
  if (!roles.includes(dpRole)) dpRole = roles[0] || '';
  const weights = weightsFor(dpRole);
  const entryHtml = (i) =>
    `<div class="dp-entry"><span class="dp-ename">${DISC_SUBSTATS[i]}</span>` +
    `<label>价值</label><input class="dp-w" data-idx="${i}" type="number" step="0.05" min="0" value="${weights[i]}" data-detail="该词条对本角色的价值权重（0 = 无效词条）"></div>`;
  const rows = DP_ROW_PAIRS.map((pair) => pair.map(entryHtml).join('')).join('');
  const discs = roleDiscs(dpRole);
  const slots = discs.map((d, i) => slotHtml(i + 1, mainOf(d), subsOf(d), d?.growth)).join('');
  return `<div class="dp-wrap chart-card">
    <h3>驱动盘提升模拟 <button class="chart-hint" data-hint="${escapeHtml(
      '按该角色的副词条价值权重，计算<b>刷到比当前驱动盘更好的盘的概率</b>：新盘随机掉落 + 强化后，副词条价值分超过当前盘该位置的分数。<b>概率越低 = 当前盘越接近极限、越难提升</b>。<br>目标主词条（456，默认 = 当前主词条）限定比较的主词条；<b>定向主词条</b> = 消耗道具使位置与主词条必出（消除每位置 1/6 概率以及主词条出现概率）；定向副词条需先定向主词条。<br>模型：首 4 副词条按抽取权重枚举（同盘不重复），强化每次从 4 词条中随机一条 +1 层；初始 4 词条盘占 20%（成长 5 次）、3 词条盘占 80%（首次强化补第 4 词条、之后成长 4 次）；456 号位主词条按出现概率加权。'
    )}">?</button></h3>
    <div class="dp-split">
      <div class="dp-left">
        <div class="dp-role-row"><label>角色</label><select onchange="ZZZ.dpRole(this.value)">${roleOptionsHtml(dpRole, roles)}</select></div>
        <h4 class="dp-slots-title">副词条权重</h4>
        <div class="dp-entries">${rows}</div>
        <h4 class="dp-slots-title">驱动盘设置</h4>
        <div class="dp-slots dp-slots-3">${slots}</div>
      </div>
      <div class="dp-right">
        <div class="dp-calc-row"><button class="primary" onclick="ZZZ.dpCalc()">计算概率</button></div>
        <div id="dpResult" class="dp-result">
          <div id="dpTablesWrap"></div>
          <div class="dp-result-chart" id="dpChartBox">
            ${chartBox('dp-prob', CHART_HEIGHT.dpProb)}
            <div class="dp-skeleton-tip">配置左侧参数后点击「计算概率」</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/** 养成盘卡的内部评分权重（不暴露 UI）：养成配置勾选的属性 → 其 % 变体权重 1；
 *  生命/攻击/防御的固定值变体权重**恒为 0**（固定值词条提升效率低，纯数值口径内部约定）。
 *  返回 10 维权重数组（与 DISC_SUBSTATS 下标对齐），全 0 = 未勾选任何可用属性。 */
function accordionWeights(name) {
  const w = new Array(DISC_SUBSTATS.length).fill(0);
  for (const t of readValidStats(name)) {
    if (FIXED_SUBSTATS.has(t)) continue; // 固定值变体恒 0（与命中 % 口径一致）
    const idx = DISC_SUBSTATS.indexOf(t);
    if (idx >= 0) w[idx] = 1;
  }
  return w;
}

/** 五概率核心（驱动盘提升模拟 dpCalc 与养成盘卡共用）：超过 / 持平 / 保词条超过 / 初始4词条 p4 / 初始3词条 p3。
 *  持平（probTie）= 新盘加权命中**不低于**当前盘（≥ = 严格超过 + 恰好打平），恒 ≥ 超过；
 *  dirMain = 定向主词条（道具，位置+主词条必出）；dirSubs = 定向副词条（首 4 词条必须包含，类型名数组）。 */
function slotProbs(pos, mains, pool, goal, minHits, dirMain, dirSubs) {
  const opts = dirMain ? { posFixed: dirMain } : {};
  const dirSubIdx = (dirSubs || []).map((n) => DISC_SUBSTATS.indexOf(n));
  const { prob, hitMain, p4, p3 } = computePosProb(pos, mains, pool, goal, dirSubIdx, opts);
  const { prob: probTie } = computePosProb(pos, mains, pool, goal, dirSubIdx, opts, '>=');
  const { prob: probKeep } = computePosProbKeep(pos, mains, pool, goal, minHits, dirSubIdx, opts);
  return { prob, probTie, probKeep, p4, p3, hitMain };
}

/** 单盘「纯数值」提升概率（手风琴盘卡复用，权重走 accordionWeights 内部口径）：
 *  每槽 {pos, mainDisplay, mainDisplayVal, curScore, prob, probTie, probKeep, p4, p3}。
 *  curScore = 当前盘在权重 > 0 词条上的命中总数（与驱动盘提升模拟 curScoreOf 同口径的纯数据版）；
 *  prob = 新盘加权命中数严格超过当前盘的概率（含位置 1/6 与 456 主词条概率）；
 *  probKeep = 各权重 > 0 词条命中都不缩水且总数超过（更严格）；p4/p3 = 初始 4/3 词条盘的纯条件概率。
 *  无可用权重（未勾选或只勾了固定值变体）返回 []。 */
export function computeImproveProbs(charName) {
  const w = accordionWeights(charName);
  if (!w.some((x) => x > 0)) return [];
  const pool = buildTypes(w);
  return roleDiscs(charName).map((d, i) => {
    const pos = i + 1;
    // 计算用归一名（456 概率表/同类屏蔽匹配）；显示用原始主词条名（123 号位固定值，不得显示成 %）
    const target = mainOf(d);
    const mains = target ? [target] : [];
    const mainEntry = (d?.mainStats || []).find((t) => t && t.name != null) || null;
    let goal = 0;
    const minHits = new Array(DISC_SUBSTATS.length).fill(0);
    for (const g of d?.growth || []) {
      const idx = DISC_SUBSTATS.indexOf(g.type);
      if (idx < 0 || !(pool[idx].score > 0)) continue; // 只统计权重 > 0 的词条
      const hit = 1 + (g.growthCount || 0);
      goal += hit;
      minHits[idx] = Math.max(minHits[idx], hit);
    }
    const { prob, probTie, probKeep, p4, p3 } = slotProbs(pos, mains, pool, goal, minHits);
    return {
      pos,
      mainDisplay: mainEntry?.name || '',
      mainDisplayVal: mainEntry?.value ?? null,
      curScore: goal,
      prob,
      probTie, // 持平：新盘加权命中不低于当前盘（op='>=' = 严格超过 + 恰好打平），恒 ≥ 超过
      probKeep,
      p4, // 初始 4 词条盘的纯条件概率（不含位置 1/6 与主词条概率）
      p3, // 初始 3 词条盘的纯条件概率（同上）
    };
  });
}

/** 该位置当前盘的副词条价值分：Σ 每行 命中次数(输入值) × 价值权重。
 *  词条与命中次数均为表单可调值（默认 = 角色当前盘），命中 0 或空词条不计分。 */
function curScoreOf(pos, pool) {
  let base = 0;
  for (let k = 0; k < 4; k++) {
    const name = document.querySelector(`.dp-slot-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value || '';
    const hit = Number(document.querySelector(`.dp-hit-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value) || 0;
    if (!name || !hit) continue;
    const idx = DISC_SUBSTATS.indexOf(name);
    base += hit * (pool[idx]?.score || 0);
  }
  return base;
}

/** 该位置当前盘每词条的最低命中次数（typeIndex → hit，0 = 无约束），供保词条版概率用。
 *  只收集「价值权重 > 0」的词条（无效词条不要求新盘包含/保持）；
 *  比较按词条类型匹配（新盘副词条槽位顺序与当前盘无关）。 */
function curMinHitsOf(pos, pool) {
  const mh = new Array(DISC_SUBSTATS.length).fill(0);
  for (let k = 0; k < 4; k++) {
    const name = document.querySelector(`.dp-slot-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value || '';
    const hit = Number(document.querySelector(`.dp-hit-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value) || 0;
    if (!name || !hit) continue;
    const idx = DISC_SUBSTATS.indexOf(name);
    if (!(pool[idx]?.score > 0)) continue; // 只考虑权重 > 0 的词条
    mh[idx] = Math.max(mh[idx], hit);
  }
  return mh;
}

/** 读取表单 → 计算 6 位置「比当前盘更好」概率 → 渲染结果 */
export function dpCalc() {
  const weights = DISC_SUBSTATS.map(
    (_, i) => Number(document.querySelector(`.dp-w[data-idx="${i}"]`)?.value) || 0
  );
  const pool = buildTypes(weights);
  // 点击计算：把当前权重输入保存到 user-config（下次选中该角色自动加载）
  saveDiscWeights(dpRole, weights);
  let tot1 = 0;
  let tot1t = 0;
  let tot2 = 0;
  const rows = [];
  const detailRows = [];
  const chartItems = [];
  for (const pos of [1, 2, 3, 4, 5, 6]) {
    const goal = curScoreOf(pos, pool);
    const minHits = curMinHitsOf(pos, pool);
    // 目标主词条（456，默认 = 当前主词条）：计算「超过」时主词条限定，未选 = 全部主词条加权
    const target = document.querySelector(`.dp-target-main[data-pos="${pos}"]`)?.value;
    const mains = target ? [target] : [];
    // 定向主词条（道具，全部盘，默认不限）：选定时位置与主词条必出（消除 1/6 与主词条概率）
    const dirMain = document.querySelector(`.dp-dir-main[data-pos="${pos}"]`)?.value;
    // 定向副词条（每盘 ≤2，需先定向主词条，默认不定向）：要求新盘首 4 词条必须包含
    const dirSubs = [0, 1]
      .map((k) => document.querySelector(`.dp-dir-sub[data-pos="${pos}"][data-k="${k}"]`)?.value)
      .filter(Boolean);
    // 概率①：新盘总分超过当前盘；概率②：当前盘权重>0 的副词条在新盘中命中不缩水 且 总分超过
    // 未定向：已含「位置随机 1/6」与 456 主词条概率加权；定向后两者均消除
    const { prob, probTie, probKeep, hitMain, p4, p3 } = slotProbs(pos, mains, pool, goal, minHits, dirMain, dirSubs);
    tot1 += prob;
    tot1t += probTie;
    tot2 += probKeep;
    chartItems.push({ pos, prob, probKeep });
    rows.push(
      `<tr><td>${pos}号位</td><td class="dp-cur">${goal.toFixed(2)}</td>` +
        `<td class="dp-prob">${(prob * 100).toFixed(4)}%</td>` +
        `<td class="dp-prob">${(probTie * 100).toFixed(4)}%</td>` +
        `<td class="dp-prob dp-prob-keep">${(probKeep * 100).toFixed(4)}%</td></tr>`
    );
    detailRows.push(
      `<tr><td>${pos}号位</td><td class="dp-prob">${(hitMain * 100).toFixed(2)}%</td>` +
        `<td class="dp-prob">${(p4 * 100).toFixed(4)}%</td>` +
        `<td class="dp-prob">${(p3 * 100).toFixed(4)}%</td></tr>`
    );
  }
  // 总计：随机掉落一个盘（位置 1-6 等概率 1/6），比当前对应位置盘更好的总概率
  rows.push(
    `<tr class="dp-total"><td>总计（随机位置）</td><td>—</td>` +
      `<td class="dp-prob">${(tot1 * 100).toFixed(4)}%</td>` +
      `<td class="dp-prob">${(tot1t * 100).toFixed(4)}%</td>` +
      `<td class="dp-prob dp-prob-keep">${(tot2 * 100).toFixed(4)}%</td></tr>`
  );
  const tip =
    '<b>结果说明</b><br><span style="color:var(--dim)">每位置三个概率：<br>① 超过：新掉落驱动盘（随机掉落 + 强化）副词条价值分<b>超过当前盘</b>的概率；<br>② 持平：新盘价值分<b>不低于</b>当前盘（超过 + 恰好打平），恒 ≥ 超过——「刷一盘不亏」的概率；<br>③ 保词条：新盘<b>包含当前盘全部权重>0 的副词条（按类型匹配，槽位顺序无关）且各自命中数不低</b>、同时总分超过的概率（更严格，通常更低）。<br>未定向时已含<b>位置随机 1/6</b> 与 456 目标主词条概率加权；<b>定向主词条</b>（道具）= 位置与主词条必出，两者消除；定向副词条需先定向主词条。<br><b>中间输出</b>：抽中号位主词条（未定向；定向 = 100%）；初始 4/3 词条升满超过为<b>纯条件概率</b>（不含抽中号位主词条、不含分支占比），总概率 = 抽中号位主词条 × (0.2×4词条 + 0.8×3词条)。</span>';
  // 结果表写入预置的 #dpTablesWrap；图表框 #dpChartBox 跨点击常驻，仅 setOption 更新数据（不重建 DOM）
  document.getElementById('dpTablesWrap').innerHTML =
    `<h4>各位置刷到更好盘的概率 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h4>` +
    `<div class="dp-result-table"><table class="rec-table"><thead><tr><th>位置</th><th>当前分</th><th>超过</th><th>持平</th><th>保词条超过</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` +
    `<h4 class="dp-detail-title">中间输出（4/3 词条为纯条件概率，不含抽中号位主词条与分支占比）</h4>` +
    `<div class="dp-result-table"><table class="rec-table"><thead><tr><th>位置</th><th>抽中号位主词条</th><th>初始4词条升满超过</th><th>初始3词条升满超过</th></tr></thead><tbody>${detailRows.join('')}</tbody></table></div>`;
  // 概率对比柱状图（预置 .chart-init 内挂载：首次 init，之后 setOption；option 只算一次）
  const opt = dpProbBarOption(chartItems);
  mountDpChart('dp-prob', opt);
}

registerZZZ({
  // 切换角色：先更新模块态再重挂面板——权重（用户/工坊/默认）与新角色当前盘数据都在 renderProbPanel 里预填
  dpRole: (name) => {
    setDpRole(name);
    if (dpRerender) dpRerender();
  },
  dpCalc,
  dpSubChange,
  dpHitChange,
  dpDirChange,
});
