// src/web/charts.js —— ECharts 图表辅助（依赖 index.html 引入的本地 vendor window.echarts）：主题色 / 容器注册 / 渲染挂载 + 各图表 option 构建，视觉匹配项目暗色 + 金色主题
// 颜色/字号统一来自 visual.js（唯一权威，对应 style.css :root），本模块不重复声明色板
/* global echarts */
import { formatValue } from '../lib/util.js';
import { histCumPct, histPctValue } from '../lib/distStats.js';
import { PALETTE, SOFT, RANK, FONT, CHART_HEIGHT, CHART_AUX } from './visual.js';

/** 坐标轴/网格/标签（统一引用主题色） */
const AXIS_LINE = { lineStyle: { color: PALETTE.line } };
const AXIS_LABEL = { color: PALETTE.dim, fontSize: FONT.axis };
const AXIS_LABEL_SMALL = { ...AXIS_LABEL, fontSize: FONT.axisSmall }; // 多子图/紧凑图表
const SPLIT_LINE = { lineStyle: { color: PALETTE.line } };
const CHART_LEGEND = { textStyle: { color: PALETTE.dim }, top: 4 };
/** 多子图的小标题（每个子图上方） */
const CHART_SUBTITLE = { textStyle: { color: PALETTE.dim, fontSize: FONT.subtitle } };

let pending = {};
const instances = new Map();

/** 注册一个图表 option（渲染函数在返回 chartBox 时调用） */
export function registerChart(key, option) {
  pending[key] = option;
}
/** 清空待挂载（render 开头调用） */
export function clearCharts() {
  pending = {};
}
/** 生成图表容器 HTML（render 后由 mountCharts 初始化） */
export function chartBox(key, height = CHART_HEIGHT.default) {
  return `<div class="chart-init" data-chart="${key}" style="height:${height}px"></div>`;
}
/** 挂载所有 .chart-init 容器（render 分发后调用） */
export function mountCharts() {
  document.querySelectorAll('.chart-init').forEach((el) => {
    const key = el.dataset.chart;
    const opt = pending[key];
    if (!opt || typeof echarts === 'undefined') return;
    if (instances.has(key)) instances.get(key).dispose();
    const chart = echarts.init(el);
    chart.setOption(opt);
    instances.set(key, chart);
    // 读数参考线（option 带 readLine 标记时启用：小提琴图等需要按鼠标位置读数的场景）
    if (opt.readLine) attachReadLine(chart, opt);
  });
  pruneDetachedCharts();
}

/** 回收已从文档移除的图表实例（切视图/切角色时旧容器脱离文档，实例仍驻留 → canvas 泄漏）。
 *  ⚠️ 必须由 render() 在清空 grid 后无条件调用：从有图视图切到无图视图时
 *  render 提前 return 走不到 mountCharts，统计视图的图会永久驻留。 */
export function pruneDetachedCharts() {
  for (const [key, chart] of instances) {
    const dom = chart.getDom();
    if (!dom || !dom.isConnected) {
      chart.dispose();
      instances.delete(key);
    }
  }
}

/** 灰色读数参考线：随鼠标移动的横虚线 + 数值标签。
 *  option 需带 readLine: {attrs, densities, bins} 与预置 graphic（id: read-line / read-label）；
 *  数据元素上由原生 item tooltip 处理，空白处用 showTip 指向鼠标 y 对应的密度区间。
 *  用原生 DOM mousemove 而非 zrender 事件：canvas 空白处 DOM 事件可靠触发。 */
