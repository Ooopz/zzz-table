// src/sync/workshop.js —— 爬取「绝区零工坊」全角色排名+玩家配装（下载/提取侧）：api.zzzmap.com，签名=MD5(key+参数排序)，无需 token
// 本模块只导出**函数**（供 server.js 同步中心「网页按钮」与 scripts/workshop-cli.mjs 调用），不含 CLI 参数解析；
// 命令行入口见 scripts/workshop-cli.mjs（--mode=rank|chars|grad|weights|full / --concurrency / --proxy）。
// 断点续爬以 workshop.json 实际内容为准（文件里没有的 uid 一律重爬，写文件原子 tmp+rename，不再用进度文件）；聚合/API/静态表/2025 源面板拆在 workshop-stats.js 等模块
import fs from 'node:fs';
import path from 'node:path';
import { romanNumeralUnicode, normalizeStatKey } from '../lib/util.js';
import { canonicalName, CATEGORY } from '../lib/names.js';
import { iterWorkshopFile, readLines, writeWorkshopFile, DATA_DIR, pool, writeJsonAtomic } from '../lib/nodeUtil.js';
import { apiGet, apiPost } from './workshop-api.js';
import { buildWorkshopStats, fetchWorkshopGrad, OUT_FILE } from './workshop-stats.js';
import { computeEnkaPanel, propName, RARITY_GROWTH } from './workshop-panel.js';
import { items } from './workshop-static.js'; // 装备表（buildCtx 的 ctx.items 供 2025 源配装映射）
import { loadNameIndexes, emptyNameIndexes, resolveWengineName } from './name-index.js';
import { sleep } from './mihoyo-api.js';
import { WS_KEY_TO_STAT } from '../game/index.js';

// 官方（工坊两源与米游社账号同一套）技能 type → canonical（游戏 2.0 槽序：0普攻 1闪避 2支援 3特殊 4终结 5核心）。
// 落盘前归一：data 里技能 type 一律 canonical，读取侧（workshopAgg/wsRoles/goalView）不再映射。
// ⚠️ 与 characters.js 各留一份（仿 collect.js↔mihoyo-api.js 自包含先例），改任一处必须同步另一处（test/official-skill-type.test.js 对账）。
// ⚠️ 历史误判（2026-08 修正）：曾假设 2025 源技能 type 是「游戏内嵌 1.x 技能 ID」（1 闪避/2 特殊/3,6 终结），
// 为此单设 WS2025_SKILL_TYPE 映射。实为误判——两源 type 编号是同一套官方语义（1 特殊/2 闪避/6 支援）。
// 暴露路径：耀嘉音（辅助）盘卡「闪避 12 级×90%、特殊 1 级×46%」反直觉；57 角色双源指纹交叉验证：
// mys 映射适配 43 / WS2025 映射仅 21，且两源逐词条等级分布几乎逐位相同（raw1 12级 90%/87%、raw2 1级 46%/46%）——
// 若两源语义真不同，同一玩家行为将同时是「人人满特殊」与「人人满闪避」，矛盾。
export const OFFICIAL_SKILL_TYPE = Object.freeze({ 0: 0, 1: 3, 2: 1, 3: 4, 5: 5, 6: 2 }); // 官方语义：0普攻 1特殊技 2闪避 3连携 5核心被动 6支援（无 4）

const WEIGHTS_FILE = path.join(DATA_DIR, 'workshop-weights.json'); // 角色默认流派权重（工坊有效词条口径）
// 名称索引（统一 resolver，library.json 为权威源）：工坊 nick_name 差异在写时解析回 wiki 标准名，保证与 library/plans 一致；
// library.json 缺失/损坏时降级为空索引（不归一、不崩——测试可直接 import 本模块）
const {
  char: libChars,
  wengine: libWengines,
  disc: libDiscs,
} = loadNameIndexes('工坊') ?? emptyNameIndexes();

// 每影画排行榜上限 ≈298 去重 uid（offset≥300 返回空），故 300 = 榜单全量；rank 固定全角色 × 300，不设额外参数
const PER_RANK = 300;
// v3 配装请求默认并发（调用方可传 concurrency 覆盖）：排名收集阶段每角色 7 影画组内并行，不占此并发；调高加速但响应大吃带宽，注意工坊 API 限流
const DEFAULT_CONCURRENCY = 6;

