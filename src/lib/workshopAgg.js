// src/lib/workshopAgg.js —— 工坊配装数据（workshop.json）汇总纯函数（Node 与浏览器共用）
// 输入 workshop.json 的 entries（每条约一个玩家角色的配装），按角色/盘/玩家聚合出全部统计；
// 正式入口为 computeAllWorkshopStats 单遍历（见下方累加器说明），各公开单函数为测试/复用保留。
import { computeDist, quantileSorted } from './distStats.js';
import { canonicalName, CATEGORY } from './names.js';
import { normalizeStatKey } from './util.js';
import { mainStatName, SUBSTAT_TYPE_SET, MAIN_STAT_OPTIONS } from '../game/index.js';
import { substatRolls } from '../game/index.js';

/** 面板 final 值归一化：百分比字符串（"31.4%" → 0.314）与数值字符串/数字统一为数字；空串/纯空白 → null（缺失，不污染 min/count） */
function parsePanelFinal(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null; // 工坊接口非攻击三围常返回空串，视为缺失
    if (t.endsWith('%')) {
      const n = parseFloat(t);
      return Number.isFinite(n) ? n / 100 : null;
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function panelStats(arr) {
  return computeDist(arr);
}

// ---------- 累加器（accumulator）拆分说明（2026-08 性能重构） ----------
// 每个聚合拆成 add(entry)（逐条累加）+ finish()（收尾），原公开函数的签名与输出完全不变；
// computeAllWorkshopStats 建全部累加器后**一次** for 循环喂完再各自 finish（原 14 次全量流式遍历，每遍 ~27s）。
// ⚠️ 硬约束：累加器内部 Map/数组必须严格按「条目出现顺序」写入，否则键序/浮点累加顺序漂移，
// 输出与旧结果不再逐位相等；各聚合口径不同，不共享中间解析。

function runAcc(acc, entries) {
  for (const e of entries || []) acc.add(e);
  return acc.finish();
}

/** computeWorkshopStats 的累加器：音擎/套装条目数 + 每角色面板样本 */
function makeWorkshopStatsAcc() {
  const pMap = new Map(); // 角色 id -> {name, stats:{属性:[数值]}}
  return {
    add(e) {
      // 单条脏数据不应中断整轮聚合：computeAllWorkshopStats 把同一条喂给全部累加器，
      // 这里抛异常 = 2.13GB 全量重算（约 4 分钟）零产出。与其余累加器的守卫保持一致。
      if (!e) return;
      // 面板：按角色收集各属性最终值（wengines/discs 顶层聚合已删，不再累计音擎/套装）
      for (const p of e.panel || []) {
        const v = parsePanelFinal(p.final);
        if (v == null) continue;
        if (!pMap.has(e.role_id)) pMap.set(e.role_id, { name: e.role_id, stats: {} });
        const r = pMap.get(e.role_id);
        if (!r.stats[p.name]) r.stats[p.name] = [];
        r.stats[p.name].push(v);
      }
    },
    finish() {
      const panels = [...pMap.values()].map((r) => {
        const stats = {};
        for (const [k, vals] of Object.entries(r.stats)) stats[k] = panelStats(vals);
        return { name: r.name, stats };
      });
      // 只保留 panels（wengines/discs 顶层聚合无前端消费者，已删）
      return { panels };
    },
  };
}

/** 汇总工坊配装数据：panels 为每角色每属性的真实样本统计（百分比属性已归一化为小数）。 */
export function computeWorkshopStats(entries) {
  return runAcc(makeWorkshopStatsAcc(), entries);
}

/** 面板属性对配对样本采集（computePanelScatter 用）。
 *  ⚠️ 条目出现顺序决定 perRole/global 的 key 插入顺序——单遍历与逐个函数必须同序写入，否则输出键序漂移。 */
function makePanelPairsAcc(pairs) {
  const perRole = new Map(); // role -> Map<key, {x,y,xv,yv}>
  const global = new Map(); // key -> {x,y,xv,yv}
  for (const [x, y] of pairs) global.set(`${x}_${y}`, { x, y, xv: [], yv: [] });
  return {
    add(e) {
      if (!e || !Array.isArray(e.panel)) return;
      const vals = {};
      for (const p of e.panel) {
        if (!p || p.name == null) continue;
        const v = parsePanelFinal(p.final);
        if (v != null) vals[p.name] = v;
      }
      const role = String(e.role_id);
      for (const [x, y] of pairs) {
        if (vals[x] == null || vals[y] == null) continue;
        const key = `${x}_${y}`;
        let r = perRole.get(role);
        if (!r) perRole.set(role, (r = new Map()));
        let pr = r.get(key);
        if (!pr) r.set(key, (pr = { x, y, xv: [], yv: [] }));
        pr.xv.push(vals[x]);
        pr.yv.push(vals[y]);
        global.get(key).xv.push(vals[x]);
        global.get(key).yv.push(vals[y]);
      }
    },
    finish() {
      return { perRole, global };
    },
  };
}

function collectPanelPairs(entries, pairs) {
  return runAcc(makePanelPairsAcc(pairs), entries);
}

// ---------- 驱动盘单盘统计（工坊真实穿戴：主/副词条、槽位、角色） ----------
// 供「驱动盘」视图作「工坊真实」对比列；两源提取已同构（main=主词条、subs=全部副词条）。

/** workshop 词条名 → 规范名（归一化后已是规范名，直接走 normalizeStatKey 幂等；别名吸收见 util.js `STAT_ALIASES`）。 */
/** 盘槽位：优先 mys name 末尾 [N]，兜底 id 末位数字（1-6）；无法判定返回 0 */
function slotOf(eq) {
  const m = /\[(\d)\]$/.exec(eq.name || '');
  if (m) return Number(m[1]);
  const n = Number(String(eq.id ?? '').slice(-1));
  return Number.isFinite(n) && n >= 1 && n <= 6 ? n : 0;
}

// ---------- 副词条强化次数（roll）还原 + 角色有效词条权重 ----------
// ⚠️ substatRolls 权威在 discRules.js（规则 C4）；基数与 A3 成长表统一换算（百分比 = S 级成长值 × 100）。
// 为什么还原次数：旧「有效词条个数」99.95% 恒为 4 无区分度；value/base 99.9987% 恰为 1-6 整数（余 19 条异常靠 round+钳制兜底）。
// 注意「单盘总强化次数」恒为 8/9 无信息量，有区分度的是**落在角色有效词条上的次数**。
/** 副词条 → 权重表 key。⚠️ 落地权重表（workshop-weights.json / stats.weightJson）的 key 已是 CONSTANT 标准名
 *  （抽取时经 constants.WS_KEY_TO_STAT 映射，见 discRules.js:260 注释）；且权重表不区分百分比/固定值，
 *  攻击力% 与 攻击力 共用 base「攻击力」——故 % 变体剥 % 即得 key。仅遍历 SUBSTAT_TYPE_SET（10 个副词条），
 *  权重表里 伤害加成/冲击力/穿透率/能量自动回复/异常掌控 等主词条专用 key 天然不会命中。
 *  （历史坑：曾用归一化前的旧原始 key「暴击/暴伤/攻击…」，实测除 穿透值 外全部查空 → effDist 静默失真。） */
const weightKeyOf = (sub) => (sub.endsWith('%') ? sub.slice(0, -1) : sub);

/** 工坊角色默认流派权重 → 每角色的「副词条 → 权重」表（权重 >0 即有效副词条；缺 key = 该角色不吃这条属性）。 */
export function buildRoleSubstatWeights(weightJson) {
  const out = new Map();
  if (!weightJson) return out;
  for (const [rid, r] of Object.entries(weightJson)) {
    const faction = r && Array.isArray(r.factions) ? r.factions[0] : null;
    if (!faction) continue;
    const byKey = new Map();
    for (const it of faction.weights || []) if (it && it.key != null) byKey.set(it.key, Number(it.weight) || 0);
    const m = new Map();
    for (const sub of SUBSTAT_TYPE_SET) {
      const w = byKey.get(weightKeyOf(sub));
      if (w > 0) m.set(sub, w);
    }
    if (m.size) out.set(String(rid), m);
  }
  return out;
}

/** opts.weightJson → roleWeights（Map<role_id, Map<副词条,权重>>）。opts 已给 roleWeights 时直接用。
 *  驱动盘盘聚合需要它（有效强化次数口径），构建一次即可（纯查表，不影响任何 Map 插入顺序）。 */
function resolveRoleWeights(opts) {
  if (opts && opts.roleWeights instanceof Map) return opts.roleWeights;
  return buildRoleSubstatWeights(opts && opts.weightJson);
}

/** Map<名,次数> → [{name,count}] 按 count 降序（同频按首次出现序） */
function freqPairs(map) {
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** 按驱动盘套装聚合工坊真实配装（单盘级统计）。
 *  effDist 为**有效强化次数**分布（0-9，非旧「有效词条个数」），有效集合由 opts.weightJson/roleWeights 给出，
 *  缺失时退化为「全部合法副词条」；slotDist 为槽位分布（D7）；未解析到 library 的套装 / '其他' 跳过。 */
export function computeWorkshopDiscStats(entries, discIndex, opts = {}) {
  return runAcc(makeWorkshopDiscStatsAcc(discIndex, opts), entries);
}

function makeWorkshopDiscStatsAcc(discIndex, opts = {}) {
  const roleNameMap = opts.roleNameMap || null;
  const roleWeights = resolveRoleWeights(opts);
  const acc = new Map(); // 规范盘名 → 内部聚合
  const resolveSuit = (raw) => canonicalName(CATEGORY.DISC, discIndex, raw, { fuzzy: false });

  const add = (e) => {
    if (!e || !Array.isArray(e.equips)) return;
    const roleName = roleNameMap ? roleNameMap.get(String(e.role_id)) : String(e.role_id);
    if (roleName == null) return;
    // 该角色的有效副词条集合（工坊默认流派权重 >0）；无权重数据时 null = 退化为「全部合法副词条」
    const effW = roleWeights.get(String(e.role_id)) || null;
    for (const eq of e.equips) {
      if (!eq || !eq.suit) continue;
      const suit = resolveSuit(eq.suit);
      if (!suit || suit === '其他') continue;
      let a = acc.get(suit);
      if (!a)
        acc.set(
          suit,
          (a = {
            name: suit,
            equips: 0,
            chars: new Set(),
            main456: { 4: new Map(), 5: new Map(), 6: new Map() },
            mainDenom: { 4: 0, 5: 0, 6: 0 },
            subs: new Map(),
            effDist: new Map(), // 有效强化次数(0-9) → 盘数
            slotDist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, // D7 套装×槽位：该套装各槽位盘数
            combos: new Map(), // 副词条组合 key → 盘数
            mainSub: { 4: new Map(), 5: new Map(), 6: new Map() }, // 槽 → 主词条 → Map<副词条,次数>
          })
        );
      a.equips += 1;
      a.chars.add(roleName);
      const slot = slotOf(eq);
      if (slot >= 1 && slot <= 6) a.slotDist[slot] += 1;
      // 词条名清洗：丢弃含 U+FFFD 的坏名（工坊源头属性名被替换符污染，无法归一且污染图表显示）
      const cleanName = (n) => (n && !n.includes('\uFFFD') ? n : null);
      // 两源同构：subs=全部副词条、main[0]=主词条。白名单清洗：只留合法副词条（SUBSTAT_TYPE_SET）——
      // 2025 源偶发异常词条（实测 180/605k 件）丢弃；rolls 同步还原，effDist 为「有效强化次数」口径
      const subPairs = (eq.subs || [])
        .map((s) => {
          const n = s && s.name ? cleanName(normalizeStatKey(s.name)) : null;
          return n && SUBSTAT_TYPE_SET.has(n) ? { name: n, rolls: substatRolls(n, s.value) } : null;
        })
        .filter(Boolean);
      const subNames = subPairs.map((s) => s.name);
      // 主词条 mn 只算一次，频次与 ×副词条协同共用；仅统计该槽候选内的合法主词条（MAIN_STAT_OPTIONS）
      const main = Array.isArray(eq.main) && eq.main[0];
      const mn = main && main.name ? cleanName(mainStatName(normalizeStatKey(main.name))) : null;
      const mnOk = mn && (MAIN_STAT_OPTIONS[slot] || []).includes(mn);
      if (slot >= 4 && slot <= 6) {
        a.mainDenom[slot] += 1;
        if (mnOk) {
          a.main456[slot].set(mn, (a.main456[slot].get(mn) || 0) + 1);
          let bySub = a.mainSub[slot].get(mn);
          if (!bySub) a.mainSub[slot].set(mn, (bySub = new Map()));
          for (const n of subNames) bySub.set(n, (bySub.get(n) || 0) + 1);
        }
      }
      // 有效强化次数分布 + 副词条组合（原地排序序列化去重；effRolls/comboKey 各算一次）
      let effRolls = 0;
      for (const s of subPairs) if (!effW || effW.has(s.name)) effRolls += s.rolls;
      a.effDist.set(effRolls, (a.effDist.get(effRolls) || 0) + 1);
      if (subNames.length) {
        subNames.sort();
        const comboKey = JSON.stringify(subNames);
        a.combos.set(comboKey, (a.combos.get(comboKey) || 0) + 1);
      }
      for (const n of subNames) a.subs.set(n, (a.subs.get(n) || 0) + 1);
    }
  };

  const finish = () =>
    [...acc.values()].map((a) => {
      const effDist = {};
      for (const [k, v] of a.effDist) effDist[k] = v;
      const subCombos = [...a.combos.entries()]
        .map(([k, count]) => ({ combo: JSON.parse(k), count }))
        .sort((x, y) => y.count - x.count)
        .slice(0, 8);
      const mainSubCross = {};
      for (const slot of [4, 5, 6]) {
        const s = {};
        for (const [mn, bySub] of a.mainSub[slot]) {
          s[mn] = Object.fromEntries([...bySub.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6));
        }
        if (Object.keys(s).length) mainSubCross[slot] = s;
      }
      return {
        name: a.name,
        equips: a.equips,
        characters: [...a.chars].sort(),
        main456: { 4: freqPairs(a.main456[4]), 5: freqPairs(a.main456[5]), 6: freqPairs(a.main456[6]) },
        mainDenom: a.mainDenom,
        subs: freqPairs(a.subs),
        effDist, // {次数:盘数} 有效强化次数分布（落在佩戴角色有效副词条上的强化次数之和，0-9）
        slotDist: a.slotDist, // {1..6:盘数} D7 套装×槽位：看该套装被当 4 件套（1-4 槽多）还是 2 件套（5-6 槽多）用
        subCombos, // [{combo:词条[], count}] 副词条组合 Top8（降序）
        mainSubCross, // {4:{主词条:{副词条:次数}},...} 主词条×副词条协同（两源同构）
      };
    });

  return { add, finish };
}

// ---------- 面板属性对 2D 密度（暴击率×暴伤、攻击×暴伤 的玩家真实 trade-off） ----------
// 前端拿不到逐条 panel（workshop.json 2.13GB 不下发），聚合时降采样为 2D 密度网格；x/y 各自 min-max
// 归一到 [0,1]（量纲不同，归一后才同轴可比），原始范围存 xMin..yMax 供前端 tooltip 反算实际值。

/** 2D 密度网格：x/y 数组 → {min/max, N, data:[[xi,yi,count]]}（xi/yi 为 [0,N-1] 归一网格坐标；
 *  前端按均匀 bin 反算实际值，故只需存 N 而非 bin 边界数组） */
function bin2D(xv, yv, N) {
  const n = xv.length;
  if (!n) return null;
  let minX = xv[0],
    maxX = xv[0],
    minY = yv[0],
    maxY = yv[0];
  for (let i = 1; i < n; i++) {
    if (xv[i] < minX) minX = xv[i];
    if (xv[i] > maxX) maxX = xv[i];
    if (yv[i] < minY) minY = yv[i];
    if (yv[i] > maxY) maxY = yv[i];
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const xi = Math.min(N - 1, Math.floor(((xv[i] - minX) / spanX) * N));
    const yi = Math.min(N - 1, Math.floor(((yv[i] - minY) / spanY) * N));
    const k = xi * N + yi;
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  return {
    xMin: +minX.toFixed(4),
    xMax: +maxX.toFixed(4),
    yMin: +minY.toFixed(4),
    yMax: +maxY.toFixed(4),
    N,
    data: [...grid.entries()].map(([k, count]) => [Math.floor(k / N), k % N, count]),
  };
}

const SCATTER_PAIRS = [
  ['暴击率', '暴击伤害'],
  ['攻击力', '暴击伤害'],
  ['攻击力', '异常精通'],
  ['攻击力', '暴击率'],
];

function finishPanelScatter(perRoleAcc, globalAcc) {
  const N = 24;
  const toGrid = (g) => {
    const b = bin2D(g.xv, g.yv, N);
    return b ? { xName: g.x, yName: g.y, ...b } : null;
  };
  const perRole = {};
  for (const [role, pairs_] of perRoleAcc) {
    const o = {};
    for (const [key, g] of pairs_) {
      const grid = toGrid(g);
      if (grid) o[key] = grid;
    }
    if (Object.keys(o).length) perRole[role] = o;
  }
  const global = {};
  for (const [key, g] of globalAcc) {
    const grid = toGrid(g);
    if (grid) global[key] = grid;
  }
  return { perRole, global };
}

/** 每角色 / 全体 的面板属性对 2D 密度网格（供密度散点图）；perRole 按 role_id，攻击归一范围随粒度（该角色/全体）。 */
export function computePanelScatter(entries, pairs) {
  const { perRole, global } = collectPanelPairs(entries, pairs || SCATTER_PAIRS);
  return finishPanelScatter(perRole, global);
}

// ================= 练度指标聚合（全服总览 / 角色画像） =================

/** 轻量分布（无直方图/箱线，防 stats 膨胀）：count/min/max/mean/median/p10/p90。
 *  分位数统一走 quantileSorted（线性插值）——此前用最近秩，与 computeDist 定义不一致，同一份文件里 median 有两种含义。 */
function lightDist(vals) {
  const s = (vals || []).filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { count: 0, min: null, max: null, mean: null, median: null, p10: null, p90: null };
  return {
    count: n,
    min: s[0],
    max: s[n - 1],
    mean: s.reduce((a, v) => a + v, 0) / n,
    median: quantileSorted(s, 0.5),
    p10: quantileSorted(s, 0.1),
    p90: quantileSorted(s, 0.9),
  };
}

/** 每角色工坊装配评分（relic_point）分布（computeDist 全量）；0/非法评分排除（0 = 未带驱动盘/2025 源缺失）。 */
export function computeRelicStats(entries) {
  return runAcc(makeRelicStatsAcc(), entries);
}

function makeRelicStatsAcc() {
  const acc = new Map();
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      const v = Number(e.relic_point);
      if (!Number.isFinite(v) || v <= 0) return;
      if (!acc.has(e.role_id)) acc.set(e.role_id, []);
      acc.get(e.role_id).push(v);
    },
    finish() {
      const out = {};
      for (const [rid, vals] of acc) out[rid] = panelStats(vals);
      return out;
    },
  };
}

/** 每角色影画档位（rank 0-6）占比：供影画金字塔。 */
export function computeRankDist(entries) {
  return runAcc(makeRankDistAcc(), entries);
}

function makeRankDistAcc() {
  const acc = new Map();
  return {
    add(e) {
      if (!e || e.role_id == null || e.rank == null) return;
      let d = acc.get(e.role_id);
      if (!d) acc.set(e.role_id, (d = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }));
      const r = Number(e.rank);
      if (r >= 0 && r <= 6) d[r]++;
    },
    finish() {
      return Object.fromEntries(acc);
    },
  };
}

/** 角色拥有率：样本池（全部去重 uid）中拥有该角色（该 uid 有该角色条目）的占比。
 *  workshop.json 的 v3 响应含每 uid 的**全部**角色，故「拥有」= uid 集合包含该角色。 */
function makeRoleOwnershipAcc() {
  const perRole = new Map();
  const pool = new Set();
  return {
    add(e) {
      if (!e || e.role_id == null || e.uid == null) return;
      pool.add(String(e.uid));
      let s = perRole.get(e.role_id);
      if (!s) perRole.set(e.role_id, (s = new Set()));
      s.add(String(e.uid));
    },
    finish() {
      const roles = {};
      for (const [rid, s] of perRole) roles[rid] = pool.size ? s.size / pool.size : 0;
      return { pool: pool.size, roles };
    },
  };
}

/** 角色拥有率（公开函数：与 computeAllWorkshopStats 单遍历逐位相等） */
export function computeRoleOwnership(entries) {
  return runAcc(makeRoleOwnershipAcc(), entries);
}

/** 每角色各技能等级众数（{role_id: {canonical技能type: 等级}}）：供「技能养成进度」的目标等级。
 *  技能 type 已在 sync 落盘前归一 canonical（见 sync/characters.js、sync/workshop.js 的 OFFICIAL_SKILL_TYPE）；
 *  众数并列取更高等级（确定性）；脏条目（无 role_id / level 非正）跳过。 */
export function computeSkillLevelModes(entries) {
  return runAcc(makeSkillLevelModeAcc(), entries);
}

function makeSkillLevelModeAcc() {
  const acc = new Map(); // role_id → Map<type, Map<level, count>>（插入序 = 条目出现序，finish 归约与顺序无关）
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      for (const s of e.skills || []) {
        if (s.type == null || s.level == null) continue;
        const lv = Number(s.level);
        if (!Number.isFinite(lv) || lv <= 0) continue;
        const t = s.type;
        let byType = acc.get(e.role_id);
        if (!byType) acc.set(e.role_id, (byType = new Map()));
        let m = byType.get(t);
        if (!m) byType.set(t, (m = new Map()));
        m.set(lv, (m.get(lv) || 0) + 1);
      }
    },
    finish() {
      const out = {};
      for (const [rid, byType] of acc) {
        const row = {};
        for (const [type, m] of byType) {
          let bestN = 0;
          let bestLv = 0;
          for (const [lv, n] of m) {
            if (n > bestN || (n === bestN && lv > bestLv)) {
              bestN = n;
              bestLv = lv;
            }
          }
          row[type] = bestLv;
        }
        out[rid] = row;
      }
      return out;
    },
  };
}

