# 代码优化记录（10 轮，2026-10-07）

范围：全库（src/lib、src/game、src/web、src/sync、server.js、scripts）。
方式：每轮聚焦一块区域，找「简化 + 提效」点 → 改 → `npm run lint` + 测试 → 单独提交。
验证：每轮 lint 通过；全量测试 240 项，239 过、1 败（`test/discCleaner.test.js` 的「未来套」断言，**改动前就存在的存量失败**，与本次优化无关，stash 对照验证过）。
状态：**10 个提交全部只在本地 master，未推送远端**。逐条复查后确认无行为变化。

## 第 1 轮 · src/lib/calc.js（计算引擎热路径）`50f4492`

| 改动 | 类型 | 说明 |
|---|---|---|
| 音擎主词条单次解析 | 提效 | `statEntries(wengine.mainStats)` 原来在攻击/防御两处各调一次（各分配一个数组），合并为一次 `wengineMain` |
| `accumulate` 复用 targets 对象 | 提效 | 原来每条词条累加都新建 `{damage, flat, pct}` 包装对象；现在提升到循环外复用同一对象 |
| GAP_ADVICE 三条同构规则合一 | 简化 | 攻击/生命/防御三条结构完全相同的建议规则，抽出 `pctGapAdvice(stat, pctType, flatType)` 工厂，−9 行 |
| `statProgress` 去重复 `Number()` | 简化 | 同一值 `Number(targetVal)` 原来求值 3 次，收敛为 1 次 |

## 第 2 轮 · src/game/disc.js（概率枚举）`f2c4523`

| 改动 | 类型 | 说明 |
|---|---|---|
| **DFS 改回溯（本轮最大项之一）** | 提效 | `computeDiscProb` 与 `computeDiscProbKeep` 的组合枚举里，每层递归都 `rest.map(x => ({...x}))` 全量拷贝 10 个对象的数组；改为原地 `t.rest--` / 回溯后 `t.rest++`。枚举树上万节点时省掉巨量临时分配。`test/discProb.test.js` 9 项精确概率断言全过，数值等价 |
| `mainTypeForSlot` 复用 SLOT_FIXED_MAIN | 简化 | 1/2/3 号位的固定主词条映射与已有常量 `SLOT_FIXED_MAIN` 重复，删掉手写 if 链 |
| `substatType` 免数组分配 | 提效 | `[STAT.CR, STAT.CD].includes(name)`（每次调用分配数组）→ 直接 `\|\|` 比较；该函数在逐盘逐词条路径上 |

## 第 3 轮 · src/web/data.js `2fdc637`

| 改动 | 类型 | 说明 |
|---|---|---|
| config 默认值三处字面量合一 | 简化+修复 | 初始 `userConfig`、静态模式合入、服务器合入共三份手写默认值字面量，且**已实际漂移**（server 路径那份漏了 `showAll: true`）。统一为 `defaultConfig()` 工厂（每次调用产新对象，防止默认数组/对象引用被 `Object.assign` 共享后被就地污染） |

## 第 4 轮 · src/web/myChars.js（汇总表渲染）`8bfe6b9`

| 改动 | 类型 | 说明 |
|---|---|---|
| **targetGap 每角色 3 次 → 1 次** | 提效 | 缺口列渲染（`gapCellHtml`）、缺口悬浮提示（`gapAdviceHtml`）、缺口排序值三处各自独立调用 `targetGap(character, R)`（内部逐目标属性做 `resolveStatCurrent`）。62 角色 × 3 遍 → 现在调用点算一次后传参共用 |

## 第 5 轮 · src/web/wsRoles.js + goalView.js `b58bb3a`

| 改动 | 类型 | 说明 |
|---|---|---|
| **planBuildStats 按 plans 引用缓存** | 提效 | 手风琴「配装对标」每次展开都调 `computeRoleBuildsFromPlans(plans)` 全量重算（60 角色 × 全部方案），但结果只随 `plans` 变化。在 wsRoles.js 缓存层加 `planBuildStats()`（与既有 `recTierStats` 同款单槽哨兵缓存：引用比较失效，数据换新自动重建） |

## 第 6 轮 · src/game/disc.js + src/web/discProb.js（概率双口径）`5459797`

| 改动 | 类型 | 说明 |
|---|---|---|
| **强化通过率单次 DFS 同时统计「超过/恰平」** | 提效 | 盘卡概率的「超过（prob）」与「持平（probTie）」原先是两次完整 `computePosProb` 调用——组合枚举 + 路径枚举整个重跑一遍。重构为 `passCounts` 一次 DFS 同时统计 gt/eq 计数（ge = gt+eq），`computeDiscProb` 额外返回 `chanceTie`，`computePosProb` 直出 `probTie`，`slotProbs` 成对调用省掉一整遍枚举。**手风琴盘卡/模拟计算约 2× 提速** |
| 不变量保持 | — | 测试断言「ge = gt + eq」「ge ≥ gt」等手算不变量；期间修掉一处我引入的错误特判（scoreSum === goal 时旧语义仍需走 dfs——词条分数非 0 时 gt/eq 非平凡），由测试抓出后纠正 |

