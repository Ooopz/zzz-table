// src/game/wengine.js —— 音擎实体域：Wengine 模型类
// 当前仅数据归一化，无规则计算（音擎数值规则在 lib/calc.js：atkWhiteValue 等）；新音擎规则落本文件。
/** 音擎基类 */
export class Wengine {
  constructor(data = {}) {
    // 账号版：name/level/refinement/mainStats/subStats；wiki 版：baseAtk/subStatsText…
    this.name = data.name || '未佩戴音擎';
    this.id = data.id ?? null;
    this.level = data.level ?? null;
    this.refinement = data.refinement ?? data.star ?? data.refine ?? 1;
    this.icon = data.icon || '';
    this.rarity = data.rarity || '';
    this.trait = data.trait || '';
    this.baseAtk = data.baseAtk ?? null; // 攻击型音擎主属性白值
    this.baseDef = data.baseDef ?? null; // 防御型音擎主属性白值（2026 新增 基础防御力 音擎）
    this.specialEffectTitle = data.specialEffectTitle || '';
    this.specialEffect = data.specialEffect || '';
    this.mainStats = data.mainStats || [];
    this.subStats = data.subStats || [];
    this.subStatsText = data.subStatsText || '';
    // wiki 扩展：外观图/突破材料/推荐代理人/背景故事
    this.appearance = data.appearance || [];
    this.materials = data.materials || [];
    this.recommend = data.recommend || [];
    this.lore = data.lore || '';
  }
}
