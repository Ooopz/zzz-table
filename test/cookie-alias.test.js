// test/cookie-alias.test.js —— 米游社新版登录 ltoken_v2 → 旧 ltoken 别名（mihoyo-api.withLtokenAlias）
// 新登录只下发 ltoken_v2，act 游戏工具接口仍按 ltoken 校验；发送前缺 ltoken 时用 v2 值补上。
import test from 'node:test';
import assert from 'node:assert/strict';
import { withLtokenAlias } from '../src/sync/mihoyo-api.js';

test('缺 ltoken 但有 ltoken_v2：补成 ltoken=v2 值', () => {
  const out = withLtokenAlias({ account_id: '1', ltuid: '2', ltoken_v2: 'abc', e_nap_token: 't' });
  assert.equal(out.ltoken, 'abc');
  assert.equal(out.ltoken_v2, 'abc'); // 原键保留
  assert.equal(out.account_id, '1');
});

test('已有 ltoken：不覆盖（原样返回同一引用）', () => {
  const c = { ltoken: 'legacy', ltoken_v2: 'v2' };
  assert.equal(withLtokenAlias(c), c); // 无改动，不新建对象
});

test('无 ltoken_v2 / 无 cookie：原样返回', () => {
  assert.equal(withLtokenAlias(null), null);
  const c = { ltoken: 'x' }; // 有 ltoken 无 v2，无需别名
  assert.equal(withLtokenAlias(c), c);
});
