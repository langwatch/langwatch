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
      what: "`.{{method}}()` builds this schema's type through Zod's mapped `Extend` generic.",
      why: "Only the shape spread produces a fresh object type; `.safeExtend()` preserves behaviour but instantiates the same generic.",
      fix:
        "Choose by what the base schema carries. When it is a plain `z.object()` with no" +
        " `.strict()` or `z.strictObject()`, no `.catchall()` and no `.refine()` or" +
        " `.superRefine()`, write `z.object({ ...base.shape, ...fields })` — spreading" +
        " `...other.shape` for `.merge(other)` — since that is the only form that" +
        " avoids the generic. Otherwise write `.safeExtend({ ...fields })`, which keeps" +
        " the strictness, catchall and refinements that the shape spread drops" +
        " silently.",
    },
    keepRefinements: {
      what: "`.{{method}}()` is called on a Zod object that carries refinements.",
      why: "Spreading its shape alone would discard those checks.",
      fix: "Write `.safeExtend({ ...fields })` here — a `z.object({ ...base.shape })` spread would drop those refinements without a type error.",
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
