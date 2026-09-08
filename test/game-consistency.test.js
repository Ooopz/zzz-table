// test/game-consistency.test.js —— src/game 权威层防漂移自检
// 任何在 game 内漏项/越界/与权威名单不一致(如百分比名单漏「穿透率」、成长表多出 SUBSTAT 没有的词条)都该在此标红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreConsistencyIssues } from '../src/game/index.js';

test('权威层一致性问题为空（当前无漂移）', () => {
  const issues = coreConsistencyIssues();
  assert.deepEqual(issues, [], `发现漂移:\n  - ${issues.join('\n  - ')}`);
});
