// src/web/metaOverview.js —— 「资料→总览」子面板：全服总览层（装配评分分布 / 影画档位金字塔 / 角色拥有率）。
// 原 statsView.js「全服总览」区块整体迁入（IA 重构：统计页退役）；2026-09 精简：只保留练度三图，
// 样本口径/共识度/评分×毕业度/集中度/属性相关 已删（对应统计聚合一并移除）。
import { plans, workshopStats } from './data.js';
import { escapeHtml } from '../lib/util.js';
import { registerChart, chartBox, rankPyramidOption, relicBarOption, roleOwnershipOption } from './charts.js';
import { CHART_HEIGHT } from './visual.js';
import { statsNotReady, roleKeyedMap } from './wsRoles.js';

function renderOverview() {
  const notReady = statsNotReady();
  if (notReady) return notReady;
  const roleNames = Object.values(plans).map((v) => v.name);

  // 角色拥有率：样本池（全部上榜去重 uid）中拥有该角色的占比，降序排列
  const ownMap = roleKeyedMap(workshopStats.roleOwnership);
  const poolUids = workshopStats.meta?.poolUids || 0;
  const ownRows = [];
  for (const name of roleNames) {
    const rate = ownMap.get(name);
    if (rate == null || !poolUids) continue;
    ownRows.push({ name, rate: rate * 100, n: Math.round(rate * poolUids), pool: poolUids });
  }
  ownRows.sort((a, b) => b.rate - a.rate);
  if (ownRows.length) registerChart('overview-ownership', roleOwnershipOption(ownRows));
  const ownTip = `<b>角色拥有率</b><br><span style="color:var(--dim)">口径：工坊配装样本池（排行榜上榜玩家的去重 uid 池，${poolUids.toLocaleString()} 人）中<b>拥有该角色</b>（该 uid 的账号数据里练了这个角色）的占比。<br>占比越高说明该角色在高练度玩家中越普及；结合「装配评分/影画」看：高拥有率 + 高练度 = 该角色的养成基准。</span>`;

  return `<div class="chart-grid">
    ${progressCardsHtml()}
    ${ownRows.length ? `<div class="chart-card" style="grid-column:1/-1"><h3>角色拥有率 <button class="chart-hint" data-hint="${escapeHtml(ownTip)}">?</button></h3>${chartBox('overview-ownership', Math.max(CHART_HEIGHT.metaBase, ownRows.length * 16))}</div>` : ''}
  </div>`;
}

/** 渲染「资料→总览」子面板（wiki.js 的 PANEL_RENDERERS 调用） */
export function renderMetaOverview() {
  return renderOverview();
}

/** 练度内容：装配评分分布 / 影画档位金字塔（返回 chart-card 片段，由 renderOverview 包 chart-grid） */
function progressCardsHtml() {
  if (!Object.keys(plans || {}).length) return '';
  const R = workshopStats;
  const roleNames = Object.values(plans).map((v) => v.name);
  const cards = [];

  // 1. 全角色装配评分箱线分布
  const relicMap = roleKeyedMap(R.relicStats);
  const relicRows = [];
  for (const name of roleNames) {
    const d = relicMap.get(name);
    if (!d || d.count == null) continue;
    relicRows.push({
      name,
      median: +d.median.toFixed(1),
      p10: +d.p10.toFixed(1),
      p90: +d.p90.toFixed(1),
      p25: +d.p25.toFixed(1),
      p75: +d.p75.toFixed(1),
      whiskerLow: d.whiskerLow != null ? +d.whiskerLow.toFixed(1) : null,
      whiskerHigh: d.whiskerHigh != null ? +d.whiskerHigh.toFixed(1) : null,
      outliers: d.outliers,
      count: d.count,
    });
  }
  if (relicRows.length) {
    registerChart('prog-relic', relicBarOption(relicRows));
    const tip = `<b>装配评分分布</b><br><span style="color:var(--dim)">每角色一条箱线（工坊装配评分 relic_point）：盒 = P25-P75、线 = 中位、须 = IQR 1.5 规则（塌缩时退化为 P10/P90），悬浮看分位明细与离群数</span>`;
    cards.push(
      `<div class="chart-card" style="grid-column:1/-1"><h3>装配评分分布 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>${chartBox('prog-relic', Math.max(CHART_HEIGHT.metaBase, relicRows.length * 18))}</div>`
    );
  }

  // 2. 影画金字塔（每角色 0-6 影占比）
  const rankMap = roleKeyedMap(R.rankDist);
  const pyramidRows = [];
  for (const name of roleNames) {
    const d = rankMap.get(name);
    if (!d) continue;
    const total = Object.values(d).reduce((a, v) => a + v, 0);
    if (!total) continue;
    pyramidRows.push({ name, ranks: [0, 1, 2, 3, 4, 5, 6].map((r) => +(((d[r] || 0) / total) * 100).toFixed(1)) });
  }
  if (pyramidRows.length) {
    // 按 0 影占比升序（0 影段为堆叠最左段，占比小的排前，形成金字塔递进）
    pyramidRows.sort((a, b) => a.ranks[0] - b.ranks[0]);
    registerChart('prog-pyramid', rankPyramidOption(pyramidRows));
    const tip = `<b>影画档位金字塔</b><br><span style="color:var(--dim)">每角色一条堆叠横条：玩家池 0-6 影画占比（钢蓝→灰蓝→青瓷→绿→金→琥珀→珊瑚红，影画越高越醒目）；按 0 影占比升序排列</span>`;
    cards.push(
      `<div class="chart-card" style="grid-column:1/-1"><h3>影画档位金字塔 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>${chartBox('prog-pyramid', Math.max(CHART_HEIGHT.metaPyramid, pyramidRows.length * 20))}</div>`
    );
  }

  return cards.join('');
}
