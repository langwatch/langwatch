import { CONDITIONAL_TYPE_DEPTH_ALLOWED } from "../../grammar/overengineering.mjs";
import { defineRule } from "../define-rule.mjs";
import { isOverengineeringFile, reportsFor } from "./overengineering.mjs";

// A conditional type nested past a few levels is a computation nobody can
// evaluate by eye, deriving what a plain declaration could have stated.

export const conditionalTypeDepthRule = defineRule({
  name: "conditional-type-depth",
  kind: "problem",
  applies: isOverengineeringFile,
  messages: {
    stateTheShape: {
      what: "{{message}}",
      why: "A type this deep re-computes what a plain interface or discriminated union already says.",
      fix: "{{allowed}}",
    },
  },
  create(context, file) {
    return {
      Program(program) {
        for (const finding of reportsFor(context, file, "conditional-type-depth", program)) {
          context.report({
            node: finding.node,
            messageId: "stateTheShape",
            data: { allowed: CONDITIONAL_TYPE_DEPTH_ALLOWED, message: finding.message },
          });
        }
      },
    };
  },
});
