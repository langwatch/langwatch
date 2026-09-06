import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A ternary inside a ternary's consequent or alternate is a decision tree
// written sideways: the reader has to hold both branches in mind while
// re-parsing the nested one. This replaces the native `no-nested-ternary`,
// which cannot consult the baseline, so the debt it used to carry as a
// hand-written file-list override now lives in oxlint-baseline.json instead.

export const nestedTernaryRule = defineRule({
  name: "nested-ternary",
  kind: "problem",
  messages: {
    nested: {
      what: "A ternary is nested inside another ternary's {{position}}.",
      why: "A decision tree written sideways forces the reader to re-parse it every time.",
      fix: "Extract the inner ternary into a named variable, or rewrite as an if/else chain.",
    },
  },
  create(context, file) {
    return {
      ConditionalExpression(node) {
        if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "nested-ternary" })) {
          return;
        }

        for (const position of ["consequent", "alternate"]) {
          if (node[position]?.type === "ConditionalExpression") {
            context.report({ data: { position }, messageId: "nested", node: node[position] });
          }
        }
      },
    };
  },
});
