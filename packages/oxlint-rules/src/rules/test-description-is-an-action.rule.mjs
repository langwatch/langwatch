import { defineRule } from "../define-rule.mjs";

// A title states what the test does ("checks local first"), not a prediction
// ("should check local first") - noise repeated on every line. Nested
// `describe` blocks read as BDD: outer names the given, inner the when-action;
// a top-level `describe` names the unit under test and is exempt.

const TEST_FILE = /\.test\.tsx?$/;
const GIVEN_WHEN_AND = /^(?:given|when|and)\s/;
// TESTING_PHILOSOPHY.md blesses one further level of nesting before given/when
// starts: a `describe` naming the unit MDN-style (`ClassName`, `methodName()`,
// `<Component/>`, `useHook()`). Each form is one token with no spaces, so a
// condition title ("given a warm cache", "submit behavior") never matches.
const MDN_UNIT_NAME = /^(?:<\w+\s*\/?>|[\w.$]+\(\)|use[A-Z]\w*|[A-Z][A-Za-z0-9]*)$/;
const SHOULD = /^should\b/i;

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

function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier") {
    return callee.object.name;
  }
  return undefined;
}

function isTestCall(node) {
  if (node.type !== "CallExpression") return false;
  const name = calleeName(node.callee);
  return name === "it" || name === "test";
}

function isDescribeCall(node) {
  return node.type === "CallExpression" && calleeName(node.callee) === "describe";
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

/** Reports a nested `describe` whose title is neither given/when/and nor an MDN-style unit name. */
function checkDescribeTitle(node, context) {
  const title = node.arguments[0];
  const text = titleText(title);
  if (text === undefined) return;
  if (!enclosingDescribe(node)) return;
  if (GIVEN_WHEN_AND.test(text)) return;
  if (MDN_UNIT_NAME.test(text)) return;
  context.report({ node: title, messageId: "nestedDescribeMissingGivenWhen" });
}

export const testDescriptionIsAnActionRule = defineRule({
  name: "test-description-is-an-action",
  kind: "problem",
  messages: {
    titleStartsWithShould: {
      what: "This test title starts with \"should\".",
      why: 'A title is an action ("checks local first"), not a prediction ("should check local first").',
      fix: 'Rename it to state what the test does, dropping the leading "should".',
    },
    nestedDescribeMissingGivenWhen: {
      what:
        'This nested `describe` title does not start with "given ", "when " or "and ", and does not name the unit under test.',
      why: "Nested `describe` blocks read as BDD structure: an outer `given <precondition>`, an inner `when <action>`.",
      fix:
        'Rename it to a condition: "given <precondition>" if it sets up state, "when <action>" if it performs the behaviour under test.',
    },
  },
  create(context, file) {
    if (!isGoverned(file)) return {};

    return {
      CallExpression(node) {
        if (isDescribeCall(node)) {
          checkDescribeTitle(node, context);
          return;
        }

        if (isTestCall(node)) {
          const title = node.arguments[0];
          const text = titleText(title);
          if (text !== undefined && SHOULD.test(text)) {
            context.report({ node: title, messageId: "titleStartsWithShould" });
          }
        }
      },
    };
  },
});