/** 每角色 × 技能类型（canonical 编号，见 src/game SKILL_TYPES）的等级分布。
 *  技能 type 已在 sync 落盘前归一 canonical（见 sync/characters.js、sync/workshop.js 的 OFFICIAL_SKILL_TYPE，
 *  历史误判注记亦在彼处）。 */
export function computeSkillStats(entries) {
  return runAcc(makeSkillStatsAcc(), entries);
}

function makeSkillStatsAcc() {
  const acc = new Map(); // rid -> Map<type -> number[]>
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      for (const s of e.skills || []) {
        if (s.type == null || s.level == null) continue;
        const t = s.type;
        let byType = acc.get(e.role_id);
        if (!byType) acc.set(e.role_id, (byType = new Map()));
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t).push(s.level);
      }
    },
    finish() {
      const out = {};
      for (const [rid, byType] of acc) {
        out[rid] = {};
        for (const [type, vals] of byType) {
          const dist = {};
          for (const v of vals) dist[v] = (dist[v] || 0) + 1;
          out[rid][type] = { ...lightDist(vals), dist };
        }
      }
      return out;
    },
  };
}

// ---------- 加权词条效率分（强化次数 × 工坊角色流派权重） ----------
// workshop-weights.json 是工坊官方给每个角色的默认流派属性权重（0.2-1），与还原的强化次数相乘即
// 「加权词条效率分」——比 relic_point 透明（公式公开、前端可用同一张 weights 表对「我的盘」复算）。
// 口径：权重表不区分百分比/固定值（共用 key），沿用工坊原始口径不折算。

