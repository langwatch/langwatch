import { defineRule } from "../define-rule.mjs";

// A `describe` whose sibling `it`/`test` bodies share a 3+ statement prefix
// has setup pasted into every test instead of a `beforeEach`. NO-FIX: only
// 10 of 221 measured (2026-09-15) splice safely — the rest need a `let`
// hoisted by hand because the prefix declares, awaits, or sits above a
// nested describe. Reported anyway: a human can still hoist those by hand.

const WHITESPACE = /\s+/g;
const MINIMUM_SHARED_STATEMENTS = 3;
const FAMILY_ROOT_MAX_DEPTH = 4;
const ASSERTION_CHAIN_MAX_DEPTH = 8;
const ASSERTION_ROOT = /^(?:expect|assert)$/;

function isDescribeCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "describe"
  );
}

/** The statement list of a function's block body, or undefined for anything else
 * (missing argument, non-function, or a concise arrow with no block). */
function blockBodyOf(node) {
  if (!node) return undefined;
  if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") {
    return undefined;
  }
  if (!node.body || node.body.type !== "BlockStatement") return undefined;

  return node.body.body;
}

/** Unwraps a call chain to its rooted identifier, so `it.skip(...)` and
 * `it.each(table)(...)` still resolve to `it` even though the outer call's
 * own callee is a `MemberExpression` or a second `CallExpression`. Depth is
 * bounded — no real chain runs deeper than this. */
function familyRoot(node) {
  let current = node;
  for (let depth = 0; current && depth < FAMILY_ROOT_MAX_DEPTH; depth += 1) {
    if (current.type === "Identifier") return current.name;
    if (current.type === "MemberExpression" && !current.computed) {
      current = current.object;
      continue;
    }
    if (current.type === "CallExpression") {
      current = current.callee;
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** The sibling `it`/`test` bodies of one `describe`, or undefined when the set
 * can't be verified: fewer than two qualifying tests, or an `it`/`test`
 * child that isn't a bare block-body call (`it.skip`, `it.each(...)(...)`,
 * `it.todo`, a concise arrow) — any of those disqualifies the whole
 * describe. A nested `describe` child is simply skipped, never disqualifying. */
function siblingTestBodiesOf(describeCall) {
  const statements = blockBodyOf(describeCall.arguments[1]);
  if (!statements) return undefined;

  const tests = statements.map(testCallOf).filter(Boolean);
  const siblingBodies = tests.map(bareTestBodyOf).filter(Boolean);
  // One it.skip, it.each, it.todo or concise body among them leaves the describe alone.
  if (siblingBodies.length < 2 || siblingBodies.length !== tests.length) return undefined;

  return siblingBodies;
}

/** The `it`/`test`-family call a statement makes; hooks and nested describes are not tests. */
function testCallOf(statement) {
  if (statement.type !== "ExpressionStatement") return undefined;
  const { expression } = statement;
  if (expression.type !== "CallExpression") return undefined;
  const root = familyRoot(expression.callee);

  return root === "it" || root === "test" ? expression : undefined;
}

/** A plain `it("...", () => { ... })` body; anything patterned or concise is undefined. */
function bareTestBodyOf(call) {
  return call.callee.type === "Identifier" ? blockBodyOf(call.arguments[1]) : undefined;
}

/** `expect(x).not.toBe(y)`, `await expect(p).rejects.toThrow()`, `assert.equal(...)`. */
function isAssertion(statement) {
  let current = statement.type === "ExpressionStatement" ? statement.expression : undefined;
  for (let depth = 0; current && depth < ASSERTION_CHAIN_MAX_DEPTH; depth += 1) {
    if (current.type === "Identifier") return ASSERTION_ROOT.test(current.name);
    if (current.type === "AwaitExpression") current = current.argument;
    else if (current.type === "CallExpression") current = current.callee;
    else if (current.type === "MemberExpression") current = current.object;
    else return false;
  }
  return false;
}

function normalizedStatementText(source, statement) {
  return source.slice(statement.range[0], statement.range[1]).replace(WHITESPACE, " ").trim();
}

/** The leading run of statements identical (whitespace aside) in every sibling,
 * ending at the first assertion: setup is what precedes it. Each sibling is
 * compared only against the first, so the cost is linear, not quadratic. */
function sharedPrefixLength(source, siblingBodies) {
  const [first, ...rest] = siblingBodies;
  let index = 0;

  while (index < first.length) {
    const statement = first[index];
    if (isAssertion(statement)) break;
    const text = normalizedStatementText(source, statement);
    const stillShared = rest.every((body) => {
      const candidate = body[index];
      return candidate !== undefined && normalizedStatementText(source, candidate) === text;
    });
    if (!stillShared) break;
    index += 1;
  }

  return index;
}

export const sharedSetupIsAHookRule = defineRule({
  name: "shared-setup-is-a-hook",
  kind: "problem",
  applies: (file) => file.isTest,
  messages: {
    siblingTestsRepeatSetup: {
      what: "These {{count}} sibling tests each open with the same {{shared}} statements.",
      why: "Setup pasted into every sibling drifts one body at a time.",
      fix:
        "Move the repeated statements into a `beforeEach(() => { ... })` at the top of this" +
        " `describe` and delete them from each test.",
    },
  },
  create(context, _file) {
    const source = context.sourceCode.text;

    return {
      CallExpression(node) {
        if (!isDescribeCall(node)) return;

        const siblingBodies = siblingTestBodiesOf(node);
        if (!siblingBodies) return;

        const shared = sharedPrefixLength(source, siblingBodies);
        if (shared < MINIMUM_SHARED_STATEMENTS) return;

        context.report({
          node: node.arguments[0],
          messageId: "siblingTestsRepeatSetup",
          data: { count: siblingBodies.length, shared },
        });
      },
    };
  },
});