function attachReadLine(chart, opt) {
  const attrs = opt.readLine.attrs || [];
  const densities = opt.readLine.densities || [];
  const binsList = opt.readLine.bins || [];
  // vertical: 值在 x 轴（横向密度/箱线），读数线竖直、取 x 值；缺省为小提琴式（值在 y 轴，读数线水平）
  const vertical = !!opt.readLine.vertical;
  const dom = chart.getDom();
  const hide = () => {
    chart.setOption({
      graphic: [
        { id: 'read-line', invisible: true },
        { id: 'read-label', invisible: true },
      ],
    });
    chart.dispatchAction({ type: 'hideTip' });
  };
  // zrender 层标记：鼠标是否悬在数据元素上（数据元素由原生 item tooltip 处理，空白处由 showTip 接管）
  let onData = false;
  chart.on('mousemove', (e) => {
    onData = e.dataIndex != null;
  });
  chart.on('mouseout', () => {
    onData = false;
  });
  dom.addEventListener('mousemove', (e) => {
    const canvas = dom.querySelector('canvas');
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (px < 0 || py < 0 || px > r.width || py > r.height) return hide();
    // 找鼠标所在子图（实时取像素矩形，resize 后自动正确）
    for (let i = 0; i < attrs.length; i++) {
      const comp = chart.getModel().getComponent('grid', i);
      if (!comp) continue;
      const rect = comp.coordinateSystem.getRect();
      if (px < rect.x || px > rect.x + rect.width || py < rect.y || py > rect.y + rect.height) continue;
      const line = vertical
        ? { id: 'read-line', invisible: false, shape: { x1: px, y1: rect.y, x2: px, y2: rect.y + rect.height } }
        : { id: 'read-line', invisible: false, shape: { x1: rect.x, y1: py, x2: rect.x + rect.width, y2: py } };
      let label = { id: 'read-label', invisible: true };
      const v = chart.convertFromPixel({ gridIndex: i }, [px, py]);
      const vi = vertical ? 0 : 1;
      if (v && Number.isFinite(v[vi])) {
        // 可选 valueOf：把 X 轴原始值（如分位轴的分位 0-100）转成展示值（如分位→属性值）
        let text = `${attrs[i]} ${formatValue(attrs[i], v[vi])}`;
        if (opt.readLine.valueOf) {
          const out = opt.readLine.valueOf(i, v[vi]);
          if (out && out.value != null) {
            text = `${attrs[i]} ${out.pct != null ? `分位${Math.round(out.pct)}% · ` : ''}${formatValue(attrs[i], out.value)}`;
          }
        }
        label = {
          id: 'read-label',
          invisible: false,
          style: {
            text,
            x: vertical ? px + 6 : rect.x + 4,
            // vertical：值统一标在行底部（密度基底是 0，底部是空白区，永不遮挡/被图顶截断）
            y: vertical ? rect.y + rect.height - 4 : py - 6,
          },
        };
        // 空白处（未悬在数据元素上）：悬浮框显示鼠标 y 对应的密度区间（数值区间 + 玩家数 + 累计）；仅小提琴式
        if (!vertical && !onData) {
          const si = densities[i];
          const bins = binsList[i];
          if (si != null && bins && bins.length > 1) {
            let idx = 0;
            for (let j = 0; j < bins.length - 1; j++) {
              if (v[1] < bins[j + 1]) {
                idx = j;
                break;
              }
            }
            chart.dispatchAction({ type: 'showTip', seriesIndex: si, dataIndex: idx, position: [px + 14, py + 14] });
          }
        }
      }
      chart.setOption({ graphic: [line, label] });
      return;
    }
    hide();
  });
  dom.addEventListener('mouseleave', hide);
}
/** 窗口尺寸变化时 resize 所有已挂载图表（页面 resize 自动触发，防抖 150ms；
 *  多子图布局（技能分布/推荐三档等百分比 grid）依赖 resize 重算才能跟随容器宽度） */
function resizeCharts() {
  for (const c of instances.values()) {
    const dom = c.getDom();
    if (dom && dom.isConnected) c.resize(); // 跳过已脱离文档的实例（下次 mountCharts 会回收）
  }
}
if (typeof window !== 'undefined') {
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCharts, 150);
  });
}

// ---------- 公共 option 片段 ----------
/** 暗色 tooltip（统一悬浮风格） */
const DARK_TOOLTIP = {
  backgroundColor: PALETTE.card,
  borderColor: PALETTE.gold,
  textStyle: { color: PALETTE.txt, fontSize: FONT.tooltip },
};

// ---------- 各图表的 option 构建函数（数据由各视图面板准备） ----------

