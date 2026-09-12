import { defineRule } from "../define-rule.mjs";
import { createZodSchemaResolver, memberName } from "./zod-schema-origin.mjs";

function isSchemaSource(file) {
  return (
    file.isProduction &&
    !/(?:^|\/)(?:generated|dist|node_modules)\/|(?:\.generated|\.d)\.[cm]?[jt]sx?$/.test(
      file.workspacePath,
    )
  );
}

export const zodObjectCompositionRule = defineRule({
  name: "zod-object-composition",
  kind: "problem",
  applies: isSchemaSource,
  messages: {
    spreadShape: {
      what: "Zod .{{method}}() composes object types through mapped generics.",
      why: "Shape spreads avoid repeated generic instantiation when constructing derived schemas.",
      fix: "Compose with z.object({ ...base.shape, ...fields }); preserve strictness and catchalls with the matching object constructor and .catchall(). Use .safeExtend() when refinement or assignability checks must be retained.",
    },
    keepRefinements: {
      what: "This Zod object carries refinements before .{{method}}().",
      why: "Spreading its shape alone would discard those checks.",
      fix: "Use .safeExtend() to retain refinements, or apply the refinements to the final composed object.",
    },
  },
  create(context, file) {
    let origin;
    return {
      CallExpression(node) {
        const method = memberName(node.callee);
        if (method !== "extend" && method !== "merge") return;
        origin ??= createZodSchemaResolver(context, file.filename);
        const kind = origin(node.callee.object);
        if (kind !== "object" && kind !== "refined") return;
        context.report({
          node,
          messageId: kind === "refined" ? "keepRefinements" : "spreadShape",
          data: { method },
        });
      },
    };
  },
});
