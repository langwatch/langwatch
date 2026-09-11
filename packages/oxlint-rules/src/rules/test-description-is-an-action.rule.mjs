import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A title states what the test does ("checks local first"), not a prediction
// about what it should do ("should check local first") — the "should" is
// silent noise repeated on every line. Nested `describe` blocks read as BDD
// structure instead of a flat list: the outer block names the given
// precondition, the inner block names the when-action, so a nested block
// with neither prefix has lost that structure. A top-level `describe` names
// the unit under test and is exempt from the given/when requirement.

const TEST_FILE = /\.test\.tsx?$/;
const GIVEN_OR_WHEN = /^(?:given|when)\s/;
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
      what: 'This nested `describe` title does not start with "given " or "when ".',
      why: "Nested `describe` blocks read as BDD structure: an outer `given <precondition>`, an inner `when <action>`.",
      fix: 'Rename it to start with "given " or "when ".',
    },
  },
  create(context, file) {
    if (!isGoverned(file)) return {};
    if (
      isBaselined({
        cwd: context.cwd,
        file: file.workspacePath,
        rule: "test-description-is-an-action",
      })
    ) {
      return {};
    }

    return {
      CallExpression(node) {
        if (isDescribeCall(node)) {
          const title = node.arguments[0];
          const text = titleText(title);
          if (text !== undefined && enclosingDescribe(node) && !GIVEN_OR_WHEN.test(text)) {
            context.report({ node: title, messageId: "nestedDescribeMissingGivenWhen" });
          }
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
