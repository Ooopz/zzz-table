// src/web/goalView.js —— 练度面板内容库（「提升」手风琴，嵌入我的角色·汇总表角色行下方）：
// 顶部驱动盘详情卡：六件盘精简盘面 + 每盘重刷概率三口径——prob 完整口径（含位置 1/6 与主词条概率）、
//   p4/p3 = 不考虑位置概率、初始 4/3 词条盘的纯条件概率（discRules.computePosProb 直出）；最值得重刷的盘高亮；
// ① 目标建议：方案高档 × 玩家样本分位合成（lib/goalAdvisor.synthTarget，P20 地板只托底不封顶），
//   一键应用写回 charTargets，附「词条缺口」列（同类型 %/固定值合并取 max，不可补的标「不可补」）。
// （原 ② 提升规划/补齐路线区块已下线；lib/goalAdvisor 的 rebuildPlan/slotPlans/mergeGapByType 一并删除。）
import {
  myCharacters,
  plans,
  workshopGrad,
  workshopStats,
  readCharTarget,
  readValidStats,
  discIndex,
  library,
} from './data.js';
import {
  statsNotReady,
  recTierStats,
  wsPanelMap,
  alignRoleName,
  skillDistItems,
  findLibraryWengine,
  roleIdFor,
} from './wsRoles.js';
import { synthTarget, toTargetDisplay } from '../lib/goalAdvisor.js';
import { resolveStatCurrent, targetGap, attrsOfTypes, percentSubstats } from '../lib/calc.js';
import { PANEL_ORDER, SKILL_TYPES, OFFICIAL_SKILL_TYPE, TARGET_PERCENTS } from '../game/index.js';
import { resolveEntry, CATEGORY } from '../lib/names.js';
import { escapeHtml, escapeJsAttr, formatValue } from '../lib/util.js';
import { richWeb } from './visual.js';
import { emptyState, richItemHtml, skillIcon, substatRollsMark } from './shared.js';
import { computeImproveProbs } from './discProb.js';
import { computeRoleBuildsFromPlans, computeBuildBench } from '../lib/plansStats.js';
import { buildPanelItems } from '../lib/panelItems.js';
import { registerChart, chartBox, skillDistOption, panelDistOption, densityScatterOption } from './charts.js';
import { CHART_HEIGHT } from './visual.js';

/** 当前查看的角色（renderGoalPlan 内部有兜底直改，与 selectedDisc 同惯例） */
export let goalChar = '';
export function setGoalChar(name) {
  goalChar = name;
}
/** 目标建议档位固定为高档（用户约定：低/中配无区分意义，已删除切换 UI） */
const GOAL_TIER = 'high';

const planNames = () => Object.values(plans || {}).map((v) => v.name);

/** 汇总主线三段共用的计算：目标建议行 / 生效目标（已存优先，建议兜底）/ 缺口 / 逐槽规划 */
function computeGoals() {
  const names = planNames();
  const name = names.includes(goalChar) ? goalChar : names[0];
  const tiers = recTierStats()[name] || {};
  const distMap = wsPanelMap().get(name) || {};
  const my = myCharacters.find((c) => c.name === name) || null;
  const R = my ? my.calculate() : null;
  // 生效目标 = 已保存值优先，建议值兜底（user-config 整数口径）
  const saved = readCharTarget(name) || {};
  // 显示行 = 养成配置勾选的有效副词条所挂靠的属性（PANEL_STAT_MAP 反查，攻击/生命/防御含 % 与固定）
  const relevant = attrsOfTypes(readValidStats(name));
  // 属性并集：PANEL_ORDER 打头，其余（不在固定顺序里的属性）按名补尾
  const allAttrs = [
    ...PANEL_ORDER.filter((a) => tiers[a] || distMap[a]),
    ...Object.keys({ ...distMap, ...tiers }).filter((a) => !PANEL_ORDER.includes(a) && (tiers[a] || distMap[a])),
  ];
  const attrs = allAttrs.filter((a) => relevant.has(a));
  // 生效目标（已保存 ?? 建议值）：目标建议表已下线，effective 仅供缺口/重刷概率演算
  const effective = {};
  for (const a of attrs) {
    const r = synthTarget(a, tiers[a], distMap[a], R ? resolveStatCurrent(R, a) : null, GOAL_TIER);
    if (!r) continue;
    const s = Number(saved[a]);
    effective[a] = Number.isFinite(s) && s > 0 ? s : toTargetDisplay(a, r.suggestion);
  }
  const gap = my && R ? targetGap(my, R, effective) : null;
  // 有效词条集（养成配置勾选 → 类型数组）：盘卡高亮统一 % 口径（固定值不计命中，与「命中 N」对齐）
  const validTypes = new Set(percentSubstats(readValidStats(name)));
  // 需求词条类型集合（count>0 的可刷缺口）——只用于盘卡「黄底 = 缺口中」高亮，不参与概率评分
  const neededTypes = new Set((gap?.items || []).filter((it) => it.type && it.count > 0).map((it) => it.type));
  const improveProbs = my ? computeImproveProbs(name) : [];
  // 技能养成：各技能目标等级 = 玩家样本该技能等级众数（workshop-stats.skillLevelModes，role_id 经 workshop-grad 对齐）
  const roles = workshopGrad.roles || [];
  const role = roles.find((r) => r.name === name) || roles.find((r) => alignRoleName(r.name) === name);
  const skillModes = role ? workshopStats.skillLevelModes?.[role.item_id] : null;
  // 众数(全服)不依赖账号：未拥有角色也能给「目标等级」；skills 仅在拥有时存在
  const skillInfo = skillModes ? { skills: my?.skills || [], modes: skillModes } : null;
  // 只返回实际消费的字段（names/effective/gapByType 为随「缺口合并」退役的遗留，已不下发）
  return { name, my, R, saved, gap, neededTypes, validTypes, improveProbs, skillInfo };
}

