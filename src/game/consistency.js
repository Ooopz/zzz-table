// src/game/consistency.js —— 权威层防漂移自检（纯函数；开发/CI 跑，普通运行不调用）
// 目的：核心概念/规则只能在 src/game 内声明一处。这里用**结构性不变量**扫描，发现任何
// 重复声明漏项/越界/漂移（如曾把「穿透率」漏出百分比名单、成长表加了权威里没有的词条）就返回问题，
// 由测试在改动时立刻标红。规则：只断言**必然成立**的关系，避免对合法数据误报。
import { STAT, PANEL_ORDER, SUBSTAT, PERCENT_STATS, MULT_STATS, MAX_LEVEL_STATS,
         FIXED_SUBSTATS, DISC_SUBSTATS, DISC_SUBSTAT_SPECIAL_WEIGHTS, SKILL, SKILL_TYPES, OFFICIAL_SKILL_TYPE } from './constants.js';
import { substatGrowthTable, SLOT_FIXED_MAIN, DEFAULT_WEIGHTS, DP_ROW_PAIRS } from './discRules.js';

/** 重复元素 */
const dups = (arr) => arr.filter((x, i) => arr.indexOf(x) !== i);

/** 权威层一致性问题清单（空数组 = 通过） */
export function coreConsistencyIssues() {
  const issues = [];
  const push = (m) => issues.push(m);
  const statVals = Object.values(STAT);
  const subVals = Object.values(SUBSTAT);

  const d = dups(statVals);
  if (d.length) push(`STAT 值重复: ${[...new Set(d)].join(', ')}`);
  for (const [k, list] of [['PANEL_ORDER', PANEL_ORDER], ['MAX_LEVEL_STATS', MAX_LEVEL_STATS]]) {
    const dup = dups(list);
    if (dup.length) push(`${k} 重复: ${[...new Set(dup)].join(', ')}`);
    const unknown = list.filter((x) => !statVals.includes(x));
    if (unknown.length) push(`${k} 含非 STAT 名: ${unknown.join(', ')}`);
  }

  // 子集关系：派生集合必须 ⊆ 权威名单（穿透率漏项这类就是子集越权/漏报的温床）
  const subset = (label, set, allow) => {
    for (const v of set) if (!allow.includes(v)) push(`${label} 含未收录名: ${v}`);
  };
  subset('PERCENT_STATS', PERCENT_STATS, statVals);
  subset('MULT_STATS', MULT_STATS, statVals);
  subset('FIXED_SUBSTATS', FIXED_SUBSTATS, subVals);
  subset('DISC_SUBSTATS', DISC_SUBSTATS, subVals);

  // 10 维副词条体系对齐：候选/权重/行对/成长表必须同一套
  if (DISC_SUBSTATS.length !== DISC_SUBSTAT_SPECIAL_WEIGHTS.length)
    push(`DISC_SUBSTATS(${DISC_SUBSTATS.length}) 与权重(${DISC_SUBSTAT_SPECIAL_WEIGHTS.length}) 长度不一致`);
  if (DEFAULT_WEIGHTS.length !== DISC_SUBSTATS.length)
    push(`DEFAULT_WEIGHTS(${DEFAULT_WEIGHTS.length}) 与 DISC_SUBSTATS(${DISC_SUBSTATS.length}) 长度不一致`);
  for (const [i, j] of DP_ROW_PAIRS)
    if (i < 0 || j < 0 || i >= DISC_SUBSTATS.length || j >= DISC_SUBSTATS.length)
      push(`DP_ROW_PAIRS 下标越界: [${i},${j}]`);
  const pairDup = dups(DP_ROW_PAIRS.flat());
  if (pairDup.length) push(`DP_ROW_PAIRS 引用了重复下标: ${[...new Set(pairDup)].join(', ')}`);

  // 成长表(副副词条 S/A/B) 的键必须全在 SUBSTAT 权威内，且 S 档覆盖全量
  const growthKeys = new Set();
  for (const tier of ['S', 'A', 'B']) {
    const row = substatGrowthTable[tier] || {};
    for (const k of Object.keys(row)) {
      growthKeys.add(k);
      if (!subVals.includes(k)) push(`substatGrowthTable.${tier} 含非 SUBSTAT 名: ${k}`);
    }
  }
  for (const v of subVals) if (!growthKeys.has(v)) push(`成长表缺少副副词条: ${v}`);

  // 槽位固定主词条：只允许 123 槽、值须是权威属性
  if (Object.keys(SLOT_FIXED_MAIN).join(',') !== '1,2,3') push(`SLOT_FIXED_MAIN 槽位异常: ${Object.keys(SLOT_FIXED_MAIN)}`);
  for (const v of Object.values(SLOT_FIXED_MAIN)) if (!statVals.includes(v)) push(`SLOT_FIXED_MAIN 值非 STAT: ${v}`);

  // 技能类型：SKILL 0..5 齐全无重；SKILL_TYPES 与 SKILL 同源；OFFICIAL 映射落点合法
  const skillKeys = Object.values(SKILL).slice().sort((a, b) => a - b);
  if (skillKeys.join(',') !== '0,1,2,3,4,5') push(`SKILL 键不完整: ${skillKeys}`);
  const stKeys = SKILL_TYPES.map((t) => t.key).sort((a, b) => a - b);
  if (stKeys.join(',') !== skillKeys.join(',')) push(`SKILL_TYPES 键与 SKILL 不一致`);
  for (const [src, dst] of Object.entries(OFFICIAL_SKILL_TYPE))
    if (!(Number(dst) >= 0 && Number(dst) <= 5)) push(`OFFICIAL_SKILL_TYPE[${src}]→${dst} 越界`);

  return issues;
}

/** 断言权威层一致：有任一致命漂移即抛错（供开发自检 / CI 用） */
export function assertCoreConsistent() {
  const issues = coreConsistencyIssues();
  if (issues.length) throw new Error('[src/game 权威层自检失败]\n  - ' + issues.join('\n  - '));
}
