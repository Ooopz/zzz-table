// src/game/characterMeta.js —— 角色固有元数据枚举：属性(element)/职业(trait)/阵营(faction)
// 随角色更新会新增取值（新元素/新职业/新阵营），故运行期代码对未知值一律**放行**（当前按文本处理）；
// 一致性由 test/character-meta.test.js 对现有 data/library.json 校验兜底——新值出现时测试标红，枚举补录后转绿。
// 双端共用；经 src/game/index.js 单一出口暴露。
export const ELEMENT = Object.freeze({
  电: '电',
  冰: '冰',
  物理: '物理',
  风: '风',
  流明: '流明',
  火: '火',
  以太: '以太',
  凛刃: '凛刃',
  玄墨: '玄墨',
  烈霜: '烈霜',
});
export const TRAIT = Object.freeze({
  锋御: '锋御',
  强攻: '强攻',
  击破: '击破',
  支援: '支援',
  异常: '异常',
  命破: '命破',
  防护: '防护',
});
export const FACTION = Object.freeze({
  弗林特工坊: '弗林特工坊',
  空域巡戍局: '空域巡戍局',
  坎卜斯黑枝: '坎卜斯黑枝',
  怪啖屋: '怪啖屋',
  'H.S.O.S.6': 'H.S.O.S.6',
  达识结社: '达识结社',
  外务筹策局: '外务筹策局',
  法厄同: '法厄同',
  狡兔屋: '狡兔屋',
  都市秩序部: '都市秩序部',
  妄想天使: '妄想天使',
  云岿山: '云岿山',
  奥波勒斯小队: '奥波勒斯小队',
  反舌鸟: '反舌鸟',
  '防卫军·白银小队': '防卫军·白银小队',
  天琴座: '天琴座',
  卡吕冬之子: '卡吕冬之子',
  刑侦特勤组: '刑侦特勤组',
  维多利亚家政: '维多利亚家政',
  白祇重工: '白祇重工',
});
export const ELEMENT_SET = new Set(Object.values(ELEMENT));
export const TRAIT_SET = new Set(Object.values(TRAIT));
export const FACTION_SET = new Set(Object.values(FACTION));