export function densityScatterOption(grid, mine = null) {
  const N = grid.N;
  const spanX = grid.xMax - grid.xMin || 1;
  const spanY = grid.yMax - grid.yMin || 1;
  const maxCount = grid.data.reduce((m, d) => Math.max(m, d[2]), 1);
  const pts = grid.data.map(([xi, yi, count]) => [
    +(grid.xMin + ((xi + 0.5) / N) * spanX).toFixed(4),
    +(grid.yMin + ((yi + 0.5) / N) * spanY).toFixed(4),
    count,
  ]);
  // 「我的」位置：金色菱形，超出玩家范围时扩展坐标轴保证可见
  const hasMine = mine && Number.isFinite(mine.x) && Number.isFinite(mine.y);
  const xMin = hasMine ? Math.min(grid.xMin, mine.x) : grid.xMin;
  const xMax = hasMine ? Math.max(grid.xMax, mine.x) : grid.xMax;
  const yMin = hasMine ? Math.min(grid.yMin, mine.y) : grid.yMin;
  const yMax = hasMine ? Math.max(grid.yMax, mine.y) : grid.yMax;
  const series = [
    {
      type: 'scatter',
      large: true,
      symbolSize: 9,
      data: pts,
      emphasis: { focus: 'series', itemStyle: { borderColor: PALETTE.txt } },
    },
  ];
  if (hasMine) {
    series.push({
      name: '我的',
      type: 'scatter',
      symbol: 'diamond',
      symbolSize: 13,
      itemStyle: { color: PALETTE.gold, borderColor: PALETTE.bg, borderWidth: 1 },
      data: [[mine.x, mine.y]],
      z: 5,
    });
  }
  return {
    // 无 echarts 标题（下拉栏充当标题）；无轴名文字（标题已标明是哪个属性对）
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => {
        if (p.seriesName === '我的') {
          return `<b>我的</b><br><b>${grid.xName}</b> ${formatValue(grid.xName, p.value[0])}<br><b>${grid.yName}</b> ${formatValue(grid.yName, p.value[1])}`;
        }
        return `<b>${grid.xName}</b> ${p.value[0]}<br><b>${grid.yName}</b> ${p.value[1]}<br>样本 ${p.value[2]}`;
      },
    },
    grid: { left: 52, right: 18, top: 8, bottom: 36 },
    xAxis: {
      type: 'value',
      min: xMin,
      max: xMax,
      axisLine: AXIS_LINE,
      axisLabel: AXIS_LABEL,
      splitLine: SPLIT_LINE,
    },
    yAxis: {
      type: 'value',
      min: yMin,
      max: yMax,
      axisLine: { show: false },
      axisLabel: AXIS_LABEL,
      splitLine: SPLIT_LINE,
    },
    series,
    visualMap: {
      min: 1,
      max: maxCount,
      dimension: 2,
      seriesIndex: [0], // 只给密度系列上色——我的点只有 [x,y] 两维，全局 visualMap 会把它涂成灰色看不见
      calculable: false,
      orient: 'vertical',
      right: 4,
      top: 'middle',
      inRange: { color: [PALETTE.line2, PALETTE.jade, PALETTE.gold] },
      textStyle: { color: PALETTE.dim },
    },
  };
}

/** 手风琴底部「面板分布」整合图：每属性一行，横向密度曲线（玩家聚集处）+ 推荐区间带 + 我的橙色圆点 + 目标紫色三角。
 *  **X 轴 = 玩家分位（0-100%）**——密度/我的点/目标点/推荐区间全部按直方图累计分位定位（lib/distStats.histCumPct），
 *  上下多属性行横向可比（同一分位对齐）；悬浮/读数线仍显示属性值（histPctValue 反查）。
 *  推荐带 = [中档中位数, 高档最大值(high.median+high.sd)] 映射到分位（目标要够高）。
 *  items = lib/panelAdvice.buildPanelItems 输出（[{attr, dist, low/mid/high:{median,sd}, mine, minePct, target, targetPct}]）。 */