// 【已移除】computeCompleteness（音擎60/盘满级/评分≥P75 占比）——2026-08 实测三个维度全部退化：
// 样本池是上榜 uid（高练度玩家样本），音擎 60 级与盘满级是入场券（57 角色 w60/discMax 全为 1.0000），
// relicTop 是定义上的恒等式（全落 0.2500-0.2517），连同前端「完成度矩阵」卡一并删除。

// ---------- 单遍历总入口（2026-08 性能重构） ----------

/** 一次遍历 entries 完成全部聚合（当前 8 个累加器）；每个 key 与对应公开函数**逐位相同**（见文件顶部累加器说明）。
 *  ⚠️ opts.weightJson 必须传入：驱动盘 effDist（有效强化次数口径）依赖每角色有效副词条权重，
 *  缺失时退化为「全部合法副词条」。（rollEfficiency 累加器早已删除，注释不再提。）entries 仅消费一次（可为 generator）。 */

export function computeAllWorkshopStats(entries, discIndex, opts = {}) {
  const scatterAcc = makePanelPairsAcc(SCATTER_PAIRS);
  const wsAcc = makeWorkshopStatsAcc();
  // 权重表只解析一次，驱动盘盘聚合共用（纯查表，不影响任何 Map 插入顺序）
  const accOpts = { ...opts, roleWeights: resolveRoleWeights(opts) };
  const discAcc = makeWorkshopDiscStatsAcc(discIndex, accOpts);
  const relicAcc = makeRelicStatsAcc();
  const rankDistAcc = makeRankDistAcc();
  const skillAcc = makeSkillStatsAcc();
  const ownAcc = makeRoleOwnershipAcc();
  const levelModeAcc = makeSkillLevelModeAcc();

  // 唯一一次遍历：每条目喂给全部累加器。add 之间互不共享中间态，故顺序无副作用
  for (const e of entries || []) {
    wsAcc.add(e);
    discAcc.add(e);
    scatterAcc.add(e);
    relicAcc.add(e);
    rankDistAcc.add(e);
    skillAcc.add(e);
    ownAcc.add(e);
    levelModeAcc.add(e);
  }

  const scatter = scatterAcc.finish();
  return {
    stats: wsAcc.finish(),
    discDetails: discAcc.finish(),
    panelScatter: finishPanelScatter(scatter.perRole, scatter.global),
    relicStats: relicAcc.finish(),
    rankDist: rankDistAcc.finish(),
    skillStats: skillAcc.finish(),
    roleOwnership: ownAcc.finish(),
    skillLevelModes: levelModeAcc.finish(),
  };
}