/** 汇总表属性列目标信息（每角色一次，供属性列「目标 N」子行）：
 *  target = 已保存目标（整数口径）；suggestion = 方案建议（整数口径，供「设定目标」参考）。
 *  目标建议表已下线（2026-08）：目标编辑并入汇总表属性列，目标分位对照已移到面板分布图标记，手风琴不再有独立目标表。 */
export function charTargetInfo(name, attrs) {
  const tiers = recTierStats()[name] || {};
  const distMap = wsPanelMap().get(name) || {};
  const saved = readCharTarget(name) || {};
  const out = {};
  for (const a of attrs) {
    const r = synthTarget(a, tiers[a], distMap[a], null, GOAL_TIER);
    const savedN = Number(saved[a]);
    const hasTarget = Number.isFinite(savedN) && savedN > 0;
    out[a] = {
      // target 只认已保存目标（不回退建议值）；suggestion 供「设定目标」弹窗参考
      target: hasTarget ? savedN : null,
      suggestion: r ? toTargetDisplay(a, r.suggestion) : null,
    };
  }
  return out;
}

/** 顶部驱动盘详情卡（「检验单」式精简盘面）：超大槽位编号 + 副词条（有效/缺口双层高亮）+ 重刷概率三口径。
 *  概率按**有效词条口径**（养成配置勾选，已达标词条同样计分）：prob = 新盘有效命中严格超过当前盘；
 *  probKeep = 保词条（各有效词条命中不缩水）的更严格口径；p4/p3 = 初始 4/3 词条盘的纯条件概率。
 *  概率最高 = 当前盘最弱 = 最值得重刷，该卡拿全套强调（警示黄编号 + 「先刷」图章 + 光晕）。 */
