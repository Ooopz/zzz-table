// src/lib/util.js —— 环境无关的纯工具函数（Node 与浏览器共用）
// ⚠️ 禁止 import 任何 node: 模块（浏览器会直接 import 它）；Node 专属函数（如 openBrowser）放 ./node.js
import { STAT } from '../game/index.js';

/** 去 HTML 标签，折叠空白 */
export function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, '');
}

/** 归一化键名：去 HTML、只保留中文和数字（wiki 与账号接口两侧匹配 / 前端搜索） */
export function normalize(text) {
  return stripHtml(text).replace(/[^一-鿿0-9]/g, '');
}

/** 罗马数字 ASCII → Unicode（II→Ⅱ、VI→Ⅵ 等）。工坊源音擎名用 ASCII 罗马数字、wiki/方案用 Unicode，
 *  统一到 Unicode 使与 library 键一致。 */
const ROMAN_ASCII = { VIII: 'Ⅷ', III: 'Ⅲ', VII: 'Ⅶ', IV: 'Ⅳ', II: 'Ⅱ', VI: 'Ⅵ', IX: 'Ⅸ', V: 'Ⅴ', I: 'Ⅰ', X: 'Ⅹ' };
export function romanNumeralUnicode(s) {
  return String(s || '').replace(/VIII|III|VII|IV|II|VI|IX|V|I|X/g, (m) => ROMAN_ASCII[m] || m);
}
/** 名字匹配键：罗马数字统一为 Unicode 并保留——normalize 会剥掉罗马数字导致 Ⅰ/Ⅱ/Ⅲ 歧义，
 *  工坊源音擎名（如「残响-II型」）需靠它解析到 wiki 规范名 */