export function panelDistOption(items) {
  const n = items.length;
  if (!n) return {};
  const rowH = 40; // 每行高
  const padTop = 8;
  // 推荐区间带：中档中位数 ~ 高档最大值（median+sd，「目标要够高」）；中档缺失回落低档
  const bandOf = (item) => ({
    low: item.mid?.median ?? item.low?.median ?? null,
    high: item.high ? (item.high.sd != null ? item.high.median + item.high.sd : item.high.median) : null,
  });
  const bands = items.map(bandOf);
  // 直方图累计分位：值→分位（定位）与分位→值（悬浮/读数线反查）
  const pctOf = (item, v) => histCumPct(v, item.dist?.hist) ?? null;
  const valOf = (item, pct) => histPctValue(pct, item.dist?.hist) ?? null;
  // 所有行共享同一 0-100 分位轴：固定左侧留白放属性名标签，不用 containLabel 按行自适应——
  // 各行标签长短不一会让绘图区宽度漂移、相同分位的虚线对齐线纵向错位。几何完全一致的网格 → 分位横向精确对齐。
  // 刻度标签只画在最后一行且落在网格外下方（containLabel:false），不再挤占末行绘图区高度（各行绘图区等高）。
  const labelW = Math.max(...items.map((i) => i.attr.length), 1) * 12 + 14; // 最长属性名宽 + 余量（中文 ≈ 12px/字）
  const grids = items.map((_, i) => ({
    left: labelW,
    right: 16,
    top: padTop + i * rowH,
    height: rowH - 8,
    containLabel: false,
  }));
  // X 轴：0-100 分位，四分位虚线网格（横向对齐标尺）；刻度标签只画在最后一行（0/25/50/75/100）
  const xAxis = items.map((item, i) => ({
    gridIndex: i,
    type: 'value',
    min: 0,
    max: 100,
    interval: 25,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: i === n - 1 ? { color: PALETTE.dim, fontSize: FONT.tiny, formatter: '{value}%' } : { show: false },
    splitLine: { show: true, lineStyle: { color: PALETTE.line, type: 'dashed', width: 1 } },
  }));
  // 每行两根 y 轴：类目轴（左侧属性名，正常字号、无标尺）+ 玩家数轴（密度高度，完全隐藏）
  const yAxis = items.flatMap((item, i) => {
    const maxCount = Math.max(...(item.dist?.hist?.counts || []), 1);
    return [
      {
        gridIndex: i,
        type: 'category',
        data: [item.attr],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: PALETTE.txt, fontSize: FONT.axis },
      },
      {
        gridIndex: i,
        type: 'value',
        min: 0,
        max: maxCount * 1.12, // 玩家数轴（给顶部圆点留头）
        axisLine: { show: false },
        axisLabel: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
    ];
  });
  const series = [];
  items.forEach((item, i) => {
    const hist = item.dist?.hist;
    const maxCount = Math.max(...(hist?.counts || []), 1);
    const b = bands[i];
    // 玩家密度：x = 各箱累计分位中点、y = 玩家数（分位轴上的密度），两端补 0 防平滑下冲
    const densData = [];
    if (hist?.counts?.length) {
      const counts = hist.counts;
      const total = counts.reduce((s, c) => s + c, 0) || 1;
      let acc = 0;
      const edges = [0]; // 每箱左缘累计分位
      for (let j = 0; j < counts.length; j++) {
        acc += counts[j];
        edges.push((acc / total) * 100);
      }
      densData.push([0, 0]);
      for (let j = 0; j < counts.length; j++) densData.push([(edges[j] + edges[j + 1]) / 2, counts[j]]);
      densData.push([100, 0]);
    }
    if (densData.length) {
      const bl = pctOf(item, b.low);
      const bh = pctOf(item, b.high);
      series.push({
        name: `${item.attr}|密度`,
        type: 'line',
        gridIndex: i,
        xAxisIndex: i,
        yAxisIndex: 2 * i + 1, // 玩家数轴（索引 2i 是属性名类目轴）
        data: densData,
        smooth: 0.4,
        symbol: 'none',
        lineStyle: { color: PALETTE.jade, width: 1 },
        areaStyle: { color: SOFT.jadeArea },
        // 推荐区间带：跨整行高度的浅黄竖条（markArea，值已映射到分位）
        markArea:
          bl != null && bh != null
            ? {
                silent: true,
                itemStyle: { color: SOFT.goldSoft },
                data: [[{ xAxis: bl }, { xAxis: bh }]],
              }
            : undefined,
        z: 2,
      });
    }
    // 我的值：橙色圆点 + 橙色虚线竖线，x = 我的分位（minePct，直方图累计口径）
    if (item.mine != null && item.minePct != null) {
      series.push({
        name: `${item.attr}|我的`,
        type: 'scatter',
        gridIndex: i,
        xAxisIndex: i,
        yAxisIndex: 2 * i + 1,
        data: [[item.minePct, maxCount]],
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: { color: PALETTE.gold, borderColor: PALETTE.bg, borderWidth: 1 },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: PALETTE.gold, type: 'dashed', width: 1 },
          data: [{ xAxis: item.minePct }],
          // markLine 默认标签在竖线顶端（我的圆点上方），第一行会被图顶截断 → 统一标到行底部
          label: {
            position: 'start',
            color: PALETTE.gold,
            fontSize: FONT.tiny,
            formatter: () => formatValue(item.attr, item.mine),
          },
        },
        z: 4,
      });
    }
    // 目标值：紫色三角 + 紫色实线竖线，x = 目标分位（targetPct，直方图累计口径）；未设目标不渲染
    if (item.targetPct != null) {
      series.push({
        name: `${item.attr}|目标`,
        type: 'scatter',
        gridIndex: i,
        xAxisIndex: i,
        yAxisIndex: 2 * i + 1,
        data: [[item.targetPct, maxCount]],
        symbol: 'triangle',
        symbolSize: 9,
        itemStyle: { color: PALETTE.purple, borderColor: PALETTE.bg, borderWidth: 1 },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: PALETTE.purple, type: 'solid', width: 1 },
          data: [{ xAxis: item.targetPct }],
          // 与「我的」同样标到行底部（markLine 默认在竖线顶端，第一行会被图顶截断）
          label: {
            position: 'start',
            color: PALETTE.purple,
            fontSize: FONT.tiny,
            formatter: () => `目标 ${formatValue(item.attr, item.target)}`,
          },
        },
        z: 3,
      });
    }
  });
  // 悬浮读数线/读数标签（attachReadLine 用 id 更新）：分位轴 → valueOf 把分位反查为属性值
  const graphic = [
    {
      id: 'read-line',
      type: 'line',
      invisible: true,
      silent: true,
      z: 50,
      shape: { x1: 0, y1: 0, x2: 0, y2: 0 },
      style: { stroke: PALETTE.dim, lineDash: [4, 3], lineWidth: 1 },
    },
    {
      id: 'read-label',
      type: 'text',
      invisible: true,
      silent: true,
      z: 50,
      style: {
        text: '',
        x: 0,
        y: 0,
        fill: PALETTE.txt,
        fontSize: FONT.axis,
        backgroundColor: PALETTE.card2,
        borderRadius: 2,
        padding: [2, 4],
      },
    },
  ];
  const tooltip = {
    ...DARK_TOOLTIP,
    formatter: (p) => {
      const [attr, kind] = (p.seriesName || '').split('|');
      const item = items.find((x) => x.attr === attr);
      if (!item) return '';
      const d = item.dist || {};
      const fmt = (v) => formatValue(attr, v);
      const lines = [`<b>${attr}</b>`];
      // 悬浮密度点：显示该分位的属性值（直方图累计反查）
      if (kind === '密度' && Array.isArray(p.value) && p.value.length) {
        const pct = p.value[0];
        const val = valOf(item, pct);
        lines.push(`分位 <b>${Math.round(pct)}%</b>${val != null ? ` → <b>${fmt(val)}</b>` : ''}`);
      }
      if (d.count != null) lines.push(`样本 <b>${d.count.toLocaleString()}</b> 人`);
      if (d.p10 != null && d.p90 != null && d.median != null) {
        lines.push(`玩家 <b>${fmt(d.p10)}</b> ~ <b>${fmt(d.p90)}</b>（中位 ${fmt(d.median)}）`);
      }
      const b = bandOf(item);
      if (b.low != null && b.high != null) {
        lines.push(`推荐区间 <b>${fmt(b.low)}</b> ~ <b>${fmt(b.high)}</b>`);
      }
      const tStr = ['low', 'mid', 'high']
        .map((t, ti) => {
          const tier = item[t];
          if (!tier) return null;
          return tier.sd != null
            ? `${['低', '中', '高'][ti]} ${fmt(tier.median)}±${fmt(tier.sd)}`
            : `${['低', '中', '高'][ti]} ${fmt(tier.median)}`;
        })
        .filter(Boolean)
        .join(' / ');
      if (tStr) lines.push(`三档 <b>${tStr}</b>`);
      if (item.target != null) {
        lines.push(
          `<span style="color:var(--purple)">目标 <b>${fmt(item.target)}</b>${item.targetPct != null ? `（分位 ${Math.round(item.targetPct)}%）` : ''}</span>`
        );
      }
      if (item.mine != null) {
        lines.push(
          `<span style="color:var(--gold)">我的 <b>${fmt(item.mine)}</b>${item.minePct != null ? `（分位 ${Math.round(item.minePct)}%）` : ''}</span>`
        );
      }
      return lines.join('<br>');
    },
  };
  return {
    grid: grids,
    xAxis,
    yAxis,
    tooltip,
    series,
    graphic,
    readLine: {
      attrs: items.map((x) => x.attr),
      vertical: true,
      valueOf: (i, pct) => {
        const val = valOf(items[i], pct);
        return val == null ? null : { value: val, pct };
      },
    },
    animation: false,
  };
}

