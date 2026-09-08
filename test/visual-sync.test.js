// test/visual-sync.test.js —— 视觉令牌同步守卫：visual.js（唯一权威）与 style.css :root 镜像逐项一致。
// 改色必须同时改 visual.js 与 style.css，任一侧漏改 → 本测试红，杜绝「手工同步两份真相」的漂移。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CSS_TOKENS } from '../src/web/visual.js';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
// 提取 :root{...} 块内全部 --token: value; 对
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const rootTokens = new Map();
for (const m of rootBlock.matchAll(/--[\w-]+\s*:\s*[^;]+;/g)) {
  const [k, v] = m[0].split(':');
  rootTokens.set(k.trim(), v.trim().replace(/;$/, '')); // 去掉尾随分号
}

test('visual.js 与 style.css :root 颜色令牌同步（视觉单源，改色须两侧同改）', () => {
  const missing = [];
  const mismatch = [];
  for (const [k, v] of Object.entries(CSS_TOKENS)) {
    if (!rootTokens.has(k)) missing.push(k);
    else if (norm(rootTokens.get(k)) !== norm(v)) mismatch.push(`${k}: css=${rootTokens.get(k)} vs visual.js=${v}`);
  }
  assert.deepEqual(missing, [], `style.css :root 缺失的令牌（visual.js 定义了）`);
  assert.deepEqual(mismatch, [], `令牌值不一致（visual.js 是权威，须同步 style.css）`);
});

test('style.css :root 无多余的纯颜色令牌未登记进 visual.js（防新令牌漏登记）', () => {
  // 仅校验 hex / rgb 三元组 / rgba 形式的颜色令牌（排除 grad-*/font/sp 等非视觉.js 权威项）
  const visualKeys = new Set(Object.keys(CSS_TOKENS));
  const extra = [];
  for (const [k, v] of rootTokens) {
    if (visualKeys.has(k)) continue;
    if (
      k.startsWith('--grad-') ||
      k.startsWith('--font') ||
      k.startsWith('--fs-') ||
      k.startsWith('--sp-') ||
      k.startsWith('--lh-')
    )
      continue;
    if (
      /^#([0-9a-f]{3,8})$/i.test(v.trim()) ||
      /^[0-9]+,?\s*[0-9]+,?\s*[0-9]+$/.test(v.trim()) ||
      /^rgba\(/.test(v.trim())
    ) {
      extra.push(`${k}: ${v}`);
    }
  }
  assert.deepEqual(extra, [], `style.css 有未登记进 visual.js 的颜色令牌（应加入 CSS_TOKENS）`);
});