function discCardsHtml(g) {
  if (!g.my || !Array.isArray(g.my.discs)) {
    // 未拥有 / 无盘面数据：保留块结构，内容用占位说明（与「缺数据 → 暂无」口径一致）
    return `<div class="goal-top">
      <div class="goal-top-head">
        <h4 class="dp-slots-title"><span>驱动盘提升</span><button class="chart-hint" data-hint="${escapeHtml('驱动盘提升 = 重刷概率三口径，口径同「模拟 → 驱动盘提升模拟」。未拥有该角色时无当前盘面，无法计算。')}">?</button></h4>
      </div>
      <div class="ds-dim" style="padding:12px 14px">— 未拥有该角色，无当前盘面，驱动盘提升 / 重刷概率不适用 —</div>
    </div>`;
  }
  const probBySlot = new Map(g.improveProbs.map((r) => [r.pos, r]));
  const best = g.improveProbs.filter((r) => r.prob > 0).sort((a, b) => b.prob - a.prob)[0] || null;
  const cards = [1, 2, 3, 4, 5, 6]
    .map((slot) => {
      const d = (g.my.discs || []).find((x) => Number(x?.slot) === slot) || null;
      const r = probBySlot.get(slot);
      const mainEntry = (d?.mainStats || []).find((t) => t && t.name != null) || null;
      // 主词条：名 dim 小标（放大）+ 值加粗白字（放大、推右）。
      // 值用独立 .dmv（不带副词条的 .dsv 定宽 48px），名字独占左侧最大横向空间 → 长名（如「火属性伤害加成」7字）不再被省略号截断
      const mainTxt = mainEntry
        ? `<span class="dsn dmn">${escapeHtml(mainEntry.name)}</span><span class="dmv">${formatValue(mainEntry.name, mainEntry.value)}</span>`
        : '<span class="ds-dim">—</span>';
      // 副词条高亮双层口径：.hit = 有效词条（养成配置勾选，与卡片/汇总表命中口径一致）；
      // .need = 该词条当前在缺口需求里（叠加更亮的警示黄）——「有效看勾选，缺口看目标」
      // 行结构 = 名（左对齐，可省略号）+ 值（等宽）+ 强化箭头 > 的 roll 计（右缘对齐）
      const subs =
        (d?.growth || [])
          .map((gi) => {
            const cls = ['dsub', g.validTypes.has(gi.type) && 'hit', g.neededTypes.has(gi.type) && 'need']
              .filter(Boolean)
              .join(' ');
            return `<div class="${cls}"><span class="dsn">${escapeHtml(gi.name)}</span><span class="dsv">${formatValue(gi.name, gi.value)}</span><span class="rolls">${substatRollsMark(gi.growthCount)}</span></div>`;
          })
          .join('') || '<span class="ds-dim">无副词条</span>';
      // 驱动盘图标（library 优先，与汇总表卡片图标同口径）：圆框「插座」内放盘面图，钉在盘卡右上角
      const discLib = d ? resolveEntry(CATEGORY.DISC, discIndex, d.set) : null;
      const icon = discLib?.roundIcon || discLib?.icon || d?.icon || '';
      const icoHtml = d
        ? `<span class="gdc-ico-well">${icon ? `<img class="gdc-ico" src="${icon}" alt="">` : ''}</span>`
        : '';
      let probHtml;
      if (!r) {
        // 无重刷参考的三种情形：未勾选有效词条 / 目标未设置 / 目标已全部达成
        const doneMsg =
          g.gap == null ? '尚未设置生效目标' : g.validTypes.size ? '目标已达成，无需重刷' : '未勾选有效副词条';
        probHtml = `<div class="dc-prob"><span class="dc-done">${doneMsg}</span></div>`;
      } else {
        const pct = (v) => (v > 0 ? `${(v * 100).toFixed(2)}%` : '—');
        probHtml = `<div class="dc-prob">
          <div class="dc-row"><span class="dc-label">重刷提升概率</span><b class="dc-pct">${pct(r.prob)}</b></div>
          <div class="dc-item" data-detail="初始 4 词条盘的条件提升概率：不含位置掉落（每槽 1/6）与主词条出现概率；评分口径与「重刷提升概率」一致"><span class="dc-item-label">初始4词条提升概率</span><b>${pct(r.p4)}</b></div>
          <div class="dc-item" data-detail="初始 3 词条盘的条件提升概率（口径同上）"><span class="dc-item-label">初始3词条提升概率</span><b>${pct(r.p3)}</b></div>
          <div class="dc-item" data-detail="持平概率 = 新盘加权命中不低于当前盘（严格超过 + 恰好打平），恒 ≥ 重刷提升概率"><span class="dc-item-label">持平概率</span><b>${pct(r.probTie)}</b></div>
          <div class="dc-item" data-detail="保词条提升概率 = 更严格口径：新盘各权重词条的命中都不低于当前盘（防止刷掉已有词条导致属性回退），且总命中仍需提高"><span class="dc-item-label">保词条提升概率</span><b>${pct(r.probKeep)}</b></div>
        </div>`;
      }
      const hot = best && r && r.pos === best.pos;
      return `<div class="disc gdc${hot ? ' dc-hot' : ''}" style="--i:${slot - 1}">
        <div class="gdc-head">
          <span class="gdc-tag"><b>${slot}</b><i>号位</i></span>
          ${d ? `<span class="gdc-set">${escapeHtml(d.set)}</span>` : ''}
          ${r ? `<span class="gdc-hit" data-detail="当前盘落在有效副词条上的命中数（口径 = 养成配置勾选属性的 % 变体，与「驱动盘提升模拟」当前分一致）">命中 ${r.curScore}</span>` : ''}
          ${hot ? '<span class="d-hit">先刷</span>' : ''}
          ${icoHtml}
        </div>
        <div class="dsubs"><div class="dsub dmain">${mainTxt}</div>${subs}</div>
        ${probHtml}
      </div>`;
    })
    .join('');
  const tip = `<b>驱动盘提升（口径同「模拟 → 驱动盘提升模拟」）</b><br><span style="color:var(--dim)">评分 = 养成配置勾选属性的<b>百分比变体</b>命中（生命/攻击/防御的固定值词条权重恒 0，内部口径不暴露）。<b>命中</b> = 该盘落在权重词条上的命中总数；<b>重刷提升概率</b> = 新掉落盘（随机掉落 + 强化，含位置 1/6 与 4/5/6 号位主词条概率）加权命中<b>严格超过</b>当前盘的概率——越高 = 该盘越弱、越值得先刷（盖章那张）；<b>持平概率</b> = 新盘加权命中恰好等于当前盘（不赚不亏）；<b>保词条提升概率</b> = 更严格口径：新盘各权重词条命中都不低于当前盘且总数仍提高；<b>初始4/3词条提升概率</b> = 不考虑位置概率、按初始 4/3 词条盘算出的条件概率（80%/20% 掉落占比已在完整口径中混合）。需要调权重/定向精算时到「模拟 → 驱动盘提升模拟」。</span>`;
  return `<div class="goal-top">
    <div class="goal-top-head">
      <h4 class="dp-slots-title"><span>驱动盘提升（<button class="goal-jump" onclick="ZZZ.jumpSimProb('${escapeJsAttr(g.name)}')" data-detail="跳转到「模拟 → 驱动盘提升模拟」，预选当前角色，可调权重/定向后精算">点击跳转驱动盘提升模拟</button>）</span><button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h4>
    </div>
    <div class="goal-discs">${cards}</div>
  </div>`;
}

