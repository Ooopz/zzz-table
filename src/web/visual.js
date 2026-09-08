// src/web/visual.js —— 视觉令牌「唯一权威」（纯数据 ESM，Node 可 import）
// 颜色/渐变端点/效果的全部数值都定义在这里；style.css :root 镜像这些值（首帧即有，不闪烁），
// 图表（canvas 读不了 CSS 变量）从本模块直接取。同步守卫 test/visual-sync.test.js 逐项核对 style.css，
// 任一侧改色不另一侧 → 测试红，杜绝「手工同步两份真相」的漂移。
// 字号/间距等纯 CSS 令牌仍以 style.css 为权威（canvas 用不到，不在此重复）。
// 依赖：无 node 内置、无 DOM（模块作用域）；applyVisualTokens/richWeb 用到 DOM/util 时才取。

// 配色体系（2026-09 重排）：
//   基底 = 中性炭（单暗色）；文字 = 暖米白四级灰阶（dim2 次级正文 ≥AA 对比）。
//   品牌主色 = 沉金（gold，警示黄退役后向金靠拢，无「警告」语义）；
//   副色 = 青瓷（jade，信息/数据/强调，站内唯一信息色——蓝 #56b8ff 退役归并于此）。
//   语义 = 绿(达标/完成) / 红(未达标/错误) / 琥珀(待办/缺口) / 紫(目标/定位)。
//   游戏文本色（--g-*）独立命名空间，按游戏原色近似，不入站点色板（引用内容与界面分层）。
//   警示线视觉（黄黑斜纹/警示带）已全移除，只剩品牌金细线；glow 走金/青瓷低强度。

import { renderRichText } from '../lib/util.js';

// ---------- 调色板（hex + rgb 三元组） ----------
const PALETTE = {
  // 基底（中性炭——bg 保持纯黑托高对比；卡/线整体提亮一格，避免层与层"发灰发淡"）
  bg: '#0a0a0a',
  bgRgb: '10,10,10',
  bgDeep: '#0d0d0d', // 凹槽/轨道黑
  card: '#161616',
  card2: '#1e1e1e',
  card3: '#292929',
  line: '#363636',
  line2: '#4c4c4c',
  // 文字（暖米白，对比加强）
  txt: '#f5f1e6', // 正文（≈17:1）
  dim: '#aaa498', // 次级说明（≈7:1）
  dim2: '#8f8a7c', // 三级说明（≈5:1，AA）
  dim3: '#6f6a60', // 最深档：仅供占位/禁用（低于 AA，有意为之）
  ink: '#0a0a0a',
  inkRgb: '10,10,10',
  // 品牌主色——沉金（替代警示黄；2026-09 曾调 #e6c54e 偏淡，提饱和+亮度至现值）
  gold: '#f2c944',
  goldRgb: '242,201,68',
  goldLt: '#f6dd8f', // 浅端（渐变顶）
  goldLt2: '#faf1c9', // 最浅（渐变顶端高光）
  goldTop: '#f7e6a6', // --grad-gold 渐变顶端（曾只在 style.css 硬编码，收编进色板防漂移）
  goldDk: '#a98424', // 深端（渐变底/按钮压暗）
  goldDk2: '#8b6d1e',
  // 副色——青瓷（信息/数据/强调，提亮提饱和）
  jade: '#41c6b2',
  jadeRgb: '65,198,178',
  jadeLt: '#9ae8da',
  jadeDk: '#25877a',
  // 语义（提亮提饱和，黑底上更醒目）
  red: '#ff7a6b',
  redRgb: '255,122,107',
  green: '#87db9d',
  greenRgb: '135,219,157',
  amber: '#efae3f',
  amberRgb: '239,174,63',
  purple: '#bd93ff',
  purpleRgb: '189,147,255',
  // 语义浅端（渐变端点，随主体提亮）
  redLt: '#ffc4bb',
  greenLt: '#cdeed6',
  amberLt: '#f6dc9f',
  purpleLt: '#e4d6ff',
  cardWarm: '#302e26', // 排序表头暖调底（淡金灰）
  // 稀有度（JS 徽章用）
  rarityS: '#ffa600',
  raritySLt: '#ffd75e',
  raritySRgb: '255,166,0',
  rarityA: '#8b5cff',
  rarityALt: '#a98bff',
  rarityADk: '#6a3fe0',
  rarityARgb: '139,92,255',
  // 图表补充色（仅 canvas 消费，不登 CSS 令牌）：站内统一分类色板的扩展（提亮）
  slate: '#7ba2cf', // 灰蓝（低拥有/中性）
  rose: '#e9b2d2', // 柔粉（非游戏霓虹粉）
  sage: '#a6bd73', // 苔绿
  steel: '#6d86a3', // 钢蓝（影画冷端）
  heatLo: '#232323',
  heatMid: '#b07a28', // 热力中段（琥珀褐，衔接金顶）
};