// ================= 练度图（评分/影画/技能） / 驱动盘图 =================

/** 影画金字塔：每角色 0-6 影占比堆叠横条（ranks 为 7 个占比，合计 ≤100）；色序用 visual.js 的 RANK（冷→暖递进） */
export function rankPyramidOption(rows) {
  // rows: [{name, ranks: [p0..p6]}]
  const series = [0, 1, 2, 3, 4, 5, 6].map((r) => ({
    name: `${r} 影`,
    type: 'bar',
    stack: 'rank',
    data: rows.map((x) => x.ranks[r]),
    barWidth: 16,
    itemStyle: { color: RANK[r] },
  }));
  return {
    grid: { left: 90, right: 30, top: 36, bottom: 24, containLabel: true },
    tooltip: {
      ...DARK_TOOLTIP,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        const name = arr[0]?.name || '';
        const lines = arr
          .filter((p) => p.value > 0)
          .map((p) => `${p.marker}${p.seriesName} <b>${p.value.toFixed(1)}%</b>`);
        return `${name}<br>${lines.join('<br>')}`;
      },
    },
    legend: CHART_LEGEND,
    xAxis: {
      type: 'value',
      max: 100,
      axisLine: { show: false },
      axisLabel: { ...AXIS_LABEL, formatter: '{value}%' },
      splitLine: SPLIT_LINE,
    },
    // interval: 0 —— 角色名全部显示（默认自动间隔会隔一个显示一个）
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      axisLine: { show: false },
      axisLabel: { ...AXIS_LABEL, interval: 0 },
    },
    series,
  };
}