/** 手风琴顶部「角色详情」条带（2026-08 重构：技能行 + compact 分布图合进同一方框；影画/觉醒移出为 msAwakenBlocks）：
 *  标题同「驱动盘提升」（dp-slots-title + ? 提示）；技能 6 格（图标 + Lv.当前/目标，达标 ✓）悬浮看说明，下方紧跟分布图。 */
function roleDetailStripHtml(g) {
  const my = g.my;
  const hasAcc = !!my;
  // 技能养成（技能信息 + 目标等级结合）：图标 + 当前Lv/目标(玩家众数) + 达标 ✓（进度条与差 N 级徽章已删）
  // canonical 顺序（普攻/闪避/支援/特殊/终结/核心）；账号技能为官方 type，经 OFFICIAL_SKILL_TYPE 映射
  // ⚠️ 图标用 skillIcon(图标键)：skillIconForType 期待官方 type（1特殊/2闪避），直接传 canonical 会错位（曾致图标乱）
  // 未拥有角色：hasAcc=false → 无账号技能，当前等级全 —，目标(全服众数)照常给
  const SKILL_ICON_KEY = { 0: 'normal', 1: 'dodge', 2: 'support', 3: 'special', 4: 'ultimate', 5: 'core' };
  const modes = g.skillInfo?.modes;
  const skillsHtml = SKILL_TYPES.map((t) => {
    const s = hasAcc ? (my.skills || []).find((x) => OFFICIAL_SKILL_TYPE[x.type] === t.key) : null;
    if (hasAcc && !s) return '';
    const cur = s?.level ?? null;
    const mode = modes?.[t.key];
    const icon = skillIcon(SKILL_ICON_KEY[t.key]);
    const detail = s && (s.items || []).length
      ? (s.items || []).map((it) => richItemHtml(it.title, it.text)).join('<div class="tip-hr"></div>')
      : '';
    const tip =
      `<b>${escapeHtml(t.label)}</b>` +
      (!hasAcc ? '<br><span style="color:var(--dim)">未拥有 — 无个人技能等级</span>' : '') +
      (detail ? `<br>${detail}` : '') +
      (mode
        ? `<div class="tip-hr"></div>目标等级 = 玩家样本该技能众数 ${mode}` +
          (hasAcc && cur != null && cur < mode ? `（当前差 ${mode - cur} 级）` : '')
        : '');
    const curTxt = cur != null ? cur : '—';
    // 无众数目标（样本缺该技能）：只显示当前等级（未拥有则为 —）
    if (!mode) {
      return `<span class="sc-cell" data-detail="${escapeHtml(tip)}"><span class="sc-top"><img class="skill-icon" src="${icon}" alt=""></span><b class="sc-lv"><span class="lv-lv">Lv.</span><span class="lv-cur">${curTxt}</span></b></span>`;
    }
    const done = hasAcc && cur != null && cur >= mode;
    const miss = hasAcc && cur != null && cur < mode;
    const cls = done ? ' sc-done' : miss ? ' sc-missing' : '';
    return `<span class="sc-cell${cls}" data-detail="${escapeHtml(tip)}">
      <span class="sc-top"><img class="skill-icon" src="${icon}" alt=""></span>
      <b class="sc-lv"><span class="lv-lv">Lv.</span><span class="lv-cur">${curTxt}</span><i>/</i><span class="lv-mode">${mode}</span></b>
    </span>`;
  })
    .filter(Boolean)
    .join('');
  // 影画/觉醒见 msAwakenRow；技能行与分布图合并进同一方框（网格 6 列与 6 子图列精确对齐）
  const skillTip = `<b>技能养成</b><br><span style="color:var(--dim)">当前等级 vs 玩家样本该技能众数（目标）；下方分布图 = 玩家样本各等级玩家数，<b>金色柱 = 我的等级</b>（未拥有则无金色柱），悬浮看等级与人数。</span>`;
  return `<div class="role-detail">
    <h4 class="dp-slots-title">技能养成<button class="chart-hint" data-hint="${escapeHtml(skillTip)}">?</button></h4>
    ${skillsHtml ? `<div class="sc-grid">${skillsHtml}</div>` : ''}
    ${skillDistChart(g)}
    ${msAwakenRow(g)}
  </div>`;
}

