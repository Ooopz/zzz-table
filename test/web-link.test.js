// test/web-link.test.js —— 前端模块图「链接护栏」（技术债护栏，防整页白屏）：
// src/web 的 ESM 具名导入在链接期校验，一处 export 对不上则整条模块图不执行——
// main.js 的 try/catch 救不了（异常在 import 解析期，不在 try 体内），eslint 也抓不到（历史事故）。
// 本测试在 Node 里动态 import 每个 src/web/*.js：链接/解析期错误（导出名对不上、找不到模块、
// 语法错误）一律判失败；只放行执行期错误（document/window/location 等浏览器全局缺失、
// fetch 相对 URL 等——Node 没有浏览器环境，这些属预期）。
// 注意：护栏只验「链接」不验「执行」——运行时行为仍需 npm start 手动确认。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

// 被 import 的模块若在顶层发起 fire-and-forget 异步（如 collect.js 的采集主流程），
// 在 Node 里必然失败并晚于测试结束才炸成 unhandledRejection——全部静默（护栏只关心链接期）。
process.on('unhandledRejection', () => {});

test('前端模块图链接护栏：src/web 每个模块的 import 图都能通过 ESM 链接（回归：export 搬移漏改导入源曾整页白屏）', async () => {
  const dir = new URL('../src/web/', import.meta.url);
  // collect.js 是采集书签脚本：独立运行、不在 main.js 的模块图内，且顶层主流程
  // fire-and-forget 异步并引用 alert——在 Node 里无法安静 import，护栏跳过它。
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'collect.js')
    .sort();
  assert.ok(files.length >= 10, `src/web 下应能列出模块文件，实际只有 ${files.length} 个（目录位置变了？）`);

  const linkErrors = [];
  for (const f of files) {
    try {
      await import(new URL(f, dir).href);
    } catch (err) {
      // 链接/解析期错误 = 模块图根本无法建立 = 浏览器里整页白屏
      const isLinkError =
        err instanceof SyntaxError ||
        err.code === 'ERR_MODULE_NOT_FOUND' ||
        /does not provide an export named|Failed to resolve module specifier|Cannot find (?:module|package)/.test(
          err.message
        );
      if (isLinkError) linkErrors.push(`${f}: ${err.message}`);
      // 其余视为执行期错误，放行（依赖浏览器全局的模块在 Node 里必然抛）
    }
  }
  assert.deepEqual(linkErrors, [], `以下前端模块链接失败（页面会白屏）：\n${linkErrors.join('\n')}`);
});