/** 全角色装配评分箱线图：盒 = P25-P75、线 = 中位、须 = IQR 1.5 规则（IQR 塌缩时退化为 P10/P90），
 *  悬浮显示分位明细与离群数 */
export function relicBarOption(rows) {
  // rows: [{name, median, p25, p75, whiskerLow, whiskerHigh, outliers, count}]
  return {
    grid: { left: 90, right: 50, top: 30, bottom: 24, containLabel: true },
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => {
        const d = p.data?.d || p.data;
        return `<b>${d.name}</b><br>须 ${d.whiskerLow ?? d.p10} ~ ${d.whiskerHigh ?? d.p90}<br>Q1 <b>${d.p25}</b> · 中位 <b>${d.median}</b> · Q3 <b>${d.p75}</b><br>样本 ${d.count}${d.outliers ? `（离群 ${d.outliers}）` : ''}`;
      },
    },
    xAxis: { type: 'value', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
    yAxis: { type: 'category', data: rows.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    series: [
      {
        type: 'boxplot',
        data: rows.map((r) => ({
          value: [r.whiskerLow ?? r.p10, r.p25, r.median, r.p75, r.whiskerHigh ?? r.p90],
          d: r,
        })),
        boxWidth: ['40%', '55%'],
        itemStyle: { color: SOFT.goldSoft, borderColor: PALETTE.gold },
        lineStyle: { color: PALETTE.gold },
      },
    ],
  };
}

/** 技能等级分布：每技能一个柱状子图（x=等级、y=玩家数），我的等级所在柱高亮金色。
 *  items: [{label, dist:{level:count}, mine, min?, max?}] —— dist 来自 skillStats 的逐等级计数；
 *  min/max 指定该技能的等级范围（如核心技固定 1-7），缺省用 dist 实际范围。
 *  compact（手风琴技能区第二行）：单行 6 列、去标题/坐标轴、我的柱不写字；目标（众数峰值）柱金描边；
 *  六图分隔线与达标绿调由 goalView 用 HTML 叠加（echarts grid 样式 / graphic 在本构建不可靠）。 */
export function skillDistOption(items, { compact = false } = {}) {
  const n = items.length;
  if (!n) return {};
  const COLS = compact ? 6 : 3;
  const rows = Math.ceil(n / COLS);
  const padX = compact ? 0 : 3.5; // compact 6 列无缝 = 与上方技能格 1/6 等宽列精确对齐
  const padY = compact ? 0.5 : 6;
  const gw = (100 - padX * (COLS + 1)) / COLS;
  const gh = (100 - padY * (rows + 1)) / rows;
  // 每技能独立等级范围：item.min/max 优先（如核心技 1-7），否则 dist 实际范围
  const levelOf = (it) => {
    const keys = Object.keys(it.dist || {}).map(Number);
    let lo = it.min != null ? it.min : keys.length ? Math.min(...keys) : 1;
    let hi = it.max != null ? it.max : keys.length ? Math.max(...keys) : 12;
    if (lo > hi) [lo, hi] = [hi, lo];
    const out = [];
    for (let l = lo; l <= hi; l++) out.push(l);
    return out;
  };
  const itemLevels = items.map(levelOf);
  const grids = items.map((_, i) => ({
    left: `${padX + (i % COLS) * (gw + padX)}%`,
    top: `${padY + Math.floor(i / COLS) * (gh + padY)}%`,
    width: `${gw}%`,
    height: `${gh}%`,
    containLabel: true,
  }));
  const titles = compact
    ? [] // 手风琴紧凑：技能身份由第一行图标承担，子图不加标题
    : items.map((item, i) => ({
        text: item.label,
        left: `${padX + (i % COLS) * (gw + padX) + gw / 2}%`,
        top: `${padY + Math.floor(i / COLS) * (gh + padY) - 2}%`,
        textAlign: 'center',
        ...CHART_SUBTITLE,
      }));
  const xAxes = items.map((_, i) => ({
    gridIndex: i,
    type: 'category',
    data: itemLevels[i],
    axisLine: compact ? { show: false } : AXIS_LINE,
    axisLabel: compact ? { show: false } : { ...AXIS_LABEL_SMALL, interval: 0 },
    axisTick: { show: false },
  }));
  const yAxes = items.map((_, i) => ({
    gridIndex: i,
    type: 'value',
    axisLine: { show: false },
    axisLabel: compact ? { show: false } : AXIS_LABEL_SMALL,
    splitLine: compact ? { show: false } : SPLIT_LINE,
  }));
  const series = items.map((item, i) => {
    const modeLv = compact ? item.mode : null;
    return {
      name: item.label,
      type: 'bar',
      gridIndex: i,
      xAxisIndex: i,
      yAxisIndex: i,
      barWidth: compact ? '55%' : '60%',
      data: itemLevels[i].map((lv) => {
        const count = item.dist?.[lv] || 0;
        const isMine = item.mine != null && lv === item.mine;
        // 目标（众数峰值）柱 = 金描边 + 微金底（空心金框）；我的等级 = 实心金 —— 实心 ≠ 空心，一眼分清「我在哪 / 该到哪」
        const isMode = compact && modeLv != null && lv === modeLv;
        return {
          value: count,
          itemStyle: {
            color: isMine ? PALETTE.gold : isMode ? SOFT.goldSoft : SOFT.jadeBar,
            borderColor: isMine ? PALETTE.gold : isMode ? SOFT.gold85 : 'transparent',
            borderWidth: isMine || isMode ? 1.5 : 0,
          },
          label: compact
            ? { show: false } // 手风琴紧凑：我的高亮柱不写字，细节走悬浮
            : {
                show: isMine && count > 0,
                position: 'top',
                color: PALETTE.gold,
                fontSize: FONT.axis,
                fontWeight: 'bold',
                formatter: `${count} 人`,
              },
        };
      }),
    };
  });
  return {
    title: titles,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      ...DARK_TOOLTIP,
      trigger: 'axis',
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        const p = arr[0];
        const lv = p?.name;
        const c = p?.value;
        if (lv == null) return '';
        // 按系列名（子图名 = item.label）定位当前子图，避免多子图下悬停非首图时误取 items[0] 的我的等级
        const it = items.find((x) => x.label === p.seriesName) || items[0];
        const mineMark =
          it?.mine != null && Number(lv) === it.mine ? '（<b style="color:var(--gold)">我的等级</b>）' : '';
        return `等级 <b>${lv}</b>${mineMark}<br>玩家数 <b>${c}</b>`;
      },
    },
    series,
  };
}
// ================= 驱动盘图表（驱动盘决策卡底部卡片区） =================

