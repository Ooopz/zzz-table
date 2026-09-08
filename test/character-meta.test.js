// test/character-meta.test.js —— 角色固有元数据枚举(属性/职业/阵营)对现有 data/library.json 的覆盖校验
// 运行期对未知值放行(按文本处理)；新角色带来新取值时本测试标红 → 补录 src/game/characterMeta.js 后转绿。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENT_SET, TRAIT_SET, FACTION_SET } from '../src/game/index.js';
import { loadDataFile } from './helpers.js';

test('枚举自身：非空且值无重复', () => {
  for (const [name, set] of [['ELEMENT_SET', ELEMENT_SET], ['TRAIT_SET', TRAIT_SET], ['FACTION_SET', FACTION_SET]]) {
    assert.ok(set.size > 0, `${name} 为空`);
    const vals = [...set];
    assert.equal(new Set(vals).size, vals.length, `${name} 值重复`);
  }
});

test('现有角色库的属性/职业/阵营均落在枚举内', () => {
  const lib = loadDataFile('library.json', 'npm run sync:library');
  const chars = Object.values(lib.characters || {});
  assert.ok(chars.length > 0, 'library 无角色');
  const miss = { element: [], trait: [], faction: [] };
  for (const c of chars) {
    if (c.element != null && !ELEMENT_SET.has(c.element)) miss.element.push(`${c.name}:${c.element}`);
    if (c.trait != null && !TRAIT_SET.has(c.trait)) miss.trait.push(`${c.name}:${c.trait}`);
    if (c.faction != null && !FACTION_SET.has(c.faction)) miss.faction.push(`${c.name}:${c.faction}`);
  }
  const lines = [];
  for (const [k, v] of Object.entries(miss))
    if (v.length) lines.push(`${k} 未知值: ${v.slice(0, 8).join(', ')}${v.length > 8 ? ` …共${v.length}` : ''}`);
  assert.deepEqual(lines, [], `发现未入枚举的取值（请在 src/game/characterMeta.js 补录）:\n  - ${lines.join('\n  - ')}`);
});
