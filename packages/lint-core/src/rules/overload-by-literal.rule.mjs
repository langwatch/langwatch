import { OVERLOAD_BY_LITERAL_ALLOWED } from "../../grammar/overengineering.mjs";
import { defineRule } from "../define-rule.mjs";
import { isOverengineeringFile, reportsFor } from "./overengineering.mjs";

// Two overloads that differ only by a boolean literal are one function the
// caller has to diff two signatures to understand.

export const overloadByLiteralRule = defineRule({
  name: "overload-by-literal",
  kind: "problem",
  applies: isOverengineeringFile,
  messages: {
    splitTheOverloads: {
      what: "{{message}}",
      why: "An overload set that only flips a flag makes the reader diff two signatures to learn one thing.",
      fix: "{{allowed}}",
    },
  },
  create(context, file) {
    return {
      Program(program) {
        for (const finding of reportsFor(context, file, "overload-by-literal", program)) {
          context.report({
            node: finding.node,
            messageId: "splitTheOverloads",
            data: { allowed: OVERLOAD_BY_LITERAL_ALLOWED, message: finding.message },
          });
        }
      },
    };
  },
});
