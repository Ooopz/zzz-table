// test/web-smoke.test.js —— 前端执行冒烟护栏：极简 DOM stub + 真实数据，真实执行关键渲染/计算路径。
// 背景：链接护栏（web-link.test.js）只验 ESM 链接，执行期错误（ReferenceError/undefined 解构等）
// 会被它放行——曾漏过「dpCalc 解构漏 probTie → 点计算无反应」「渲染抛错 → 面板全黑」级别的事故。
// 本文件在 Node 里 stub 浏览器全局，把 web 模块真正跑起来。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataFile } from './helpers.js';

// 缺 data/ 时统一打 SKIP 横幅后 exit(0)（与其他数据依赖测试一致；REQUIRE_DATA=1 则判失败）
const readData = (name) => loadDataFile(name, 'npm start 页面对应的数据同步');

// ---- 浏览器全局 stub（必须先于任何 web 模块 import 安装）----
const elCache = new Map();
const makeEl = (id) => ({
  id,
  innerHTML: '',
  textContent: '',
  value: '',
  style: {},
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {},
  appendChild() {},
  setAttribute() {},
  focus() {},
  querySelector: () => null,
  querySelectorAll: () => [],
});
globalThis.document = {
  getElementById: (id) => {
    if (!elCache.has(id)) elCache.set(id, makeEl(id));
    return elCache.get(id);
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => makeEl('create'),
  documentElement: makeEl('root'),
  body: makeEl('body'),
};
globalThis.window = { addEventListener() {}, location: { search: '', pathname: '/' } };
globalThis.location = globalThis.window.location;
globalThis.history = { replaceState() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
// fetch stub：/api/config 回真实 user-config（loadUserConfig 消费）；其余空对象
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => (String(url).includes('/api/config') ? { ok: true, config: readData('user-config.json') } : {}),
});
// 数据层 fire-and-forget 的保存请求在 stub 下可能 reject，不追责（与 web-link.test.js 同策略）
process.on('unhandledRejection', () => {});