/** 456 主词条占比堆叠横条：y 轴 = 4/5/6 号位（3 行），每行内按主词条分段堆叠（每行合计 ≈100%）。
 *  detail = discDetails 条目（main456/mainDenom） */
/** 主词条 × 副词条协同热力图（mainSubCross）：4/5/6 槽并排，色 = 条件频率（count / 该槽盘数）。
 *  detail = discDetails 条目（mainSubCross/mainDenom）——「4 号位暴击率 → 暴伤 42%」式配装规律 */
export function mainSubCrossOption(detail) {
  const slots = [4, 5, 6];
  const grids = [];
  const xAxes = [];
  const yAxes = [];
  const series = [];
  const titles = [];
  slots.forEach((slot, i) => {
    const cross = detail?.mainSubCross?.[slot] || {};
    const mains = Object.keys(cross);
    const subs = [...new Set(mains.flatMap((m) => Object.keys(cross[m] || {})))];
    if (!mains.length || !subs.length) return;
    const denom = detail?.mainDenom?.[slot] || 1;
    const data = [];
    mains.forEach((m, mi) => {
      for (const [s, cnt] of Object.entries(cross[m] || {})) {
        data.push({ value: [subs.indexOf(s), mi, +(cnt / denom).toFixed(3)], m, s });
      }
    });
    const left = `${(i % 3) * 32 + 2}%`;
    grids.push({ left, top: '16%', width: '30%', height: '72%', containLabel: true });
    titles.push({
      text: `${slot} 号位`,
      left: `${(i % 3) * 32 + 17}%`,
      top: '1%',
      textAlign: 'center',
      ...CHART_SUBTITLE,
    });
    xAxes.push({
      gridIndex: i,
      type: 'category',
      data: subs,
      axisLine: AXIS_LINE,
      axisLabel: { ...AXIS_LABEL_SMALL, interval: 0, rotate: 40 },
      axisTick: { show: false },
    });
    yAxes.push({ gridIndex: i, type: 'category', data: mains, axisLine: { show: false }, axisLabel: AXIS_LABEL_SMALL });
    series.push({
      name: `${slot}号位`,
      type: 'heatmap',
      gridIndex: i,
      xAxisIndex: i,
      yAxisIndex: i,
      data,
      itemStyle: { borderColor: PALETTE.bg, borderWidth: 0.5 },
      emphasis: { itemStyle: { borderColor: PALETTE.gold, borderWidth: 1 } },
    });
  });
  if (!series.length) return {};
  return {
    grid: grids,
    title: titles,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) =>
        `<b>${p.seriesName}</b><br>主词条 ${p.data.m}<br>副词条 ${p.data.s}<br>条件频率 <b>${(p.value[2] * 100).toFixed(1)}%</b>`,
    },
    visualMap: {
      min: 0,
      max: 1,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 2,
      inRange: { color: [CHART_AUX.heatLo, CHART_AUX.heatMid, PALETTE.gold] },
      textStyle: { color: PALETTE.dim },
      formatter: (v) => (v * 100).toFixed(0) + '%',
    },
    series,
  };
}

