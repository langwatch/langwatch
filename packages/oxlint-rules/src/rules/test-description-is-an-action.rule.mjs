import { defineRule } from "../define-rule.mjs";

// Nested `describe` blocks read as BDD: the outer names the given, the inner
// the when-action; a top-level `describe` names the unit under test and is
// exempt. A "should ..." test title is vitest/valid-title's, in .oxlintrc.jsonc.

const TEST_FILE = /\.test\.tsx?$/;
const GIVEN_WHEN_AND = /^(?:given|when|and)\s/;
// TESTING_PHILOSOPHY.md blesses one level naming the unit MDN-style before
// given/when starts: `ClassName`, `methodName()`, `<Component/>`, `useHook()`.
const MDN_UNIT_NAME = /^(?:<\w+\s*\/?>|[\w.$]+\(\)|use[A-Z]\w*|[A-Z][A-Za-z0-9]*)$/;

function isGoverned(file) {
  return TEST_FILE.test(file.workspacePath);
}

/** The literal string a title node holds, from a plain string or a plain template literal. */
function titleText(node) {
  if (!node) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw;
  }
  return undefined;
}

/** `describe`, `describe.skip`, and the table form `describe.each(rows)` all name a describe. */
function isDescribeCallee(callee) {
  if (callee.type === "Identifier") return callee.name === "describe";
  if (callee.type === "CallExpression") return isDescribeCallee(callee.callee);
  if (callee.type !== "MemberExpression" || callee.computed) return false;

  return isDescribeCallee(callee.object);
}

function isDescribeCall(node) {
  return node.type === "CallExpression" && isDescribeCallee(node.callee);
}

/** The nearest enclosing `describe(...)` call, or undefined for a top-level one. */
function enclosingDescribe(node) {
  let current = node.parent;
  while (current) {
    if (isDescribeCall(current)) return current;
    current = current.parent;
  }
  return undefined;
}

export const testDescriptionIsAnActionRule = defineRule({
  name: "test-description-is-an-action",
  kind: "problem",
  messages: {
    nestedDescribeMissingGivenWhen: {
      what: 'This nested `describe` title does not start with "given ", "when " or "and ", and does not name the unit under test.',
      why: "Nested `describe` blocks read as BDD structure: an outer `given <precondition>`, an inner `when <action>`.",
      fix: 'Rename it to a condition: "given <precondition>" if it sets up state, "when <action>" if it performs the behaviour under test.',
    },
  },
  create(context, file) {
    if (!isGoverned(file)) return {};

    return {
      CallExpression(node) {
        if (!isDescribeCall(node)) return;
        const text = titleText(node.arguments[0]);
        if (text === undefined) return;
        if (!enclosingDescribe(node)) return;
        if (GIVEN_WHEN_AND.test(text) || MDN_UNIT_NAME.test(text)) return;

        context.report({ node: node.arguments[0], messageId: "nestedDescribeMissingGivenWhen" });
      },
    };
  },
});