test('前端执行冒烟：真实数据跑通 手风琴渲染（全部角色）+ 驱动盘提升模拟渲染与计算', async () => {
  const data = await import('../src/web/data.js');
  const lib = readData('library.json');
  data.setData(
    lib,
    readData('characters.json'),
    readData('plans.json'),
    readData('workshop-grad.json'),
    readData('workshop-stats.json')
  );
  const { setCalcContext } = await import('../src/lib/calc.js');
  setCalcContext(data.dataCtx);
  await data.loadUserConfig();

  // ① 养成手风琴：全部有方案的角色都渲染一遍（任何一盘/一属性的数据形状问题都会在这里炸出来）
  const { renderGoalAccordionHtml } = await import('../src/web/goalView.js');
  const planNames = Object.values(data.plans)
    .map((v) => v?.name)
    .filter(Boolean);
  assert.ok(planNames.length > 0, 'plans.json 应非空（缺数据请先同步）');
  // 汇总表只列账号内角色——盘区（重刷提升）仅对账号内角色断言；plans 独有角色（无账号数据）合法显示空态，只验不崩/无 NaN
  const accountNames = new Set(data.myCharacters.map((c) => c.name));
  let panelDistRendered = 0;
  for (const name of planNames) {
    const html = renderGoalAccordionHtml(name);
    if (accountNames.has(name)) assert.ok(html.includes('重刷提升'), `${name} 盘卡应渲染概率区`);
    assert.ok(html.includes('配装对标') && html.includes('真实玩家'), `${name} 配装对标条带应渲染`);
    // 面板分布整合图：仅当该角色有玩家分布样本（count≥30）时渲染（与手风琴其他区块同数据驱动口径）；渲染时应为单按钮切换
    if (html.includes('面板分布')) {
      panelDistRendered++;
      const toggles = (html.match(/ZZZ\.setPanelDistScope/g) || []).length;
      assert.equal(toggles, 1, `${name} 面板分布应为单按钮切换`);
      assert.ok(html.includes('pd-target'), `${name} 面板分布图例应含目标标记`);
    }
    // 底部「配比散点」：有玩家散点数据的角色渲染两图，各带 4 对下拉；无数据则跳过（与手风琴其他区块同数据驱动）
    if (html.includes('goal-scatter')) {
      assert.equal((html.match(/gs-select/g) || []).length, 2, `${name} 配比散点应为两图各一下拉`);
    }
    assert.ok(!html.includes('NaN'), `${name} 渲染结果出现 NaN`);
  }
  assert.ok(panelDistRendered > 0, '至少一个角色应渲染底部分布×三档整合图');

  // ② 汇总表：渲染全角色（新列 穿透值/贯穿力/属性伤害标元素/角色列达成率章 的执行期检查）
  const { renderTable } = await import('../src/web/myChars.js');
  const tblContainer = { innerHTML: '', addEventListener() {}, querySelector: () => null };
  renderTable(data.myCharacters, tblContainer);
  assert.ok(tblContainer.innerHTML.includes('等级'), '表头应含等级列');
  assert.ok(tblContainer.innerHTML.includes('职业'), '表头应含职业列');
  assert.ok(tblContainer.innerHTML.includes('属性'), '表头应含属性列');
  assert.ok(tblContainer.innerHTML.includes('Lv.'), '等级列应渲染 Lv.N');
  assert.ok(tblContainer.innerHTML.includes('穿透值'), '表头应含穿透值列');
  assert.ok(tblContainer.innerHTML.includes('贯穿力'), '表头应含贯穿力列');
  assert.ok(tblContainer.innerHTML.includes('属性伤害加成'), '表头应含属性伤害加成列');
  assert.ok(!tblContainer.innerHTML.includes('NaN'), '汇总表出现 NaN');
  assert.ok(!tblContainer.innerHTML.includes('高于'), '汇总表不应显示目标分位（已移到面板分布图标记）');

  // ③ 驱动盘提升模拟：渲染面板 + 点「计算概率」（dpCalc 全路径，含写回 user-config）
  const { renderProbPanel, dpCalc, computeImproveProbs } = await import('../src/web/discProb.js');
  assert.ok(renderProbPanel().includes('计算概率'), '驱动盘提升模拟面板应渲染');
  const probs = computeImproveProbs('仪玄');
  assert.equal(probs.length, 6, '仪玄应有 6 件盘的概率行');
  for (const r of probs) {
    assert.equal(typeof r.prob, 'number', 'prob 应为数值');
    assert.equal(typeof r.probTie, 'number', 'probTie（持平）应为数值——回归：dpCalc 解构漏过它');
    assert.ok(Number.isFinite(r.prob) && Number.isFinite(r.probTie) && Number.isFinite(r.probKeep), '概率必须有限');
  }
  dpCalc();
  // 结果表写入预置的 #dpTablesWrap（图表框 #dpChartBox 跨点击常驻，仅 setOption 更新数据）
  const out = elCache.get('dpTablesWrap').innerHTML;
  assert.ok(out.includes('持平'), '结果表应含持平列');
  assert.ok(!out.includes('NaN'), '驱动盘提升模拟结果出现 NaN');

  // ④ 就地插入/移除手风琴行（点「养成」不再全量 render）：模拟表结构，断言 展开→插入 / 收起→移除 / 单实例
  globalThis.CSS = { escape: (s) => s }; // Node 无 CSS.escape，stub
  const { toggleGoalAccRow, syncGoalAccRowInDom } = await import('../src/web/myChars.js');
  const rows = [];
  globalThis.document.createElement = (tag) => ({
    tag,
    className: '',
    innerHTML: '',
    remove() {
      const i = rows.indexOf(this);
      if (i >= 0) rows.splice(i, 1);
    },
  });
  const g = data.grid;
  const fakeTarget = {
    insertAdjacentElement(_p, el) {
      rows.push(el);
    },
  };
  g.querySelector = (sel) => {
    if (sel === 'tr.goal-acc-row') return rows[0] || null;
    if (sel.includes('data-char')) return fakeTarget;
    return null;
  };
  g.querySelectorAll = (sel) => (sel === 'th[data-col]' ? [{}, {}, {}, {}] : []);
  toggleGoalAccRow('仪玄');
  syncGoalAccRowInDom();
  assert.equal(rows.length, 1, '展开应就地插入手风琴行（不触发 render）');
  assert.ok(rows[0].innerHTML.includes('重刷提升'), '插入行内容应为手风琴');
  toggleGoalAccRow('仪玄'); // 再点收起
  syncGoalAccRowInDom();
  assert.equal(rows.length, 0, '收起应就地移除手风琴行');
  toggleGoalAccRow('仪玄'); // 单实例：再展开仅一行
  syncGoalAccRowInDom();
  assert.equal(rows.length, 1, '单实例展开仅一行');

  // ⑤ 悬浮框视口钳制纯函数（与 render.js positionTip 共用同一实现）：超高内容翻转后顶部钳回视口
  const { clampTip } = await import('../src/web/shared.js');
  const [cx, cy] = clampTip(100, 600, 200, 900, 1000, 800, 8);
  assert.equal(cy, 8, '超高悬浮框应钳到顶部（顶部可见，靠内部滚动看全）');
  assert.equal(cx, 100, 'x 轴未越界应原样保留');

  // ⑥ 技能等级分布 items（汇总手风琴技能养成用）：轴固定、dist 直方图、mine 数值形状
  const { skillDistItems } = await import('../src/web/wsRoles.js');
  for (const it of skillDistItems('仪玄')) {
    assert.equal(it.min, 1, '等级轴应从 1 起');
    assert.ok(it.max === 7 || it.max === 16, `等级轴上界应为核心技 7 / 其余 16（实际 ${it.max}）`);
    assert.equal(typeof it.dist, 'object', 'dist 应为每等级计数直方图');
    assert.ok(it.mine == null || Number.isFinite(it.mine), 'mine 应为数值或 null');
    assert.ok(it.mode == null || Number.isFinite(it.mode), 'mode（众数）应为数值或 null');
  }

  // ⑦ 驱动盘清理视图：全套装速查总览 + 选中套装清理卡（discCleaner 全路径 + 证据图注册）
  const { renderDrivenDiscs, setSelectedDisc } = await import('../src/web/discstats.js');
  setSelectedDisc('震星迪斯科');
  const dv = renderDrivenDiscs();
  assert.ok(dv.includes('全套装清理速查'), '应有总览表');
  assert.ok(dv.includes('清理决策卡'), '应有清理卡');
  assert.ok(dv.includes('逐槽判定'), '应有逐槽判定表');
  assert.ok(dv.includes('保留') && dv.includes('视词条') && dv.includes('分解'), '三级判定 chip 应齐全');
  assert.ok(dv.includes('有效副词条'), '应有有效副词条清单');
  assert.ok(
    dv.includes('4件套 · 官方推荐') && dv.includes('4件套 · 实际使用') && dv.includes('2件套 · 散件'),
    '适配角色双口径应渲染'
  );
  assert.ok(!dv.includes('NaN'), '驱动盘清理视图出现 NaN');
  // 荆棘玫瑰（未来套）：零实况也渲染、倾向标注 + 判定合理，不报错
  setSelectedDisc('荆棘玫瑰');
  const tj = renderDrivenDiscs();
  assert.ok(tj.includes('未来套'), '荆棘玫瑰应为未来套倾向');
  assert.ok(!tj.includes('NaN'), '未来套渲染出现 NaN');
  // ⑧ 覆盖层：设置覆盖后渲染应体现（倾向钉死 + 全部重置按钮），并清理
  data.userConfig.discCleanOverrides = { 荆棘玫瑰: { tendency: '冷门' } };
  setSelectedDisc('荆棘玫瑰');
  const ovHtml = renderDrivenDiscs();
  assert.ok(ovHtml.includes('冷门'), '覆盖倾向应生效（荆棘玫瑰 → 冷门）');
  assert.ok(ovHtml.includes('全部重置'), '有覆盖时应有全部重置按钮');
  assert.ok(ovHtml.includes('discCycleMain'), '判定 chip 应可点击循环');
  data.userConfig.discCleanOverrides = {}; // 清理，避免污染后续断言
});