// ---------- 断点续爬：以文件实际内容为准（不再用进度文件） ----------
// 曾用 .workshop-progress.json 缓存「已爬 uid」，进度先于写文件 → 中断后跳过大量 uid 且残缺 entries 覆盖旧文件
// （实测 145830 条覆盖 9579/63842 uid 的数据丢失事故）。现改为跳过判断 = 文件实际覆盖的 uid 集合，缺的自动重爬（自愈），写文件原子化（tmp+rename）
// 崩溃续爬 = 旧文件断点：写入文件后爬的 uid 不在文件里 → 自动重爬，永不静默丢数据。

// ---------- 大文件流式处理（防 OOM：90 万+ 条全量进内存 ≈ 7GB，超 Node 默认 4GB 堆） ----------
/** 本次新增配装条目的暂存文件（每行一条完整 JSON，无 [ ] 头尾）：爬取中分批落盘，结束时与旧文件流式合并；崩溃残留直接删除（自愈重爬） */
const PART_FILE = path.join(DATA_DIR, '.workshop-part.json');
const PART_FLUSH = 10000; // 内存条目达该数即落盘一批（常驻 ~60MB + 序列化临时 ~30MB）

/** 把 entries 追加写进 PART 并**清空数组**（partCount 累计已落盘条数）。
 *  ⚠️ 不清空会每个 build 都触发 flush 重写全部条目，partCount 虚高（O(n²)）与写放大（曾现 870 万虚高计数）。 */