// ---------- 效果令牌（rgba / 阴影） ----------
const EFFECTS = {
  scrim: 'rgba(0,0,0,0.72)', // 弹窗遮罩
  texScan: 'rgba(255,255,255,0.012)', // 全局扫描线
  texStripe: 'rgba(255,255,255,0.07)', // 进度条扫描纹
  texSheen: 'rgba(255,255,255,0.028)', // 卡片顶部高光
  shadowSm: 'rgba(0,0,0,0.4)',
  shadowXl: 'rgba(0,0,0,0.62)',
};

// ---------- 游戏 <color=#HEX> → CSS 令牌（renderRichText 白名单） ----------
const GAME_COLORS = {
  '#FFFFFF': 'var(--g-white)',
  '#2BAD00': 'var(--g-green)',
  '#F0D12B': 'var(--g-gold)',
  '#2EB6FF': 'var(--g-blue)',
  '#98EFF0': 'var(--g-cyan)',
  '#FF5521': 'var(--g-orange)',
  '#FE437E': 'var(--g-pink)',
  '#FFA9DD': 'var(--g-pink-lt)',
  '#A6C5FD': 'var(--g-blue-lt)',
};
// 游戏色令牌值（写入 :root）。独立命名空间（Q12-B）：按游戏原色近似、可读于暗底，
// 刻意不与站点色板耦合——站点金是沉金 #f2c944、游戏文本金仍鲜亮 #ffd75e；电光青/粉只出现在游戏引用内容里。
const GAME_TOKEN_VALUES = {
  '--g-white': '#f2efe4',
  '--g-green': '#96e0a8',
  '--g-gold': '#ffd75e',
  '--g-blue': '#5cbaff',
  '--g-cyan': '#a2f1f2',
  '--g-orange': '#ffa06a',
  '--g-pink': '#ff86b0',
  '--g-pink-lt': '#ffb8d8',
  '--g-blue-lt': '#a9c9ff',
};

// ---------- 唯一权威：CSS 令牌名 → 值（style.css :root 必须镜像，守卫测试核对） ----------
const CSS_TOKENS = Object.freeze({
  // 基底
  '--bg': PALETTE.bg,
  '--bg-rgb': PALETTE.bgRgb,
  '--bg-deep': PALETTE.bgDeep,
  '--card': PALETTE.card,
  '--card2': PALETTE.card2,
  '--card3': PALETTE.card3,
  '--line': PALETTE.line,
  '--line2': PALETTE.line2,
  // 文字
  '--txt': PALETTE.txt,
  '--dim': PALETTE.dim,
  '--dim2': PALETTE.dim2,
  '--dim3': PALETTE.dim3,
  '--ink': PALETTE.ink,
  '--ink-rgb': PALETTE.inkRgb,
  // 品牌金（主）
  '--gold': PALETTE.gold,
  '--gold-rgb': PALETTE.goldRgb,
  '--gold-lt': PALETTE.goldLt,
  '--gold-lt2': PALETTE.goldLt2,
  '--gold-top': PALETTE.goldTop,
  '--gold-dk': PALETTE.goldDk,
  '--gold-dk2': PALETTE.goldDk2,
  // 副色青瓷
  '--jade': PALETTE.jade,
  '--jade-rgb': PALETTE.jadeRgb,
  '--jade-lt': PALETTE.jadeLt,
  '--jade-dk': PALETTE.jadeDk,
  // 语义
  '--red': PALETTE.red,
  '--red-rgb': PALETTE.redRgb,
  '--green': PALETTE.green,
  '--green-rgb': PALETTE.greenRgb,
  '--amber': PALETTE.amber,
  '--amber-rgb': PALETTE.amberRgb,
  '--purple': PALETTE.purple,
  '--purple-rgb': PALETTE.purpleRgb,
  // 语义浅端（渐变端点）
  '--red-lt': PALETTE.redLt,
  '--green-lt': PALETTE.greenLt,
  '--amber-lt': PALETTE.amberLt,
  '--purple-lt': PALETTE.purpleLt,
  '--card-warm': PALETTE.cardWarm,
  // 稀有度
  '--rarity-s': PALETTE.rarityS,
  '--rarity-s-lt': PALETTE.raritySLt,
  '--rarity-s-rgb': PALETTE.raritySRgb,
  '--rarity-a': PALETTE.rarityA,
  '--rarity-a-lt': PALETTE.rarityALt,
  '--rarity-a-dk': PALETTE.rarityADk,
  '--rarity-a-rgb': PALETTE.rarityARgb,
  // 图表辅助（热力；blue2/green2/rank-teal/rank-slate 已随「不要电光青」退役，仅 canvas 消费无需 CSS）
  '--heat-lo': PALETTE.heatLo,
  '--heat-mid': PALETTE.heatMid,
  // 游戏文本色（独立命名空间，不随站点色板换血）
  ...GAME_TOKEN_VALUES,
  // 效果
  '--scrim': EFFECTS.scrim,
  '--tex-scan': EFFECTS.texScan,
  '--tex-stripe': EFFECTS.texStripe,
  '--tex-sheen': EFFECTS.texSheen,
  '--shadow-sm': EFFECTS.shadowSm,
  '--shadow-xl': EFFECTS.shadowXl,
  // 旧名别名（JS 内联 style="var(--acc)" 兼容；指向品牌金）
  '--acc': 'var(--gold)',
  '--acc2': 'var(--gold)',
  '--acc-deep': 'var(--gold-dk)',
  '--acc-rgb': 'var(--gold-rgb)',
});

