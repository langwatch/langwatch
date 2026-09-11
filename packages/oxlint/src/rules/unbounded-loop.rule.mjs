import { defineRule } from "../define-rule.mjs";

// `for (;;)` and `while (true)` put the exit somewhere in the body, so the
// reader has to find every `return`, `break` and `throw` to learn when the
// loop stops. A wait carries its deadline in the header; a retry counts a
// named budget; a poll runs while time remains.

function isStrictServerSource(file) {
  return file.role === "server" && file.layoutVersion === 0 && Boolean(file.strictSource);
}

function isLiteralTrue(node) {
  return node?.type === "Literal" && node.value === true;
}

export const unboundedLoopRule = defineRule({
  name: "unbounded-loop",
  kind: "problem",
  applies: (file) => file.isProduction && isStrictServerSource(file),
  messages: {
    unboundedLoop: {
      what: "This `{{form}}` loop states no exit condition in its header.",
      why: "When the exit lives in the body the reader has to find every return, break and throw to know when the loop ends.",
      fix: "Put the deadline or the retry budget in the header, or move the waiting into a method whose signature carries it.",
    },
  },
  create(context) {
    return {
      ForStatement(node) {
        if (node.test) return;

        context.report({ node, messageId: "unboundedLoop", data: { form: "for (;;)" } });
      },
      WhileStatement(node) {
        if (!isLiteralTrue(node.test)) return;

        context.report({ node, messageId: "unboundedLoop", data: { form: "while (true)" } });
      },
      DoWhileStatement(node) {
        if (!isLiteralTrue(node.test)) return;

        context.report({ node, messageId: "unboundedLoop", data: { form: "do … while (true)" } });
      },
    };
  },
});