/** 影画 / 觉醒 并排一行（归入技能养成方框最下方，2026-08）：保持圆点形态，标签+计数同行。 */
function msAwakenRow(g) {
  const my = g.my;
  if (!my) {
    // 未拥有：无影画/觉醒数据 → 同结构占位 —
    const dash = (label) =>
      `<span class="ms-col"><span class="rd-label">${label}</span><span class="ms-dots"><span class="ds-dim">—</span></span></span>`;
    return `<div class="ms-row">${dash('影画')}${dash('觉醒')}</div>`;
  }
  const msRanks = my.mindscape?.ranks || [];
  const msUnlocked = msRanks.filter((r) => r.isUnlocked).length;
  const mindscapeHtml = msRanks
    .map((r) => {
      const nm = r.name || `影画${r.pos}`;
      const st = r.isUnlocked ? '已解锁' : '未解锁';
      const tip = `<b>${escapeHtml(nm)}</b>（${st}）${r.desc ? `<br>${richWeb(r.desc)}` : ''}`;
      return `<span class="ms-dot ${r.isUnlocked ? 'on' : ''}" data-detail="${escapeHtml(tip)}">${r.pos}</span>`;
    })
    .join('');
  const sa = my.skillAwaken;
  const awakenItems = sa?.items || [];
  const awakenHtml =
    sa && sa.hasSystem && awakenItems.length
      ? Array.from({ length: 6 }, (_, i) => {
          const lv = i + 1;
          const it = awakenItems[i];
          const on = lv <= (sa.level ?? 0);
          const tip = it
            ? `<b>${escapeHtml(it.level_show_name || `觉醒 ${lv}`)}</b>${on ? '（已觉醒）' : ''}` +
              (it.awaken_skill_items || [])
                .map((asi) => {
                  const simple = asi.awaken_simple_info ? richWeb(asi.awaken_simple_info) : '';
                  const detail = (asi.skill_items || [])
                    .map((si) => richItemHtml(si.title, si.text))
                    .join('<div class="tip-hr"></div>');
                  return simple + (simple && detail ? '<br>' : '') + detail;
                })
                .join('<div class="tip-hr"></div>')
            : `<b>觉醒 ${lv}</b>（未解锁）`;
          return `<span class="ms-dot ${on ? 'on' : ''}" data-detail="${escapeHtml(tip)}">${lv}</span>`;
        }).join('')
      : '';
  const col = (label, html) =>
    html
      ? `<span class="ms-col"><span class="rd-label">${label}</span><span class="ms-dots">${html}</span></span>`
      : '';
  const cols =
    col(`影画 ${msUnlocked}/${msRanks.length}`, mindscapeHtml) +
    col(`觉醒 ${sa?.level ?? 0}/${sa?.maxLevel ?? 6}`, awakenHtml);
  return cols ? `<div class="ms-row">${cols}</div>` : '';
}

