import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A `describe` whose sibling `it`/`test` bodies share a 3+ statement prefix
// has setup pasted into every test instead of a `beforeEach`. NO-FIX: only
// 10 of 221 measured (2026-09-15) splice safely — the rest need a `let`
// hoisted by hand because the prefix declares, awaits, or sits above a
// nested describe. Reported anyway: a human can still hoist those by hand.

const WHITESPACE = /\s+/g;
const MINIMUM_SHARED_STATEMENTS = 3;
const FAMILY_ROOT_MAX_DEPTH = 4;

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

  let testFamilyCount = 0;
  const siblingBodies = [];

  for (const statement of statements) {
    if (statement.type !== "ExpressionStatement") continue;
    const expression = statement.expression;
    if (expression.type !== "CallExpression") continue;

    const root = familyRoot(expression.callee);
    if (root === "describe") continue; // nested describe: ignored, never disqualifies
    if (root !== "it" && root !== "test") continue; // hooks and anything else: not a sibling test

    testFamilyCount += 1;
    const isBareCall = expression.callee.type === "Identifier";
    const body = isBareCall ? blockBodyOf(expression.arguments[1]) : undefined;
    if (body) siblingBodies.push(body);
  }

  if (siblingBodies.length < 2) return undefined;
  // Every it/test-family child qualified as a plain sibling body — if one
  // didn't (it.skip, it.each, it.todo, a non-block body), the counts differ
  // and the whole describe is left alone.
  if (siblingBodies.length !== testFamilyCount) return undefined;

  return siblingBodies;
}

function normalizedStatementText(source, statement) {
  return source.slice(statement.range[0], statement.range[1]).replace(WHITESPACE, " ").trim();
}

/** The length of the leading run of statements that read identically, verbatim
 * (whitespace aside), across every sibling body. Compares each sibling only
 * against the first — never sibling against sibling — so the cost is linear
 * in siblings times shared statements, not quadratic in either. */
function sharedPrefixLength(source, siblingBodies) {
  const [first, ...rest] = siblingBodies;
  let index = 0;

  while (index < first.length) {
    const statement = first[index];
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
        "Move the repeated statements into a `beforeEach(() => { ... })` at the top of this"
        + " `describe` and delete them from each test.",
    },
  },
  create(context, file) {
    if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "shared-setup-is-a-hook" })) {
      return {};
    }

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