/** 角色拥有率横向条：样本池（全部上榜去重 uid）中拥有该角色的占比，降序排列（类目轴首项在底部） */
export function roleOwnershipOption(rows) {
  return {
    animation: false,
    grid: { left: 90, right: 64, top: 10, bottom: 30, containLabel: true },
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => {
        const d = p.data?.d || p.data;
        return `<b>${d.name}</b><br>拥有率 <b>${d.rate.toFixed(1)}%</b><br><span style="color:${PALETTE.dim}">拥有 ${d.n.toLocaleString()} / ${d.pool.toLocaleString()} 名上榜玩家</span>`;
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLine: { show: false },
      axisLabel: { ...AXIS_LABEL, formatter: '{value}%' },
      splitLine: SPLIT_LINE,
    },
    yAxis: { type: 'category', data: rows.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL_SMALL },
    series: [
      {
        type: 'bar',
        barWidth: 10,
        data: rows.map((r) => ({ value: +r.rate.toFixed(1), d: r })),
        itemStyle: {
          color: (p) => (p.value >= 50 ? PALETTE.green : p.value >= 20 ? PALETTE.amber : PALETTE.slate),
        },
        label: { show: true, position: 'right', color: PALETTE.dim, fontSize: FONT.axisSmall, formatter: '{c}%' },
      },
    ],
  };
}

// ================= 驱动盘模拟（练度提升概率）图表 =================

/** 各位置「超过 / 保词条超过」概率双系列柱状图；items: [{pos, prob, probKeep}]（均为小数概率） */
export function dpProbBarOption(items) {
  return {
    animation: false,
    grid: { left: 52, right: 18, top: 40, bottom: 26, containLabel: true },
    legend: { ...CHART_LEGEND, data: ['超过', '保词条超过'] },
    tooltip: {
      ...DARK_TOOLTIP,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const arr = Array.isArray(ps) ? ps : [ps];
        const p = arr[0];
        if (!p) return '';
        return `<b>${p.name}</b><br>${arr
          .filter((x) => x.value != null)
          .map((x) => `${x.marker}${x.seriesName}：<b>${(x.value * 100).toFixed(4)}%</b>`)
          .join('<br>')}`;
      },
    },
    xAxis: { type: 'category', data: items.map((i) => `${i.pos}号位`), axisLine: AXIS_LINE, axisLabel: AXIS_LABEL },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { ...AXIS_LABEL, formatter: (v) => (v * 100).toFixed(1) + '%' },
      splitLine: SPLIT_LINE,
    },
    series: [
      {
        name: '超过',
        type: 'bar',
        barWidth: 13,
        data: items.map((i) => ({ value: +i.prob.toFixed(8), d: i })),
        itemStyle: { color: PALETTE.gold },
      },
      {
        name: '保词条超过',
        type: 'bar',
        barWidth: 13,
        data: items.map((i) => ({ value: +i.probKeep.toFixed(8), d: i })),
        itemStyle: { color: PALETTE.jade },
      },
    ],
  };
}

// ---------- 驱动盘清理视图（discstats.js 消费的判定表由 discCleaner 计算，图表复用 mainSubCross 等主词条×副词条协同 Option） ----------