/** 技能等级分布（compact：单行 6 子图对齐技能格，去标题/坐标轴、我的柱不写字）：
 *  嵌进技能养成方框（技能格下方）；无样本分布数据时返回空串（静默降级）。
 *  六图分隔线（.sd-sep）用 HTML 绝对定位叠加——echarts grid/graphic 样式在本构建不可靠，HTML 保证渲染。 */
function skillDistChart(g) {
  const items = skillDistItems(g.name);
  if (!items.length) return '';
  registerChart('goal-skill-dist', skillDistOption(items, { compact: true }));
  // 5 条子图边界竖线（6 等宽列，16.67% 一列；padX=0 与上方技能格列对齐）
  const seps = [16.67, 33.33, 50, 66.67, 83.33].map((x) => `<i class="sd-sep" style="left:${x}%"></i>`).join('');
  return `<div class="skill-dist">${chartBox('goal-skill-dist', 48)}${seps}</div>`;
}

/** 配装对标（右半两条细横条）：音擎 / 套装组合，各「我的 | 推荐 Top1 | 真实玩家 Top1」。
 *  数据层 = lib/plansStats.js 的 computeBuildBench（纯函数，我的/推荐/真实玩家三方结构化对照）；此处只拼 HTML。
 *  只并列展示、不做「换」判定——差异由玩家自看；无数据侧渲染「—」。 */
function renderBuildBenchHtml(g) {
  const planBuilds = computeRoleBuildsFromPlans(plans);
  const pb = planBuilds[g.name] || null;
  const roles = workshopGrad.roles || [];
  const gr = roles.find((r) => r.name === g.name) || roles.find((r) => alignRoleName(r.name) === g.name) || null;
  const bench = computeBuildBench({ my: g.my, planBuild: pb, gradRole: gr });
  const w = bench.wengine;
  const s = bench.sets;
  if (!w.mine && !w.rec && !w.live && !s.mine && !s.rec && !s.live) return '';
  // 音擎图标：规范名直查 library，工坊源名经 findLibraryWengine 解析（残响-II型→「残响」-Ⅱ型）
  const wengineIcon = (name) => library.wengines?.[name]?.icon || findLibraryWengine(name)?.icon || '';
  // 套装图标：小圆盘（roundIcon 优先，与汇总表一致）；工具悬浮 = 各套装件数拆解
  const setIcon = (name) => library.discs?.[name]?.roundIcon || library.discs?.[name]?.icon || '';
  const setTip = (sets) => escapeHtml((sets || []).map((x) => `${x.name}${x.num}件`).join(' + '));
  // 推荐/真实玩家放 Top3（竖排多行填满右栏下方空间）；我的只有一条
  const witem = (e, mine) => {
    if (!e) return '';
    const icon = wengineIcon(e.name);
    const ref = mine && e.refinement ? `<i class="bb-ref">★${e.refinement}</i>` : '';
    const pct = !mine && e.percent != null ? `<span class="bb-pct">${e.percent.toFixed(1)}%</span>` : '';
    return `<span class="bb-item" data-detail="${escapeHtml(e.name)}">${icon ? `<img class="bb-ico" src="${icon}" alt="">` : ''}<span class="bb-name">${escapeHtml(e.name)}</span>${ref}${pct}</span>`;
  };
  const sitem = (e, mine) => {
    if (!e) return '';
    const icons = (e.sets || [])
      .map((x) => {
        const icon = setIcon(x.name);
        return icon ? `<img class="bb-set-ico" src="${icon}" alt="">` : '';
      })
      .join('');
    const pct = !mine && e.percent != null ? `<span class="bb-pct">${e.percent.toFixed(1)}%</span>` : '';
    return `<span class="bb-item" data-detail="${setTip(e.sets)}">${icons ? `<span class="bb-sets">${icons}</span>` : ''}<span class="bb-name">${escapeHtml(e.name)}</span>${pct}</span>`;
  };
  // mine 传单条对象，rec/live 传数组 → 统一成数组渲染；空列给「—」
  const cell = (e, mine, itemFn) => {
    const list = mine ? [e] : e || [];
    if (!list.length || !list[0]) return '<span class="bb-cell bb-empty">—</span>';
    return `<span class="bb-cell${mine ? ' bb-mine' : ''}">${list.map((x) => itemFn(x, mine)).join('')}</span>`;
  };
  const tip = `<b>配装对标</b><br><span style="color:var(--dim)">三方对照：<b>我的</b>（账号当前佩戴） / <b>推荐</b>（米游社养成指南方案 Top3） / <b>真实玩家</b>（工坊高练度玩家样本实况 Top3）。只并列展示、不做判断，差异自己看。</span>`;
  return `<div class="bb-box">
    <h4 class="dp-slots-title">配装对标<button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h4>
    <div class="bb">
      <div class="bb-head"><span class="bb-kind"></span><span>我的</span><span>推荐</span><span>真实玩家</span></div>
      <div class="bb-row"><span class="bb-kind">音擎</span>${cell(w.mine, true, witem)}${cell(w.rec, false, witem)}${cell(w.live, false, witem)}</div>
      <div class="bb-row"><span class="bb-kind">套装</span>${cell(s.mine, true, sitem)}${cell(s.rec, false, sitem)}${cell(s.live, false, sitem)}</div>
    </div>
  </div>`;
}

