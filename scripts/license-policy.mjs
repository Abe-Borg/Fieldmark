// License policy for code shipped inside the Fieldmark application.
// Only licenses that place no copyleft or source-disclosure obligation on Fieldmark may be bundled.
// Attribution-only terms are satisfied by THIRD-PARTY-NOTICES.txt. Anything else must be reviewed before it is added.
export const ALLOWED = new Set(['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'BlueOak-1.0.0', 'Zlib', 'Unlicense', 'CC0-1.0', 'Python-2.0']);

// Evaluates an SPDX license expression against the allowlist. Precedence from lowest to highest is
// OR, AND, WITH, and parentheses group. A conjunction is acceptable only when every operand is; a
// disjunction when any operand is. "WITH <exception>" is never accepted automatically because an
// exception changes the base license's terms. Empty or malformed expressions are rejected.
export function acceptable(expression) {
  const tokens = String(expression ?? '').match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position] ?? '';
  const take = () => tokens[position++];
  const isOperator = token => /^(AND|OR|WITH)$/i.test(token ?? '');
  function primary() {
    const token = take();
    if (token === '(') {
      const value = disjunction();
      if (take() !== ')') throw new SyntaxError('Unbalanced parenthesis in license expression.');
      return value;
    }
    if (token === undefined || token === ')' || isOperator(token)) throw new SyntaxError('Expected a license identifier.');
    let value = ALLOWED.has(token.replace(/\+$/, ''));
    if (/^WITH$/i.test(peek())) {
      take();
      const exception = take();
      if (exception === undefined || exception === '(' || exception === ')' || isOperator(exception)) throw new SyntaxError('Expected a license exception identifier.');
      value = false;
    }
    return value;
  }
  function conjunction() {
    let value = primary();
    while (/^AND$/i.test(peek())) { take(); const operand = primary(); value = value && operand; }
    return value;
  }
  function disjunction() {
    let value = conjunction();
    while (/^OR$/i.test(peek())) { take(); const operand = conjunction(); value = value || operand; }
    return value;
  }
  try {
    const value = disjunction();
    return position === tokens.length && value;
  } catch {
    return false;
  }
}
