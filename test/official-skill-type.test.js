// test/official-skill-type.test.js —— 技能 type「官方编号 → canonical」映射双副本对账
// 映射常量在 sync/characters.js 与 sync/workshop.js 各留一份（仿 collect.js↔mihoyo-api.js 自包含先例，
// 改任一处必须同步另一处）；两份漂移在此标红。落盘数据一律 canonical，读取侧不做映射。
import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFICIAL_SKILL_TYPE as CHAR_MAP } from '../src/sync/characters.js';
import { OFFICIAL_SKILL_TYPE as WS_MAP } from '../src/sync/workshop.js';

test('技能映射双副本逐位一致', () => {
  assert.deepEqual({ ...CHAR_MAP }, { ...WS_MAP });
});

test('映射域正确：官方键恰为 0/1/2/3/5/6（无 4），落点全在 canonical 0..5', () => {
  assert.deepEqual(
    Object.keys(CHAR_MAP).map(Number).sort((a, b) => a - b),
    [0, 1, 2, 3, 5, 6],
    '官方语义无 4（官方 3 = 连携/终结）；出现 4 说明与 canonical 域混淆'
  );
  for (const [src, dst] of Object.entries(CHAR_MAP)) {
    assert.ok(Number(dst) >= 0 && Number(dst) <= 5, `官方 ${src} → ${dst} 越出 canonical 0..5`);
  }
});