/** 手风琴底部整合图属性范围：'checked' = 只看养成配置勾选的有效副词条属性，'all' = 全量（标题切换按钮） */
let panelDistScope = 'checked';
export function setPanelDistScope(scope) {
  panelDistScope = scope === 'all' ? 'all' : 'checked';
}

/** 手风琴底部「玩家分布 × 推荐三档」整合图：横向箱线 + 三档 median 点位 + 我的菱形标记，每属性一行独立刻度。
 *  数据走 lib/panelItems.buildPanelItems（与诊断两图同源）；默认只看有效属性，勾选集为空回退全量。 */
function renderPanelDistHtml(g) {
  // 已设目标（user-config 整数口径 → 内部值）：面板分布图目标标记用（只标已设目标，未设不标；特殊键非数值自动跳过）
  const targets = {};
  for (const [a, v] of Object.entries(g.saved || {})) {
    const num = Number(v);
    if (!(Number.isFinite(num) && num > 0)) continue;
    targets[a] = TARGET_PERCENTS.has(a) ? num / 100 : num;
  }
  const items = buildPanelItems({
    dist: wsPanelMap().get(g.name) || {},
    rec: recTierStats()[g.name] || {},
    myFinal: g.R?.final || null,
    targets,
  });
  let show = items;
  if (panelDistScope === 'checked') {
    const relevant = attrsOfTypes(readValidStats(g.name));
    if (relevant.size) {
      const filtered = items.filter((i) => relevant.has(i.attr));
      if (filtered.length) show = filtered; // 勾选属性恰好无样本时不空手，回退全量
    }
  }
  if (!show.length) return '';
  // 自适应高度：行数 × 40 + 底部余量——只有两三个属性时不再留大段空高（原 min 140 过高）
  const height = Math.max(70, show.length * 40 + 24);
  registerChart('goal-panel-dist', panelDistOption(show));
  const tip = `<b>面板分布</b><br><span style="color:var(--dim)">每属性一行，<b>X 轴 = 玩家分位（0-100%）</b>——各属性按各自分布换算到同一分位标尺，上下多行<b>横向可比</b>（虚线 = 四分位对齐线）。<b>青瓷密度</b> = 玩家真实分布（峰值 = 大部分玩家的数值），<b>浅金带</b> = 推荐区间映射到分位（中档中位 ~ 高档上限），<b>金色圆点+虚线</b> = 我的分位，<b>紫色三角+实线</b> = 已设目标分位（未设目标不标）——一眼看目标在玩家中的排名。悬浮密度/读数线<b>仍显示属性值</b>（分位 → 值反查）；悬浮圆点看我的值+分位、玩家区间、三档 median±sd。按钮点击在「只看有效 / 全部」间切换。</span>`;
  // 单按钮切换：标签 = 当前模式（常亮 on），点击切到另一模式
  const scopeLabel = panelDistScope === 'checked' ? '只看有效' : '全部';
  const nextScope = panelDistScope === 'checked' ? 'all' : 'checked';
  const scopeHint = `当前「${scopeLabel}」，点击切换为「${panelDistScope === 'checked' ? '全部' : '只看有效'}」`;
  return `<h4 class="dp-slots-title">面板分布
      <span class="pd-legend"><i class="pd-swatch pd-band"></i>推荐区间<i class="pd-swatch pd-mine"></i>我的<i class="pd-swatch pd-target"></i>目标</span>
      <button class="mini on" onclick="ZZZ.setPanelDistScope('${nextScope}')" data-detail="${escapeHtml(scopeHint)}">${scopeLabel}</button>
      <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button>
    </h4>
    ${chartBox('goal-panel-dist', height)}`;
}

