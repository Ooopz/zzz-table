// src/lib/names.js —— 名称解析算法（通用：跨源变体名 → 标准名）。
// 实体词表(CATEGORY / 别名 / 归一化键策略)已迁至 src/game/entityNames.js（names 的**非函数**部分）；
// 本模块只保留解析/查找逻辑，数据从 game 取；为兼容旧 import 仍 re-export CATEGORY/别名（权威在 game）。
// 双端共用，禁止 import 任何 node: 模块。
import { normalize } from './util.js';
import { CATEGORY, CATEGORY_KEY, ALIASES, CHAR_ALIASES, DISC_ALIASES } from '../game/entityNames.js';
export { CATEGORY, CHAR_ALIASES, DISC_ALIASES };

/**
 * 构建名称索引。
 * @param {object|string[]} names  {规范名:条目}（library 表/实例集合）或 [规范名,…]（纯函数用）
 * @param {string} category  实体类别（CATEGORY.*）
 * @returns {{lib, category, keyFn, names, keys, byKey, byAlias, byAliasKey}}
 *   keys = 各规范名的归一化键（与 names 同序，供子串兜底复用）；byKey/byAlias/byAliasKey 均首见优先，
 *   byAlias 仅收录规范名在集合内的变体（防脏别名）。
 */
export function buildNameIndex(names, category) {
  const isArray = Array.isArray(names);
  const lib = isArray ? null : names || {};
  const list = isArray ? names : Object.keys(lib);
  const keyFn = CATEGORY_KEY[category] || normalize;
  const aliases = ALIASES[category] || {};
  const byKey = new Map();
  const byAlias = new Map();
  const byAliasKey = new Map();
  const keys = [];
  for (const name of list) {
    const k = keyFn(name);
    keys.push(k);
    if (!byKey.has(k)) byKey.set(k, name);
  }
  for (const [variant, canonical] of Object.entries(aliases)) {
    if (!list.includes(canonical)) continue;
    if (!byAlias.has(variant)) byAlias.set(variant, canonical);
    const k = keyFn(variant);
    if (!byAliasKey.has(k)) byAliasKey.set(k, canonical);
  }
  return { lib, category, keyFn, names: list, keys, byKey, byAlias, byAliasKey };
}

/**
 * 解析变体名 → 标准名。解析链：精确 → 别名(原串) → 别名(归一化键) → 归一化键 → 子串(char 专属)。
 * 歧义确定性：精确/别名优先于子串；子串兜底取最短规范名、同长按 zh localeCompare（结果确定）。
 * fuzzy=false 关闭子串兜底（默认 char 开、其余关）。
 */
export function resolveName(category, index, rawName, opts = {}) {
  if (rawName == null || rawName === '' || !index) return null;
  const keyFn = index.keyFn || CATEGORY_KEY[category] || normalize;
  const fuzzy = opts.fuzzy !== undefined ? opts.fuzzy : category === CATEGORY.CHAR;
  // 未构建（空/旧格式）索引防御；hasOwnProperty 而非 in：防 rawName 命中 Object.prototype（如 "constructor"）伪命中
  if (index.lib && Object.prototype.hasOwnProperty.call(index.lib, rawName))
    return { name: rawName, entry: index.lib[rawName], matchedBy: 'exact' };
  let canonical = index.byAlias?.get(rawName);
  if (canonical && (!index.lib || index.lib[canonical] != null))
    return { name: canonical, entry: index.lib?.[canonical] ?? null, matchedBy: 'alias' };
  const rawKey = keyFn(rawName);
  canonical = index.byAliasKey?.get(rawKey);
  if (canonical && (!index.lib || index.lib[canonical] != null))
    return { name: canonical, entry: index.lib?.[canonical] ?? null, matchedBy: 'alias' };
  if (index.byKey?.has(rawKey)) {
    const name = index.byKey.get(rawKey);
    return { name, entry: index.lib?.[name] ?? null, matchedBy: 'norm' };
  }
  if (fuzzy) {
    const hit = substringMatch(index, rawKey);
    if (hit) return { name: hit, entry: index.lib?.[hit] ?? null, matchedBy: 'fuzzy' };
  }
  return null;
}

/** 子串兜底：归一化键互相包含，取最短规范名（同长 zh 排序）；index.keys 预计算避免每次重算 keyFn */
function substringMatch(index, rawKey) {
  if (!rawKey) return null;
  const keys = index.keys || index.names.map(index.keyFn);
  const candidates = [];
  for (let i = 0; i < index.names.length; i++) {
    const k = keys[i];
    if (k.includes(rawKey) || rawKey.includes(k)) candidates.push(index.names[i]);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b, 'zh'));
  return candidates[0];
}

/** 消费端主入口：返回条目（找不到返回 null） */
export function resolveEntry(category, index, rawName, opts) {
  return resolveName(category, index, rawName, opts)?.entry ?? null;
}

/** 写时固化 / 迁移：返回标准名串（找不到返回 null） */
export function canonicalName(category, index, rawName, opts) {
  return resolveName(category, index, rawName, opts)?.name ?? null;
}

/** 写时固化便捷封装：解析为标准名，未命中保留原名；返回 { name, changed }（characters/plans/workshop 写前共用） */
export function canonicalize(category, index, rawName, opts) {
  if (rawName == null || rawName === '') return { name: rawName, changed: false };
  const name = canonicalName(category, index, rawName, opts);
  return name ? { name, changed: name !== rawName } : { name: rawName, changed: false };
}
