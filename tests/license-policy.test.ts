import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED, acceptable } from '../scripts/license-policy.mjs';

test('license policy evaluates SPDX expressions with correct precedence and grouping', () => {
  assert.ok(ALLOWED.has('MIT') && !ALLOWED.has('GPL-3.0-only'));
  for (const expression of ['MIT', 'BSD-2-Clause', '(MIT OR CC0-1.0)', 'WTFPL OR ISC', 'GPL-2.0-only OR MIT', 'MIT AND BSD-3-Clause', '(GPL-3.0-only OR (MIT AND BSD-3-Clause))', 'GPL-2.0-only OR MIT AND BSD-3-Clause', 'MIT or GPL-3.0-only']) {
    assert.equal(acceptable(expression), true, expression);
  }
  for (const expression of ['GPL-3.0-only AND (MIT OR Apache-2.0)', '(MIT OR Apache-2.0) AND GPL-3.0-only', 'MIT AND GPL-2.0-only', 'MIT AND (GPL-2.0-only OR LGPL-2.1-only)', 'GPL-3.0-only', 'Apache-2.0 WITH LLVM-exception', 'SEE LICENSE IN LICENSE', 'UNLICENSED', '', 'MIT OR', '(MIT', 'MIT)', 'AND MIT', 'MIT WITH', 'MIT MIT']) {
    assert.equal(acceptable(expression), false, expression || '<empty>');
  }
});