/** 底部散点对选择：两图各自独立，各可从 4 对属性里挑一对（图1 默认暴击率×暴伤、图2 默认攻击力×异常精通） */
let scatterPairs = ['暴击率_暴击伤害', '攻击力_异常精通'];
export function setScatterPair(idx, key) {
  if ((idx === 0 || idx === 1) && typeof key === 'string') scatterPairs[idx] = key;
}

/** 手风琴底部「配比散点」：两图左右排列（宽时并排、窄时堆叠），各带下拉切 4 对属性之一，叠加我的位置金点。 */
function renderScatterSection(g) {
  const perRole = workshopStats.panelScatter?.perRole?.[roleIdFor(g.name)] || {};
  // 4 对固定候选，按该角色数据里实际存在的过滤
  const PAIR_OPTS = [
    ['暴击率_暴击伤害', '暴击率 × 暴击伤害'],
    ['攻击力_暴击伤害', '攻击力 × 暴击伤害'],
    ['攻击力_异常精通', '攻击力 × 异常精通'],
    ['攻击力_暴击率', '攻击力 × 暴击率'],
  ];
  const available = PAIR_OPTS.filter(([key]) => perRole[key]);
  if (!available.length) return '';
  const optHtml = (sel) =>
    available.map(([k, label]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${label}</option>`).join('');
  const chart = (idx) => {
    const sel = available.some(([k]) => k === scatterPairs[idx]) ? scatterPairs[idx] : available[0][0];
    const grid = perRole[sel];
    const label = PAIR_OPTS.find(([k]) => k === sel)?.[1] || sel;
    const mine =
      grid && g.R?.final && Number.isFinite(g.R.final[grid.xName]) && Number.isFinite(g.R.final[grid.yName])
        ? { x: g.R.final[grid.xName], y: g.R.final[grid.yName] }
        : null;
    registerChart(`goal-scatter-${idx}`, densityScatterOption(grid, mine));
    const tip = `<b>${escapeHtml(label)}</b><br><span style="color:var(--dim)">该角色玩家真实配比 2D 密度散点（颜色越亮密度越高，每点 = 一位玩家的该属性组合）；<b>金色菱形 = 我的位置</b>，悬浮看坐标。下拉可切换四对属性。</span>`;
    return `<div class="gs-card">
      <h4 class="dp-slots-title">
        <select class="gs-select" onchange="ZZZ.setScatterPair(${idx}, this.value)">${optHtml(sel)}</select>
        <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button>
      </h4>
      ${chartBox(`goal-scatter-${idx}`, CHART_HEIGHT.goalScatter)}
    </div>`;
  };
  return `<div class="goal-scatter">${chart(0)}${chart(1)}</div>`;
}

/** 汇总表「提升」手风琴内容（myChars.renderTable 嵌入角色行下方）：角色详情 + 顶部盘卡 + ① 目标建议。
 *  角色跟随行内传入（无顶部下拉）；无推荐方案的角色给空态（computeGoals 的 names[0] 兜底会把内容算到别人头上，必须先校验）。 */
export function renderGoalAccordionHtml(charName) {
  const notReady = statsNotReady();
  if (notReady) return notReady;
  if (!planNames().includes(charName)) {
    return emptyState('该角色暂无推荐方案数据，无法合成目标建议。<br>请先在右上角 <b>同步数据 → 更新推荐方案</b>。');
  }
  setGoalChar(charName); // goalEdit 弹窗依赖 goalChar 模块态
  const g = computeGoals();
  // 未拥有角色：与拥有同构的完整面板，账号不可得值由各渲染器以 — 占位；顶部一次性说明来源
  const unowned = !myCharacters.some((c) => c.name === charName);
  // 顶部双栏（宽时左右、窄时自动堆叠）：左 = 技能提升，右 = 配装对标两条细横条；盘卡通栏；分布×三档与配比散点共用一个框
  const panelDistHtml = renderPanelDistHtml(g);
  const scatterHtml = renderScatterSection(g);
  const distBox = panelDistHtml || scatterHtml ? `<div class="panel-dist">${panelDistHtml}${scatterHtml}</div>` : '';
  const note = unowned
    ? `<div class="uowned-note">未拥有该角色 —— <code>—</code> 表示无个人数据（技能/影画/觉醒/盘面/「我的」列等），其余均为全服 / 推荐参考。</div>`
    : '';
  return `<div class="goal-acc">
    ${note}
    <div class="goal-top2">
      <div class="goal-top2-left">${roleDetailStripHtml(g)}</div>
      <div class="goal-top2-right">${renderBuildBenchHtml(g)}</div>
    </div>
    ${discCardsHtml(g)}
    ${distBox}
  </div>`;
}