export function flushPart(entries, partCount, file = PART_FILE) {
  if (!entries.length) return partCount;
  const fd = fs.openSync(file, 'a');
  try {
    // 每条约一行（完整 JSON）：合并按行读取，跨块 UTF-8 天然安全（\n 不出现在多字节字符内）
    for (const e of entries) fs.writeSync(fd, JSON.stringify(e) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  const n = entries.length;
  entries.length = 0;
  return partCount + n;
}

/** 合并写出 workshop.json（分块 gzip，原子 tmp+rename）：旧文件逐块解码 + PART 逐行解码 → 重新分块压缩（收尾跑一次，全量重压 ~2 分钟可接受）。
 *  perChunk 可选（默认 WORKSHOP_PER_CHUNK），测试用小值强制多块。 */
export function mergeWorkshopFile({ meta, oldFile, partFile, partCount, outFile, perChunk }) {
  const entries = (function* () {
    // 旧文件已是分块 gzip：iterWorkshopFile 逐块解压
    if (oldFile && fs.existsSync(oldFile)) {
      for (const e of iterWorkshopFile(oldFile)) yield e;
    }
    if (partCount > 0 && partFile && fs.existsSync(partFile)) {
      for (const line of readLines(partFile)) {
        if (!line) continue;
        try {
          yield JSON.parse(line);
        } catch {
          /* 坏行丢弃（自愈：缺的 uid 下次自动重爬） */
        }
      }
    }
  })();
  writeWorkshopFile(outFile, entries, meta, perChunk);
}

// ---------- 提取玩家某角色的配装（兼容 mys 源 / 2025 源两种 item_json） ----------
// ctx = { weapons: system_weapons, artifacts: system_artifacts, items: 装备表 }

/** 角色是否「练满」：角色≥60 / 音擎≥60 / 6 块驱动盘全 15 级且全 R5（R4 盘上限 +12，R5 才是满配）；爬取时过滤未毕业角色。
 *  role 为 user_role/v3 的 role；mys 源字段 ij.weapon/ij.equip，2025 源 ij.Weapon/ij.EquippedList（大小写不同）。 */
export function isMaxedRole(role) {
  if (!role || !role.item_json) return false;
  if ((role.level ?? 0) < 60) return false;
  const ij = role.item_json;
  // 音擎等级（mys: ij.weapon.level；2025: ij.Weapon.Level）
  const wpnLv = ij.weapon ? ij.weapon.level : ij.Weapon ? ij.Weapon.Level : null;
  if (!(wpnLv >= 60)) return false;
  // 驱动盘：恰 6 块且每块 15 级。15 级仅 R5 可达（R4 上限 +12），故无需强查 rarity；
  // 但**显式**给出非 R5（如 R4）仍应拒——2025 源盘对象不暴露 rarity（undefined）按 15 级=R5 放行。
  // mys: ij.equip[]；2025: ij.EquippedList[].Equipment
  const discs =
    Array.isArray(ij.equip) && ij.equip.length ? ij.equip : Array.isArray(ij.EquippedList) ? ij.EquippedList : null;
  if (!discs || discs.length !== 6) return false;
  for (const d of discs) {
    const lv = d && d.level != null ? d.level : d && d.Equipment ? d.Equipment.Level : null;
    if (lv !== 15) return false;
    const rar = d && d.rarity != null ? d.rarity : d && d.Equipment ? d.Equipment.Rarity : null;
    if (rar != null && rar !== 5) return false;
  }
  return true;
}

export function extractBuild(v3Data, roleId, ctx) {
  const roles = (v3Data.data && v3Data.data.roles) || [];
  const role = roles.find((x) => String(x.item_id) === String(roleId));
  if (!role || !role.item_json) return null;
  const ij = role.item_json;
  // relic_point 写时归一为数字（工坊返回字符串如 "294.30"；0/缺失 = 未带驱动盘或 2025 源无评分，置 null 由聚合层过滤）
  const rp = Number(role.relic_point);
  const base = { level: role.level, rank: role.rank, relic_point: Number.isFinite(rp) && rp > 0 ? rp : null };
  // mys 源判定要「有实际数据」（数组非空）：2025 源的空 properties/equip 数组（[] 为 truthy）会误走 mys 分支返回空面板
  if ((ij.equip && ij.equip.length) || (ij.properties && ij.properties.length)) {
    // mys 源：工坊格式化结构（名称统一解析回 wiki 标准名 / 属性键归一）
    return {
      ...base,
      source: 'mys', // 源标记（技能 type 落盘前已归一 canonical，见 OFFICIAL_SKILL_TYPE）
      skills: (ij.skills || []).map((s) => ({ type: OFFICIAL_SKILL_TYPE[s.skill_type] ?? s.skill_type, level: s.level })),
      weapon: ij.weapon && {
        id: ij.weapon.id,
        name: ij.weapon.name
          ? resolveWengineName(libWengines, ij.weapon.name)?.name || romanNumeralUnicode(ij.weapon.name)
          : null,
        level: ij.weapon.level,
        rarity: ij.weapon.rarity,
        main: (ij.weapon.main_properties || []).map((p) => ({
          name: normalizeStatKey(p.property_name),
          value: p.base,
        })),
      },
      panel: (ij.properties || []).map((p) => ({
        name: normalizeStatKey(p.property_name),
        base: p.base,
        add: p.add,
        final: p.final,
      })),
      equips: (ij.equip || []).map((e) => {
        const suitName =
          e.equip_suit && e.equip_suit.name
            ? canonicalName(CATEGORY.DISC, libDiscs, e.equip_suit.name) || e.equip_suit.name
            : undefined;
        // 主/副词条与 2025 源同构（main=主词条、subs=全部副词条）；不提取 mys 独有 valid/all_hit 等——两源结构需一致
        return {
          id: e.id,
          name: e.name,
          level: e.level,
          rarity: e.rarity,
          suit: suitName,
          main: (e.main_properties || [])
            .filter((p) => p.property_name)
            .map((p) => ({ name: normalizeStatKey(p.property_name), value: p.base })),
          subs: (e.properties || [])
            .filter((p) => p.property_name)
            .map((p) => ({ name: normalizeStatKey(p.property_name), value: p.base })),
        };
      }),
    };
  }
  if (ij.Weapon || ij.EquippedList) {
    // 2025 源：游戏内嵌原始数据（面板经 enka_attrs_mapping 计算；音擎/驱动盘经装备表+系统字典映射）
    const w = ij.Weapon;
    const sysW = w && ctx.weapons.find((x) => String(x.item_id) === String(w.Id));
    const libW = sysW ? resolveWengineName(libWengines, sysW.nick_name) : null;
    const weapon = w && {
      id: w.Id,
      name: sysW ? (libW ? libW.name : romanNumeralUnicode(sysW.nick_name)) : null,
      level: w.Level,
      rarity: sysW ? sysW.level : null,
      main: [],
    };
    const equips = (ij.EquippedList || [])
      .map((slot) => {
        const eq = slot && slot.Equipment;
        if (!eq) return null;
        const item = ctx.items[String(eq.Id)];
        const suit = item && ctx.artifacts.find((x) => x.set_id === String(item.SuitId));
        // 套装名解析为 wiki 标准盘名（工坊 artifacts 名可能带尾随空格）
        const suitName = suit ? canonicalName(CATEGORY.DISC, libDiscs, suit.name) || suit.name : null;
        const main = eq.MainPropertyList && eq.MainPropertyList[0];
        // 主词条 PropertyValue 是「初始值」：S 级每级成长 = 初始×0.2（RARITY_GROWTH，5 级盘不在表内默认 0.2）。
        // 落地须补成长到该等级最终值，与 mys 源(满级最终值)同口径：最终 = 初始×(1+level×growth)，lv15(S)→×4。
        const growth = item ? RARITY_GROWTH[item.Rarity] ?? 0.2 : 0.2;
        const mainVal = main ? Math.round(main.PropertyValue * (1 + eq.Level * growth)) : null;
        return {
          id: eq.Id,
          name: suitName,
          level: eq.Level,
          rarity: item ? item.Rarity : null,
          suit: suitName,
          main: mainVal != null ? [{ name: propName(main.PropertyId), value: mainVal }] : [],
          subs: (eq.RandomPropertyList || []).map((p) => ({
            name: propName(p.PropertyId),
            value: p.PropertyValue * p.PropertyLevel,
          })),
        };
      })
      .filter(Boolean);
    return {
      ...base,
      source: '2025', // 源标记（技能 type 落盘前已归一 canonical，见 OFFICIAL_SKILL_TYPE）
      skills: (ij.SkillLevelList || []).map((s) => ({ type: OFFICIAL_SKILL_TYPE[s.Index] ?? s.Index, level: s.Level })), // 与 mys 源同构 {type, level}
      weapon,
      panel: computeEnkaPanel(ij),
      equips,
    };
  }
  return null;
}

// ---------- 规范归一化（新标准 2026-08）：mys/2025 两源写盘前清洗成单一格式 ----------
// 规范：subs/main 的 name = 规范属性名（攻击力%/暴击率…）、value = ×100 整数百分比（480 = 4.8%）或固定值整数；
// source 标记保留（仅样本覆盖统计消费）；rarity 整个丢弃（无下游消费，且 2025 weapon.rarity 实为武器等级，语义本不一致）。
// ⚠️ 这是全链路唯一按 source 转换值的地方——清洗后消费方一律不再按源分叉。
const PCT_SUBSTATS = new Set(['暴击率', '暴击伤害', '攻击力%', '生命值%', '防御力%', '穿透率']);
/** 规范词条名：攻击/生命/防御的值带 % → 加 % 变体；否则走别名归一（吸收 2025「攻击力百分比」等） */
function canonicalSubName(rawName, value) {
  if ((rawName === '攻击力' || rawName === '生命值' || rawName === '防御力') && String(value ?? '').includes('%')) {
    return rawName + '%';
  }
  return normalizeStatKey(rawName);
}
/** 规范词条值：percent → ×100 整数。判定 = 名字在 PCT_SUBSTATS **或** 字符串以 % 结尾（mys 穿透率 "24%" 曾漏乘，
 *  因名字归一后不在集合 → 存成 24 而非 2400；以 % 结尾兜底一切百分比字符串，固定值字符串无 % 不受影响）。
 *  数字值视为已是 ×100（mys 异常条目/2025 原样，600 → 600）——与旧 substatRolls 的 typeof 判别一致，
 *  再乘会 double-count（曾把 mys 数字 600 变 60000，roll 2→6）。固定值 → 整数。 */
function canonicalSubValue(source, name, rawValue) {
  const isStr = typeof rawValue === 'string';
  const n = Number(parseFloat(rawValue));
  if (!Number.isFinite(n)) return rawValue;
  if (PCT_SUBSTATS.has(name) || (isStr && /%$/.test(rawValue))) return isStr ? Math.round(n * 100) : Math.round(n);
  return Math.round(n);
}
function normalizeStat(source, stat) {
  if (!stat || stat.name == null) return null;
  const cname = canonicalSubName(stat.name, stat.value);
  return { name: cname, value: canonicalSubValue(source, cname, stat.value) };
}
/** 源回填：旧条目（无 source 字段）按 equips[].rarity 的**类型**判别（number → 2025、string → mys）。
 *  实测覆盖 100% 旧数据（每条 equips 的 rarity 单一类型、零混合、零缺失）；skills 顺序兜底不再使用（0.08% 误差不该烙进永久数据）。 */
function inferSource(e) {
  for (const eq of e.equips || []) {
    if (eq && eq.rarity != null) return typeof eq.rarity === 'number' ? '2025' : 'mys';
  }
  return null;
}
/** 单条目 → 规范格式（纯函数）：source 回填 + subs/main 规范化 + 删 rarity。爬取写盘前与 --mode=normalize 迁移共用。 */
export function normalizeEntry(e) {
  if (!e) return null;
  const out = { ...e };
  out.source = out.source === 'mys' || out.source === '2025' ? out.source : inferSource(out) || null;
  if (out.weapon) {
    if (Array.isArray(out.weapon.main)) {
      out.weapon.main = out.weapon.main.map((x) => normalizeStat(out.source, x)).filter(Boolean);
    }
    delete out.weapon.rarity;
  }
  if (Array.isArray(out.equips)) {
    out.equips = out.equips
      .map((eq) => {
        if (!eq) return null;
        const n = { ...eq };
        delete n.rarity;
        if (Array.isArray(n.main)) n.main = n.main.map((x) => normalizeStat(out.source, x)).filter(Boolean);
        if (Array.isArray(n.subs)) n.subs = n.subs.map((x) => normalizeStat(out.source, x)).filter(Boolean);
        return n;
      })
      .filter(Boolean);
  }
  return out;
}

// ---------- 主流程 ----------
/** 构建字典 ctx（音擎/驱动盘/装备表，供 2025 源配装映射）+ 角色列表（一次请求返回）。
 *  供 CLI（scripts/workshop-cli.mjs）与 fetchWorkshopData 复用。 */
export async function buildCtx() {
  const sys = await apiGet('/api/v1/system_data/public', {});
  return {
    ctx: {
      weapons: (sys.data && sys.data.system_weapons) || [],
      artifacts: (sys.data && sys.data.system_artifacts) || [],
      items,
    },
    roles: (sys.data && sys.data.system_roles) || [],
  };
}

/** 拉单个「角色 × 影画档」的排名行（最多 PER_RANK 条）：offset 串行翻页；接口硬性每页 50（limit 无效，rows<50 即拉完） */
async function fetchRankRows(itemId, rank) {
  const rows = [];
  let offset = 0;
  while (rows.length < PER_RANK) {
    const j = await apiGet('/api/v1/user_relic/ranking', {
      limit: 50,
      offset,
      type: 'role',
      role_id: itemId,
      part_index: null,
      role_level: null,
      role_rank: rank,
      weapon_id: null,
    });
    const page = (j.data && j.data.rows) || [];
    rows.push(...page);
    if (page.length < 50) break; // 拉完
    offset += 50;
  }
  return rows;
}

/** 排名收集：全角色（system_data 全部，随版本自动增长）× 7 影画 × PER_RANK → 去重 uid 集合。
 *  concurrency = 角色级并发（默认 6）；onProgress({step, done, total}) 供 server 进度轮询。 */
export async function collectRankings(onProgress, concurrency = DEFAULT_CONCURRENCY) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(
    `开始爬取：全角色 × 7 影画 × 每影画 ${PER_RANK} 条收集 uid，随后爬取每个 uid 下所有练满角色（≥60级 / 音擎≥60 / 6×15级盘且全 R5）\n`
  );
  const { ctx, roles } = await buildCtx();
  const targets = roles; // 全角色（不截断；system_data 新增角色自动纳入）
  console.log(`角色总数 ${roles.length}，本次收集全部\n`);

  // 收集排名（角色级并发；每角色 7 影画组内并行翻页——排名请求轻量，串行往返改一轮并行）
  const uidMap = new Map(); // uid -> [{role_id, rank}]
  let rankFetch = 0,
    roleDone = 0;
  await pool(targets, concurrency, async (t) => {
    const { item_id } = t;
    const pages = await Promise.all(Array.from({ length: 7 }, (_, rank) => fetchRankRows(item_id, rank)));
    let fetched = 0;
    pages.forEach((rows, rank) => {
      for (const r of rows) {
        if (!uidMap.has(r.uid)) uidMap.set(r.uid, []);
        uidMap.get(r.uid).push({ role_id: String(item_id), rank });
      }
      fetched += rows.length;
    });
    rankFetch += fetched;
    roleDone++;
    if (roleDone % 5 === 0 || roleDone === targets.length) console.log(`  排名收集 ${roleDone}/${targets.length}`);
    onProgress?.({ step: 'rank', done: roleDone, total: targets.length });
  });
  console.log(`\n排名条目 ${rankFetch}，去重 uid ${uidMap.size}\n`);
  return { ctx, roles, uidMap };
}

/** 角色信息下载：uidList → workshop.json（断点续爬：文件已有的 uid 跳过）+ 权重 + stats。
 *  concurrency = v3 请求并发（默认 6）。 */
export async function fetchBuilds(ctx, roles, uidList, onProgress, concurrency = DEFAULT_CONCURRENCY) {
  // 内存安全：恢复只收集 fileUids，本次新增分批落盘 PART（90 万+ 条全量进数组 ≈ 7GB 会 OOM）
  fs.rmSync(PART_FILE, { force: true }); // 清残留：上次崩溃的 PART 丢弃（缺失 uid 由自愈机制重爬）
  const fileUids = new Set(); // 旧文件实际覆盖的 uid（跳过判断唯一依据：文件里没有的 uid 一律重爬，自愈进度领先）
  let oldEntryCount = 0;
  if (fs.existsSync(OUT_FILE)) {
    for (const e of iterWorkshopFile(OUT_FILE)) {
      oldEntryCount++;
      if (e && e.uid) fileUids.add(e.uid);
    }
  }
  const newUids = [...new Set(uidList)].filter((u) => !fileUids.has(u));
  const skippedCount = uidList.length - newUids.length;
  console.log(
    `断点续爬：${uidList.length} 个目标 uid 中 ${skippedCount} 个已存在于 workshop.json（跳过），` +
      `本次实际爬取 ${newUids.length} 个` +
      (newUids.length ? '' : '；全部已缓存（如需重爬请删除 data/workshop.json）')
  );
  onProgress?.({ step: 'fetch', done: 0, skipped: skippedCount, total: newUids.length }); // 初始进度：前端从第一秒就显示跳过数
  let fail = 0,
    done = 0,
    consecutiveFail = 0; // 连续失败计数（防加剧风控：连续失败过多时暂停 60s）
  let entries = []; // 内存中未落盘的本次新增条目（达到 PART_FLUSH 即写入 PART）
  let partCount = 0;
  await pool(newUids, concurrency, async (uid) => {
    try {
      const j = await apiPost('/api/v1/user_role/v3', { uid, refresh: false, type: 'ranking' });
      const nick = j.data && j.data.nick_name;
      // 爬该 uid 下所有角色（不只排名上榜的角色），每角色一条；未毕业的跳过（见 isMaxedRole）
      const roles = (j.data && j.data.roles) || [];
      for (const role of roles) {
        if (!isMaxedRole(role)) continue;
        const build = extractBuild(j, role.item_id, ctx);
        if (build) {
          entries.push(normalizeEntry({ uid, role_id: String(role.item_id), nick, ...build }));
          if (entries.length >= PART_FLUSH) partCount = flushPart(entries, partCount);
        }
      }
      consecutiveFail = 0;
    } catch (e) {
      fail++;
      consecutiveFail++;
      if (fail <= 5) console.log(`  ✗ uid ${uid} 失败: ${e.message.slice(0, 90)}`); // 前几个失败打印原因（多为风控 HTML）
      if (consecutiveFail >= 20) {
        // 连续失败 = 风控激活中：暂停让限流缓解，避免无效请求加剧封禁
        console.log(`  ⚠ 连续失败 ${consecutiveFail} 个，疑似风控/限流，暂停 60 秒…`);
        await sleep(60000);
        consecutiveFail = 0;
      }
    }
    done++;
    onProgress?.({ step: 'fetch', done, skipped: skippedCount, total: newUids.length });
    if (done % 100 === 0) {
      console.log(
        `  uid 进度 ${done}/${newUids.length}，配装条目 ${oldEntryCount + partCount + entries.length}，失败 ${fail}`
      );
    }
  });
  partCount = flushPart(entries, partCount); // 最后一批落盘（此后 entries 为空）

  // 合并写 workshop.json（原子：tmp + rename）：meta + 旧文件 entries（流式复制）+ PART 裸流
  const totalCount = oldEntryCount + partCount;
  const outMeta = {
    scrapedAt: new Date().toISOString(),
    roles: roles.length,
    ranks: 7,
    perRank: PER_RANK,
    uidCount: uidList.length,
    entryCount: totalCount,
  };
  mergeWorkshopFile({ meta: outMeta, oldFile: OUT_FILE, partFile: PART_FILE, partCount, outFile: OUT_FILE });
  fs.rmSync(PART_FILE, { force: true }); // 合并完成，清理暂存

  // 角色默认流派权重 + 汇总：chars 更新后自动重算（--mode=weights 可单独跑，见 buildWeights）
  const weightJson = buildWeights(roles);
  // 角色 id → 规范名（grad 名已对齐 plans；供 discDetails 输出角色名）
  const roleNameMap = new Map(
    roles.map((r) => [
      String(r.item_id),
      canonicalName(CATEGORY.CHAR, libChars, r.nick_name, { fuzzy: true }) || r.nick_name,
    ])
  );
  buildWorkshopStats(roleNameMap, weightJson, totalCount); // 配装数据更新后自动生成汇总（含 weightJson，流式遍历防 OOM）
  console.log(
    `\n完成：本次新爬 ${done} 个 uid（跳过 ${skippedCount} 个已缓存，失败 ${fail}），` +
      `配装条目共 ${totalCount} 条写入 ${OUT_FILE}`
  );
  return { stats: { entries: totalCount } };
}

/** 全角色默认副词条权重（system_data 的 weight_json）独立落盘 + 返回（供 --mode=weights 单独跑，或 chars/full 复用）。
 *  ⚠️ 落盘前把工坊 key 映射为 CONSTANT 标准名（暴击→暴击率、精通→异常精通、掌控→异常掌控、生命→生命值、防御→防御力、加伤→伤害加成…），
 *  消费端（discProb 等）直接按标准名匹配，不做 workshop 适配层。 */
export function buildWeights(roles) {
  const weightJson = {};
  for (const r of roles) {
    const wj = r && r.weight_json;
    if (!wj) continue;
    weightJson[String(r.item_id)] = {
      ...wj,
      factions: (wj.factions || []).map((f) => ({
        ...f,
        weights: (f.weights || []).map((it) => ({ key: WS_KEY_TO_STAT[it.key] || it.key, weight: it.weight })),
      })),
    };
  }
  writeJsonAtomic(WEIGHTS_FILE, {
    meta: { scrapedAt: new Date().toISOString(), roles: Object.keys(weightJson).length },
    weights: weightJson,
  });
  return weightJson;
}

/** 同步 workshop-stats.json 的 weightJson 字段（前端经 /api/data 读它；仅 --mode=weights 单独跑时用，
 *  chars/full 流程由 buildWorkshopStats 直接并入，无需此步）。stats 缺失时仅告警（先跑全量或 rebuild:stats）。 */
export function syncStatsWeightJson(weightJson) {
  const statsFile = path.join(DATA_DIR, 'workshop-stats.json');
  if (!fs.existsSync(statsFile)) {
    console.warn('⚠️ 未找到 workshop-stats.json（前端暂不读新权重，需先跑 --mode=chars/full 或 rebuild:stats）');
    return;
  }
  const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  stats.weightJson = weightJson;
  writeJsonAtomic(statsFile, stats);
  console.log('✅ workshop-stats.json 的 weightJson 已同步');
}

/** 全量更新（server.js 同步中心「工坊数据」按钮调用）：grad → weights → rank → chars（chars 末尾自动重算 stats）。
 *  onProgress({step, done, total}) 供 server 进度轮询；opts.concurrency 覆盖默认并发（rank/chars 生效，grad 用默认 6）。 */
export async function fetchWorkshopData(onProgress, opts = {}) {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  try {
    await fetchWorkshopGrad(onProgress, 6); // ① 全角色配装统计（grad_stat 独立接口；失败只告警不抛）
  } catch (e) {
    console.warn(`[工坊全服统计] 更新失败（保留现有 workshop-grad.json）: ${e.message}`);
  }
  const { ctx, roles, uidMap } = await collectRankings(onProgress, concurrency); // ③ 排名收集 uid
  buildWeights(roles); // ② 默认副词条权重（权重与排名/配装独立，任何时机可跑；放在 rank 前拿到 roles 即可）
  return fetchBuilds(ctx, roles, [...uidMap.keys()], onProgress, concurrency); // ④ 角色信息下载 + 汇总
}
