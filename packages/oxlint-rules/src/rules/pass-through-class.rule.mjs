import { LAYER_CLASS_ALLOWED } from "../../grammar/overengineering.mjs";
import { defineRule } from "../define-rule.mjs";
import { isOverengineeringFile, reportsFor } from "./overengineering.mjs";

// Detects a forwarding class: its public methods almost all call the method of
// the same name on one collaborator. The message names the class, the count
// and the receiver so the reader can decide without opening it.

export const passThroughClassRule = defineRule({
  name: "pass-through-class",
  kind: "problem",
  applies: isOverengineeringFile,
  messages: {
    passThrough: {
      what: "{{message}}",
      why: "A pass-through class costs every reader a hop and every caller an indirection, and hides nothing.",
      fix: "{{allowed}}",
    },
  },
  create(context, file) {
    return {
      Program(program) {
        for (const finding of reportsFor(context, file, "pass-through-class", program)) {
          context.report({
            node: finding.node,
            messageId: "passThrough",
            data: { allowed: LAYER_CLASS_ALLOWED, message: finding.message },
          });
        }
      },
    };
  },
});
