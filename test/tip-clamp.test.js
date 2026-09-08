// test/tip-clamp.test.js —— clampTip 视口钳制纯函数（悬浮框超高/超宽或指针贴顶/左缘时，顶部/左缘钳回视口内）。
// 纯内联，不依赖 data/，永不 SKIP。shared.js 无 DOM 依赖，node:test 可直接 import。
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampTip } from '../src/web/shared.js';

const GAP = 8;

test('clampTip：内容完全放得下时原样返回', () => {
  assert.deepEqual(clampTip(100, 200, 300, 200, 1000, 800, GAP), [100, 200]);
});

test('clampTip：右缘溢出时钳到视口内（右缘留 8px）', () => {
  const [x, y] = clampTip(900, 200, 200, 100, 1000, 800, GAP);
  assert.equal(x, 1000 - 200 - GAP);
  assert.equal(y, 200);
});

test('clampTip：下缘溢出时钳到视口内（下缘留 8px）', () => {
  const [x, y] = clampTip(100, 750, 200, 100, 1000, 800, GAP);
  assert.equal(x, 100);
  assert.equal(y, 800 - 100 - GAP);
});

test('clampTip：左缘越界时钳到 8px（旧版只翻转右/下，左缘会出屏）', () => {
  assert.deepEqual(clampTip(-50, 200, 200, 100, 1000, 800, GAP), [GAP, 200]);
});

test('clampTip：顶部越界时钳到 8px', () => {
  assert.deepEqual(clampTip(100, -30, 200, 100, 1000, 800, GAP), [100, GAP]);
});

test('clampTip：悬浮框高于视口时钳到顶部（顶部内容可见，靠内部滚动看全）——回归：超高翻转后顶部不可达', () => {
  const [x, y] = clampTip(100, 600, 200, 900, 1000, 800, GAP);
  assert.equal(y, GAP);
  assert.equal(x, 100);
});

test('clampTip：比视口还宽时钳到左缘 8px', () => {
  const [x, y] = clampTip(400, 200, 1200, 100, 1000, 800, GAP);
  assert.equal(x, GAP);
  assert.equal(y, 200);
});

test('clampTip：双轴同时越界各自钳制', () => {
  assert.deepEqual(clampTip(-5, -5, 400, 600, 1000, 800, GAP), [GAP, GAP]);
});

test('clampTip：gap 默认 8px（与 .tip max-height 的 calc(100vh - 16px) 边距同值）', () => {
  assert.deepEqual(clampTip(-1, -1, 50, 50, 500, 500), [8, 8]);
});
