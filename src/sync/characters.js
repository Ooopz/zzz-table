// src/sync/characters.js —— 通过米游社 cookie 拉取账号全部角色真实数据（交互式：自动开登录页、粘贴 cookie 回车）
// 运行: npm run sync:characters
// 输出: data/characters.json（全部角色）+ data/.cookie.json（cookie 缓存）

import readline from 'node:readline';
import { isMain, writeDataFile, openBrowser, pool } from '../lib/node.js';
import { parseCookies, parseNum } from '../lib/util.js';
import { canonicalize, CATEGORY } from '../lib/names.js';
import { validateCharacters } from '../lib/schema.js';
import { requestJson, fetchUid, MHY_UA, MHY_DEVICE } from './mihoyo-api.js';
import { loadNameIndexes } from './name-index.js';
// cookie 存储（原子写/读取）已收敛到 node.js，此处转发保持既有调用点（plans.js 等 import 本文件）；
// 本文件内部也要用（fetchMyCharacters 收尾缓存），故用 import + 再 export 双绑定
import { cacheCookies, readCookieCache } from '../lib/node.js';
export { cacheCookies, readCookieCache };

// ---------- 名称权威（写时归一） ----------
// library.json 为标准名权威源；缺失/损坏时降级为不归一（名称保持接口原样），并在同步时提示。
const libNameIndex = loadNameIndexes('账号音擎/驱动盘名');

/** 账号角色写时归一：音擎/驱动盘名解析为 library 标准名（占位名保留）；extractCharacter 保持纯函数，此层只在写文件前固化名称。 */
function normalizeCharacterOutput(c) {
  if (!libNameIndex || !c) return c;
  const wengine =
    c.wengine && c.wengine.name !== '未佩戴音擎'
      ? {
          ...c.wengine,
          name: canonicalize(CATEGORY.WENGINE, libNameIndex.wengine, c.wengine.name, { fuzzy: false }).name,
        }
      : c.wengine;
  const discs = (c.discs || []).map((d) =>
    d.set === '未佩戴驱动盘' || d.set === '未知'
      ? d
      : { ...d, set: canonicalize(CATEGORY.DISC, libNameIndex.disc, d.set, { fuzzy: false }).name }
  );
  return { ...c, wengine, discs };
}

