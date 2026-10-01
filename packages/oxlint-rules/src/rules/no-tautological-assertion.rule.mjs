import { defineRule } from "../define-rule.mjs";

// `expect(x).toBe(x)` compares a thing with itself: it passes through any
// rewrite of the code it appears to cover. Two calls or two property reads can
// differ, so `expect(f()).toBe(f())` is a determinism check and left alone.

const EQUALITY_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);

function isInert(node) {
  if (node.type === "Literal" || node.type === "Identifier") return true;

  return node.type === "TemplateLiteral" && node.expressions.length === 0;
}

function isTestFile(file) {
  return file.isTest;
}

function expectArgumentOf(object) {
  if (object?.type !== "CallExpression" || object.callee.type !== "Identifier") return void 0;

  return object.callee.name === "expect" && object.arguments.length === 1
    ? object.arguments[0]
    : void 0;
}

export const noTautologicalAssertionRule = defineRule({
  name: "no-tautological-assertion",
  kind: "problem",
  applies: isTestFile,
  messages: {
    assertsItself: {
      what: "`expect({{actual}}).{{matcher}}({{actual}})` compares a value with itself and cannot fail.",
      fix: "Assert the value the code produced against one derived independently of it.",
    },
  },
  create(context) {
    const source = context.sourceCode;

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (!EQUALITY_MATCHERS.has(callee.property.name) || node.arguments.length !== 1) return;
        const actual = expectArgumentOf(callee.object);
        if (!actual || !isInert(actual)) return;
        const actualText = source.getText(actual);
        if (actualText !== source.getText(node.arguments[0])) return;
        context.report({
          node,
          messageId: "assertsItself",
          data: { actual: actualText, matcher: callee.property.name },
        });
      },
    };
  },
});
