import { LAYER_CLASS_ALLOWED } from "../../grammar/overengineering.mjs";
import { defineRule } from "../define-rule.mjs";
import { isOverengineeringFile, reportsFor } from "./overengineering.mjs";

// A class whose public methods almost all forward, under the same name, to
// the same collaborator is a hop, not a layer. The message names the class,
// the count and the receiver so the reader can decide without opening it.

export const layerClassRule = defineRule({
  name: "layer-class",
  kind: "problem",
  applies: isOverengineeringFile,
  messages: {
    deleteTheLayer: {
      what: "{{message}}",
      why: "A pass-through class costs every reader a hop and every caller an indirection, and hides nothing.",
      fix: "{{allowed}}",
    },
  },
  create(context, file) {
    return {
      Program(program) {
        for (const finding of reportsFor(context, file, "layer-class", program)) {
          context.report({
            node: finding.node,
            messageId: "deleteTheLayer",
            data: { allowed: LAYER_CLASS_ALLOWED, message: finding.message },
          });
        }
      },
    };
  },
});