// 参考 ZenlessZoneZero-Extractor/main.py 的请求头（未改动，保持原样可用）
const baseHeaders = {
  Host: 'api-takumi.mihoyo.com',
  Connection: 'keep-alive',
  Accept: 'application/json, text/plain, */*',
  'User-Agent': MHY_UA,
  Origin: 'https://act.mihoyo.com',
  'X-Requested-With': 'com.mihoyo.hyperion',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Referer: 'https://act.mihoyo.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

// 客户端模拟头（取自 mihoyo-api MHY_DEVICE 单一权威：App 升级需按新客户端抓包同步更新那里）
const CLIENT = {
  'x-rpc-app_version': MHY_DEVICE.app_version,
  'x-rpc-device_id': MHY_DEVICE.device_id,
  'x-rpc-device_name': MHY_DEVICE.device_name,
  'x-rpc-device_fp': MHY_DEVICE.device_fp,
  'x-rpc-sys_version': MHY_DEVICE.sys_version,
};

const recordHeaders = {
  Host: 'api-takumi-record.mihoyo.com',
  Connection: 'keep-alive',
  ...CLIENT,
  'x-rpc-platform': '2',
  'x-rpc-geetest_ext': '{"viewUid":"0","gameId":8,"page":"v1.1.4_#/zzz/roles/all","isHost":1}',
  'x-rpc-language': 'zh-cn',
  'User-Agent': MHY_UA,
  Accept: 'application/json, text/plain, */*',
  'x-rpc-page': 'v1.1.4_#/zzz/roles/all',
  'x-rpc-lang': 'zh-cn',
  Origin: 'https://act.mihoyo.com',
  'X-Requested-With': 'com.mihoyo.hyperion',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Referer: 'https://act.mihoyo.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ---------------- 交互：获取 cookie ----------------

function ask(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(promptText, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function fetchCookie() {
  console.log('\n① 将自动打开米游社个人主页，请先登录（登录过会自动跳转）。');
  openBrowser('http://user.mihoyo.com/');
  console.log('② 页面打开后按 F12 → Network，刷新/操作几下，点开任意一条发往 *.mihoyo.com 的请求；');
  console.log('③ 复制该请求 Request Headers → Cookie: 整段值（含 HttpOnly 登录令牌，很长，全部复制）。');
  const text = await ask('④ 请在这里粘贴复制到的 Cookie: 整段后回车: ');
  if (!text) throw new Error('未输入 cookie');
  return parseCookies(text) || {};
}

// ---------------- API 调用 ----------------

async function fetchCharacterList(cookies, uid) {
  const j = await requestJson(
    `https://api-takumi-record.mihoyo.com/event/game_record_zzz/api/zzz/avatar/basic?server=prod_gf_cn&role_id=${uid}`,
    { headers: recordHeaders, cookies }
  );
  const list = j.data?.avatar_list || [];
  console.log(`   角色列表: ${list.length} 个`);
  return list.map((x) => ({
    id: String(x.id),
    name: x.full_name_mi18n || x.name || String(x.id),
    icon: x.icon || '',
  }));
}

async function fetchCharacterDetail(cookies, uid, charId, page) {
  const headers = {
    ...recordHeaders,
    'x-rpc-page': page,
    'x-rpc-geetest_ext': `{"viewUid":"0","gameId":8,"page":"v1.1.4_#/zzz/roles/${charId}/detail","isHost":1}`,
  };
  const url = `https://api-takumi-record.mihoyo.com/event/game_record_zzz/api/zzz/avatar/info?id_list[]=${charId}&need_wiki=true&server=prod_gf_cn&role_id=${uid}`;
  return requestJson(url, { headers, cookies });
}

// ---------------- 数据提取 ----------------

/** {property_name, base}[] → [{name, value}]。用数组而非对象：同一盘可同时有「攻击力%」「攻击力固定」同名条目，对象会互相覆盖；数值走 parseNum。 */
function collectStats(arr) {
  const out = [];
  for (const p of arr || []) {
    const name = p?.property_name;
    if (!name) continue;
    const n = parseNum(p?.base);
    if (n == null) continue;
    out.push({ name, value: n });
  }
  return out;
}

/** 从 avatar/info 响应提取角色全部可获取数据（面板/装备/影画/技能/皮肤/潜能觉醒/equipPlan 等） */
export function extractCharacter(response) {
  const a = response?.data?.avatar_list?.[0];
  if (!a) return null;
  const panel = {};
  for (const p of a.properties || []) {
    const name = p.property_name;
    if (!name) continue;
    panel[name] = { base: parseNum(p.base), bonus: parseNum(p.add), final: parseNum(p.final) };
  }
  const w = a.weapon || {};
  const wengine = {
    name: w.name || '未佩戴音擎',
    level: w.level ?? null,
    refinement: w.star ?? w.refine_level ?? w.refine ?? 1,
    icon: w.icon || '',
    specialEffectTitle: w.talent_title || '',
    specialEffect: w.talent_content || '',
    mainStats: collectStats(w.main_properties),
    subStats: collectStats(w.properties),
  };
  const discs = (a.equip || []).map((e, i) => ({
    set: e.equip_suit?.name || e.name || '未知',
    slot: i + 1,
    level: e.level ?? null,
    icon: e.equip_suit?.icon || e.icon || '',
    rarity: e.rarity || 'S',
    mainStats: collectStats(e.main_properties),
    subStats: collectStats(e.properties),
  }));
  // 保留前 6 槽，缺失的槽位补空（防止某些角色没带满 6 盘）
  while (discs.length < 6)
    discs.push({ set: '未佩戴驱动盘', slot: discs.length + 1, level: null, mainStats: [], subStats: [] });
  return {
    name: (a.full_name_mi18n || a.name_mi18n || String(a.id)).replace(/\s+/g, ''),
    id: String(a.id),
    level: a.level ?? null,
    icon: a.role_square_url || a.group_icon_path || a.hollow_icon_path || a.icon || '',
    rarity: a.rarity || '',
    faction: a.camp_name_mi18n || '',
    panel,
    wengine,
    discs: discs.slice(0, 6),
    // ---------- 全量附加数据 ----------
    elementType: a.element_type ?? null,
    profession: a.avatar_profession ?? null,
    subElementType: a.sub_element_type ?? null,
    verticalPaintingColor: a.vertical_painting_color || '',
    usName: a.us_full_name || '', // 英文名
    skins: (a.skin_list || []).map((s) => ({
      id: s.skin_id,
      name: s.skin_name || '',
      square: s.skin_square_url || '',
      icon: s.skin_hollow_icon_path || '',
      color: s.skin_vertical_painting_color || '',
      unlocked: !!s.unlocked,
      rarity: s.rarity || '',
      isOriginal: !!s.is_original,
    })),
    mindscape: {
      rank: a.rank ?? 0, // 当前影画等级
      ranks: (a.ranks || []).map((r) => ({
        id: r.id,
        name: r.name || '',
        pos: r.pos,
        isUnlocked: !!r.is_unlocked,
        desc: r.desc || '', // 影画完整描述
      })),
    },
    skills: (a.skills || []).map((s) => ({
      type: s.skill_type, // 0普攻 1特殊技 2闪避 3连携 5核心被动 6支援
      level: s.level,
      items: (s.items || []).map((it) => ({
        title: it.title || '',
        text: it.text || '',
        awaken: !!it.awaken,
      })),
    })),
    skillAwaken: a.skill_awaken
      ? {
          hasSystem: !!a.skill_awaken.has_awaken_system,
          level: a.skill_awaken.awaken_level ?? 0,
          maxLevel: a.skill_awaken.awaken_max_level ?? 0,
          items: a.skill_awaken.skill_awaken_items || [],
        }
      : null,
    equipPlan: a.equip_plan_info || null, // 装备规划/配装评分
  };
}

// ---------------- 主流程 ----------------

/** 用 cookie 抓取全部角色并写入 data/characters.json，供命令行与 server.js 复用。
 *  opts.strict 为 true 时校验异常直接抛错（命令行 STRICT=1 开启）。 */
export async function fetchMyCharacters(cookies, onProgress, { strict = false } = {}) {
  console.log('\n④ 获取 UID…');
  const uid = await fetchUid(cookies, baseHeaders);
  console.log(`   绑定角色 uid: ${uid}`);

  console.log('⑤ 获取角色列表…');
  const charList = await fetchCharacterList(cookies, uid);

  console.log('⑥ 并发拉取角色详情…（并发 3，避免触发接口风控）');
  // 复用 lib/node.js 的并发池：结果按下标对齐，顺序与角色列表一致；失败项为 null，最后过滤
  const results = (
    await pool(
      charList,
      3,
      async (it, i) => {
        try {
          const response = await fetchCharacterDetail(cookies, uid, it.id, `v1.1.4_#/zzz/roles/${it.id}/detail`);
          const extracted = extractCharacter(response);
          if (extracted) {
            extracted.icon = extracted.icon || it.icon;
            console.log(`   ${i + 1}/${charList.length} ${extracted.name}（等级${extracted.level}）`);
            return extracted;
          }
          console.error(`   ${i + 1}/${charList.length} ${it.name}: 提取失败`);
        } catch (e) {
          console.error(`   ${i + 1}/${charList.length} ${it.name}: 失败 ${e.message}`);
        }
        return null;
      },
      (done, total) => onProgress?.(done, total)
    )
  ).filter(Boolean);

  if (!results.length) throw new Error('一个角色都没拉到，请检查 cookie 是否过期');

  const data = results.map(normalizeCharacterOutput);
  const stats = { characters: results.length };

  writeDataFile('characters.json', data, { label: '我的角色', validate: validateCharacters, strict });

  return { data, stats, uid };
}

async function main() {
  const cookies = await fetchCookie();
  cacheCookies(cookies);
  const { stats } = await fetchMyCharacters(cookies, null, { strict: !!process.env.STRICT });
  console.log(`\n完成！共 ${stats.characters} 个角色。`);
  console.log('  data/characters.json 已生成');
}

// ESM 入口判断：仅当直接运行本文件时执行 main()
isMain(import.meta, () => main());