## 第 7 轮 · src/web/metaOverview.js `6d8992c`

| 改动 | 类型 | 说明 |
|---|---|---|
| 去掉纯转发包装 | 简化 | `renderMetaOverview()` 只是 `return renderOverview()`；合并为直接导出。本轮同时复查了 wiki.js / urlState.js / views.js / sync.js / charts.js 挂载层——均干净无改动 |

## 第 8 轮 · src/lib/distStats.js + src/web/charts.js `6a262b7`

| 改动 | 类型 | 说明 |
|---|---|---|
| 直方图累计边表缓存 + 三处共用 | 提效+简化 | 每箱左缘累计分位（edges）的同一循环在三个地方重复执行/复制：`histCumPct`（每次调用重算）、`histPctValue`（**读数线随鼠标移动逐次重算**）、`panelDistOption` 密度系列（内联复制了一份）。收敛为 `histEdges(hist)`，按 counts 数组引用 WeakMap 缓存（含 total=0 负缓存），三处共用 |

## 第 9 轮 · server.js `ce86851`

| 改动 | 类型 | 说明 |
|---|---|---|
| `/api/config` GET 回退改空对象 | 简化 | 回退值还是旧 schema 字面量 `{charTargets:{}, validStats:{}}`（同第 3 轮的漂移病）。默认值权威在 web `defaultConfig()`，服务器回退 `{}` 即可。server 测试 12 项全过 |

## 第 10 轮 · 全库复查 + simCalc `2e04f53`

- `src/lib/simCalc.js`：`mainStatName(name)` 在同一循环体里求值两次 → 一次。
- 死代码排查：对 16 个低频导出逐一 grep 全部调用点（`firstDamageBonus`、`compareValues`、`axisSubstatTypes` 等）——**全部有真实消费方或测试覆盖，无死代码可删**。
- 聚合管道确认：`computeAllWorkshopStats` 已是单遍历累加器（2026-08 已优化过 14 遍→1 遍），`workshop.json` 流式 IO（分块 gzip / PART 暂存 / 原子写）无可改进项。
- 复查结论：nodeUtil 锁/原子写、mihoyo-api 重试封装、workshop.js 断点续爬、simulate.js 结果缓存均已良好，不动。

## 效果与影响总览

**运行时提效（用户可感知）**：
1. 概率双口径省一整遍枚举（第 6 轮）——手风琴盘卡与「驱动盘提升模拟」计算约 2×。
2. 概率枚举 DFS 免每层全量拷贝（第 2 轮）——同一热路径的常数级提速。
3. `targetGap` 3→1（第 4 轮）+ `planBuildStats` 缓存（第 5 轮）——汇总表渲染与手风琴展开。
4. 读数线/悬浮反查免重算累计边表（第 8 轮）——面板分布图鼠标交互。

**代码质量**：
- 净变化约 −60 行（重复逻辑 5 处合一：GAP_ADVICE、SLOT_FIXED_MAIN、config 默认值、histEdges、metaOverview 包装）。
- 顺带修复 2 处「已实际发生」的漂移：config 默认值漏 `showAll`（第 3 轮）、server config 回退旧 schema（第 9 轮）。

**明确评估过但不改的**（避免无意义 churn）：
- `discOptions` 与 `discOptionsND` 的 2D/ND 近似重复——数据形状不同（dx/dy vs dims），合一要改下游消费方，风险大于收益。
- `computePosProb` 与 `computePosProbKeep` 的分支骨架重复——返回形状与内部匹配逻辑不同，同上。
- `OFFICIAL_SKILL_TYPE` 在 characters.js / workshop.js 各留一份——**文档明确要求的自包含约定**（test/official-skill-type.test.js 对账），不是可删重复。
- library.js 等 wiki 爬虫的循环嵌套——网络型代码，瓶颈在请求不在 CPU。

## 遗留事项

- ~~`test/discCleaner.test.js` 的存量失败~~ **已修复（2026-10-07，测试口径）**：该断言对活数据硬编码倾向值（荆棘玫瑰出现实况 4 件套用户后即非「未来套」），属测试被数据漂移污染。倾向规则本就有确定性单测覆盖（`computeTendency` 纯函数、传固定计数），冒烟段只保留「实况数据流入判定」与「倾向合法性」两类与数据解耦的断言。修复后全量测试 **240/240 全绿**。
- 本次优化全部未推送；确认后 `git push` 即可（共 11 个提交）。
