// src/lib/buildBench.js —— 角色配装对标的数据层（我的 | 推荐 | 真实玩家 三方对照）：
// 纯函数、依赖注入（Node 与浏览器共用）。推荐侧 = plans 统计（computeRoleBuildsFromPlans 单角色结果）、
// 真实玩家侧 = workshop-grad 单角色实况，「我的」侧由账号角色模型派生。
// 只产出结构化对照数据（原始名/占比/套装组合），图标与规范名解析是 web 层职责（findLibraryWengine 等）。
// 展示逻辑留在各视图（手风琴细横条）。
import { orderComboSets4First } from './plansStats.js';

/** 玩家当前套装组合：6 盘按 set 计数推导（≥4 = 4 件套、≥2 = 2 件套、1 件不计），组合顺序归一（4 件套在前）。
 *  返回 orderComboSets4First 结构（{name, sets:[{name,num}]}）或 null（无 ≥2 件的套装）。 */
export function mySetCombo(discs) {
  const count = {};
  for (const d of discs || []) {
    if (!d || !d.set) continue;
    count[d.set] = (count[d.set] || 0) + 1;
  }
  const combo = Object.entries(count)
    .map(([name, c]) => ({ name, num: c >= 4 ? 4 : c >= 2 ? 2 : 0 }))
    .filter((x) => x.num > 0);
  if (!combo.length) return null;
  return orderComboSets4First(combo);
}

/**
 * 三方配装对标：我的 vs 方案推荐 Top3 vs 真实玩家 Top3（音擎 + 套装组合）。
 * 输出原始名（不含图标/规范名解析——那是 web 层职责）；真实玩家侧跳过「其他」占位项。
 * 我的为单条，推荐/真实玩家为 Top3 数组（缺则空数组，web 层渲染「—」）。
 */
export function computeBuildBench({ my, planBuild, gradRole }) {
  const planW = (planBuild?.wengines || []).slice(0, 3);
  const planR = (planBuild?.relics || []).slice(0, 3);
  const gradWeapons = (gradRole?.weapons || []).filter((w) => w && w.name !== '其他').slice(0, 3);
  const gradRelics = (gradRole?.relics || []).filter((r) => r && r.name !== '其他').slice(0, 3);
  const myW = my?.wengine?.name ? { name: my.wengine.name, refinement: my.wengine.refinement || 0 } : null;
  const myR = mySetCombo(my?.discs);
  return {
    wengine: {
      mine: myW,
      rec: planW.map((w) => ({ name: w.name, percent: w.percent })),
      live: gradWeapons.map((w) => ({ name: w.name, percent: w.percent })),
    },
    sets: {
      mine: myR ? { name: myR.name, sets: myR.sets } : null,
      rec: planR.map((r) => ({ name: r.name, sets: r.sets, percent: r.percent })),
      live: gradRelics.map((r) => ({ name: r.name, sets: r.sets, percent: r.percent })),
    },
  };
}