export function normalizeRomanKey(s) {
  return romanNumeralUnicode(s).replace(/[^一-鿿0-9ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, '');
}

/** cookie 字符串 → 对象；空返回 null */
export function parseCookies(cookieText) {
  const cookies = {};
  for (const kv of cookieText.split(';')) {
    const [k, ...v] = kv.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=');
  }
  return Object.keys(cookies).length ? cookies : null;
}

/** 对象 → cookie 字符串（parseCookies 的逆运算），请求头拼 cookie 用 */
export function serializeCookies(cookies) {
  return Object.entries(cookies || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// 说明：米游社 cookie 采集书签（旧 CLIPBOARD_SCRIPT）已移除 —— 登录令牌 ltoken(_v2) 现为 HttpOnly，
// 页面 JS（document.cookie/书签/控制台）一律读不到，只能从 DevTools → Network 请求头的 Cookie: 字段拷贝。

/** 转义用于 data-detail 属性（dataset 读取时还原，内嵌 HTML 照常渲染）。
 *  用 ?? 而非 ||：`escapeHtml(0)` 曾返回空串，把合法的 0 从 DOM 里抹掉。 */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** 安全嵌入 HTML 属性内的 JS 字符串（onclick="fn('...')"）。
 *  先 JS 转义 \ 与 '，再 HTML 转义 & " <——HTML 解码在 JS 执行前，两层缺一不可。 */
export function escapeJsAttr(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** 数值格式化展示（百分比 / 大数 / 特殊属性）。
 *  name 缺失时按无单位数值展示——此前无保护，畸形词条名会让整次面板计算抛错。 */
export function formatValue(name, value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (name == null || typeof name !== 'string') return String(value);
  if (name === STAT.ENERGY) return (Math.trunc(value * 100) / 100).toFixed(2);
  if (name.endsWith('加成') || name.includes('暴击')) return (value * 100).toFixed(1) + '%';
  if (Math.abs(value) <= 1) return (value * 100).toFixed(1) + '%';
  return (Math.round(value * 10) / 10).toLocaleString('zh-CN');
}

/** 解析数值：带 % 转成小数（"36%" → 0.36），纯数字原样；空串/非法 → null。兼容数字/字符串输入 */
export function parseNum(s) {
  if (s == null || s === '') return null;
  const str = String(s);
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return null;
  return str.includes('%') ? n / 100 : n;
}

/** 把「词条」统一成 [{name, value}]：兼容数组（新格式）与对象（旧格式/套装加成） */
export function statEntries(data) {
  if (Array.isArray(data)) return data.filter((t) => t && t.name != null && t.value != null);
  return Object.entries(data || {}).map(([name, value]) => ({ name, value }));
}

/** 表头排序通用比较：数字按数值、其余按中文 locale；null 排最后 */
export function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  // 数字与「数字字符串」混排统一按数值：全字符串 localeCompare 会把 "10" 排到 "9" 前（字典序）；中文名不会被 Number 误伤
  const na = numericLike(a),
    nb = numericLike(b);
  if (na != null && nb != null) return na - nb;
  return String(a).localeCompare(String(b), 'zh');
}
/** 可当数字比较的值（有限数字 / 非空数字字符串），否则 null */
function numericLike(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 空值判定（排序时空值行恒排最后）：null / undefined / 空字符串 */
export function isEmptyVal(v) {
  return v == null || v === '';
}

// ---------- 属性名归一化 ----------
/** 属性名别名 → 规范名（wiki 各角色用词不一；命破角色的专属名映射见下）。
 *  ⚠️ 惰性初始化：util 与 game 相互成环（game/disc.js 取 statEntries），本模块顶层解引用 STAT 会按模块求值顺序 TDZ——
 *  首次调用才取值（运行期环已解开）；util 顶层不得解引用 game 符号。 */
let STAT_ALIASES = null;
const statAliases = () => (STAT_ALIASES ??= {
  生命: STAT.HP,
  生命力: STAT.HP,
  生命指: STAT.HP, // wiki 邦布页面笔误（幽浮布初始面板把「生命值」写成「生命指」）
  攻击: STAT.ATK,
  防御: STAT.DEF,
  暴击: STAT.CR,
  暴伤: STAT.CD,
  // 贯穿力是命破角色独立面板属性（wiki 与账号均为本名），不归一化成穿透率；展示层合并
  贯穿率: STAT.PIERCE,
  闪能自动积累: STAT.ENERGY,
  闪能自动累积: STAT.ENERGY,
  闪能自动累计: STAT.ENERGY,
  // 「X伤害」→「X伤害加成」：不加泛化「伤害→伤害加成」以免误伤技能文本（修呼啸沙龙 set2「风属性伤害」泄漏）
  物理伤害: '物理伤害加成',
  物理属性伤害: '物理伤害加成',
  火属性伤害: '火属性伤害加成',
  冰属性伤害: '冰属性伤害加成',
  电属性伤害: '电属性伤害加成',
  雷属性伤害: '电属性伤害加成',
  风属性伤害: '风属性伤害加成',
  以太伤害: '以太伤害加成',
  流明伤害: '流明伤害加成',
  虚属性伤害: '虚属性伤害加成',
  // workshop 词条名变体（2025 源带「百分比」后缀、伤害加成用简写；统一到 plans/constants 体系供 discStatName 复用；
  // mys 源的百分比形态按值带 % 判定，不在此表）
  攻击力百分比: '攻击力%',
  生命值百分比: '生命值%',
  防御力百分比: '防御力%',
  暴击率百分比: STAT.CR,
  暴击伤害百分比: STAT.CD,
  穿透率百分比: STAT.PEN_RATE,
  异常掌控百分比: STAT.ANOMALY_CTRL,
  能量回复百分比: STAT.ENERGY,
  冲击力百分比: STAT.IMPACT,
  物伤加成百分比: '物理伤害加成',
  火伤加成百分比: '火属性伤害加成',
  冰伤加成百分比: '冰属性伤害加成',
  电伤加成百分比: '电属性伤害加成',
  以太加伤百分比: '以太伤害加成',
  风伤加成百分比: '风属性伤害加成',
});
/** 单个属性名归一化为规范名（未知名原样返回） */
export function normalizeStatKey(k) {
  return statAliases()[k] || k;
}

/** 词条名归一：把「百分比」写法转成 % 变体（攻击力百分比 → 攻击力%）；其余原样返回。
 *  来源接口（wiki/养成指南）对百分比词条命名不一，统一到 SUBSTAT 体系。 */
export function substatName(name) {
  return String(name || '').includes('百分比') ? name.replace('百分比', '%') : name;
}
/** 把对象的键按属性别名归一化为规范名（未知键原样保留，别名与规范名并存时规范名优先） */
export function normalizeStatKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const name = normalizeStatKey(k);
    if (k === name || !(name in out)) out[name] = v; // 规范键直接采用；别名仅在规范键缺席时采用
  }
  return out;
}

/** 游戏富文本 → 可渲染 HTML：把游戏标记 <color=#HEX> 转成 <span style="color">，
 *  把字面 \n 转成 <br>，保留标准 <span style> 与 wiki 描述性标签（p/strong/img/u…），移除可执行内容。
 *  数据里没有 <script>/<style> 块与事件属性，白名单放行的是 wiki 既有描述性标签，故采用「去活性」策略：
 *  ① 整块剥 <script> 与 <style>（style 可携 @import 外联）；② 剥事件属性 on*——必须覆盖「引号属性值后紧贴下一属性」
 *  的无空白变体（<img src="x"onerror=…>），单靠前导空白匹配会漏（历史坑）；③ 禁 javascript:/vbscript:/data: URL scheme。
 *  colorMap（可选）：#HEX → CSS 令牌名白名单——命中映射为令牌、未知色回退 inherit（杜绝任意色绕过令牌体系）。
 *  colorMap 缺省时保持原透传（lib 侧调用与既有测试不变）；web 侧用 visual.js 的 richWeb(text)。 */
export function renderRichText(text, colorMap = null) {
  if (text == null || text === '') return '';
  return String(text)
    .replace(/\\n/g, '<br>') // 字面反斜杠+n（游戏数据的换行）
    .replace(/\n/g, '<br>') // 真实换行符（兜底）
    .replace(/<color=([#\w]+)>/gi, (_m, color) =>
      colorMap ? `<span style="color:${colorMap[color.toUpperCase()] || 'inherit'}">` : `<span style="color:${color}">`
    )
    .replace(/<\/color>/gi, '</span>')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // 事件属性 on*：消费前导的空白/引号/<（引号是上一个属性值的闭合符，须保留，仅剥属性名=值）
    .replace(/([\s"'</])on[a-zA-Z][\w-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1')
    // URL scheme：src/href 等值以危险 scheme 开头时剥掉 scheme，值变无害（真实数据全为 https/相对路径）
    .replace(/(<(?:img|a|source|video|audio|iframe|link)\b[^>]*?\b(?:href|src)\s*=\s*)(["']?)\s*(?:javascript|vbscript|data):/gi, '$1$2');
}

/** 解码 HTML 实体（核心技档位 data-name 属性值是编码后的嵌套 HTML，需还原成富文本）；空值返回空串 */
export function decodeHtmlEntities(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** 命破角色贯穿力 = 0.3×攻击 + 0.1×生命（calc/simCalc 共用；任一缺失返回 null） */
export function pierceStat(a, h) {
  return a != null && h != null ? Math.round(0.3 * a + 0.1 * h) : null;
}

// ---------- 表头三态排序（自旧 sort.js 并入） ----------
/** 表头三态排序（asc→desc→复位）状态机 + 空值（null/undefined/空串）行恒排最后的排序应用；双端共享纯模块。
 *  返回 { key, dir, active, toggle(key), reset(), apply(list, val) }；apply 未激活时原样返回 list（保持原引用）；
 *  表头 ▲/▼ 指示由各视图自行渲染。 */
export function createSort() {
  let s = { key: null, dir: 1 };
  return {
    get key() {
      return s.key;
    },
    get dir() {
      return s.dir;
    },
    get active() {
      return s.key != null;
    },
    toggle(key) {
      if (s.key === key) s = s.dir === 1 ? { key, dir: -1 } : { key: null, dir: 1 };
      else s = { key, dir: 1 };
    },
    reset() {
      s = { key: null, dir: 1 };
    },
    apply(list, val) {
      if (!s.key) return list;
      const { key, dir } = s;
      return [...list].sort((a, b) => {
        const va = val(a, key),
          vb = val(b, key);
        if (isEmptyVal(va) && isEmptyVal(vb)) return 0;
        if (isEmptyVal(va)) return 1;
        if (isEmptyVal(vb)) return -1;
        return compareValues(va, vb) * dir;
      });
    },
  };
}

// ---------- 共享枚举（双端词表） ----------
/** 同步类型（server 的 syncState.kind + 前端进度轮询）。2026-09 自 game 迁出后再并入 util——双端词表无独立文件必要 */
export const SYNC_KINDS = Object.freeze({
  LIBRARY: 'library',
  CHARACTERS: 'characters',
  PLANS: 'plans',
  WORKSHOP: 'workshop',
});