// ---------- 半透明派生（图表填充） ----------
const soft = (rgbTriple, alpha) => `rgba(${rgbTriple},${alpha})`;
const SOFT = {
  gold: soft(PALETTE.goldRgb, 0.28), // 品牌金软填充
  goldSoft: soft(PALETTE.goldRgb, 0.12), // 推荐带/模式空心等极浅
  gold85: soft(PALETTE.goldRgb, 0.85),
  jade: soft(PALETTE.jadeRgb, 0.28),
  jadeBar: soft(PALETTE.jadeRgb, 0.45),
  jadeBar70: soft(PALETTE.jadeRgb, 0.7),
  jadeArea: soft(PALETTE.jadeRgb, 0.16),
  jade35: soft(PALETTE.jadeRgb, 0.35),
  green55: soft(PALETTE.greenRgb, 0.55),
};

// ---------- 堆叠条调色板（discstats stackHtml + charts 共用）：站内统一分类十色 ----------
const STACK = [
  PALETTE.gold, // 金
  PALETTE.jade, // 青瓷
  PALETTE.purple, // 紫
  PALETTE.amber, // 琥珀
  PALETTE.green, // 沉稳绿
  PALETTE.red, // 珊瑚红
  PALETTE.slate, // 灰蓝
  PALETTE.rose, // 柔粉
  PALETTE.sage, // 苔绿
  PALETTE.dim, // 暖灰
];

// ---------- 影画金字塔（rankPyramidOption）冷→暖（0 影冷、6 影最醒目） ----------
const RANK = [
  PALETTE.steel, // 钢蓝
  PALETTE.slate, // 灰蓝
  PALETTE.jade, // 青瓷
  PALETTE.green, // 沉稳绿
  PALETTE.gold, // 金
  PALETTE.amber, // 琥珀
  PALETTE.red, // 珊瑚红
];

// ---------- 图表专属辅助色（分类补充/热力/金字塔等） ----------
const CHART_AUX = {
  slate: PALETTE.slate,
  rose: PALETTE.rose,
  sage: PALETTE.sage,
  steel: PALETTE.steel,
  heatLo: PALETTE.heatLo,
  heatMid: PALETTE.heatMid,
};

// ---------- ECharts 字号（canvas 读不了 CSS 变量，单源定死） ----------
const FONT = {
  axis: 12,
  axisSmall: 11,
  subtitle: 13,
  tooltip: 14,
  tiny: 10,
  label: 12,
};

// ---------- 图表容器高度（数据驱动公式的基准也归此） ----------
const CHART_HEIGHT = {
  default: 380,
  cross: 300,
  dpProb: 320,
  goalScatter: 280,
  metaBase: 320,
  metaPyramid: 380,
  sim3d: 540,
  sim2d: 430,
};

/** 启动时把 CSS_TOKENS 覆写到 :root（与 style.css 镜像双保险；浏览器才执行） */
export function applyVisualTokens() {
  if (typeof document === 'undefined' || !document.head) return;
  const css = Object.entries(CSS_TOKENS)
    .map(([k, v]) => `${k}:${v};`)
    .join('');
  let el = document.getElementById('zzz-tokens');
  if (!el) {
    el = document.createElement('style');
    el.id = 'zzz-tokens';
    document.head.appendChild(el);
  }
  el.textContent = `:root{${css}}`;
}

/** 网页富文本：游戏 <color=#HEX> 按白名单映射为 CSS 令牌（未知色 → inherit，杜绝任意色绕过令牌） */
export function richWeb(text) {
  return renderRichText(text, GAME_COLORS);
}

export { PALETTE, SOFT, STACK, RANK, CHART_AUX, FONT, CHART_HEIGHT, CSS_TOKENS };
