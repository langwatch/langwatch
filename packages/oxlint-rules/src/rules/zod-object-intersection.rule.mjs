import { defineRule } from "../define-rule.mjs";
import { createZodSchemaResolver, memberName } from "./zod-schema-origin.mjs";

const GENERATED = /(?:^|\/)(?:generated|dist|node_modules)\/|(?:\.generated|\.d)\.[cm]?[jt]sx?$/;

function isSchemaSource(file) {
  return file.isProduction && !GENERATED.test(file.workspacePath);
}

function operands(node, origin) {
  const method = memberName(node.callee);
  if (method === "and" && node.arguments.length === 1) {
    return [node.callee.object, node.arguments[0]];
  }

  const intersection =
    method === "intersection" &&
    node.arguments.length === 2 &&
    origin(node.callee.object) === "zod";
  return intersection ? node.arguments : void 0;
}

export const zodObjectIntersectionRule = defineRule({
  name: "zod-object-intersection",
  kind: "problem",
  applies: isSchemaSource,
  messages: {
    spreadShapes: {
      what: "`{{call}}` intersects two Zod objects, which parses the input twice and merges the results.",
      why: "One object parses once through its compiled fast path and types as a fresh object rather than an intersection.",
      fix:
        "Write `z.object({ ...left.shape, ...right.shape })`; when either side is" +
        " `.strict()`, `z.strictObject()` or has a `.catchall()`, write" +
        " `left.safeExtend(right.shape)` so that behaviour survives.",
    },
    keepRefinements: {
      what: "`{{call}}` intersects a refined Zod object with a plain one.",
      fix: "Write `left.safeExtend(right.shape)`, which keeps the left side's refinements and parses once.",
    },
  },
  create(context, file) {
    let origin;
    return {
      CallExpression(node) {
        const method = memberName(node.callee);
        if (method !== "and" && method !== "intersection") return;
        origin ??= createZodSchemaResolver(context, file.filename);
        const sides = operands(node, origin);
        if (!sides) return;
        const [left, right] = sides.map((side) => origin(side));
        if (right !== "object") return;
        if (left !== "object" && left !== "refined") return;
        context.report({
          node,
          messageId: left === "refined" ? "keepRefinements" : "spreadShapes",
          data: { call: method === "and" ? ".and()" : "z.intersection()" },
        });
      },
    };
  },
});
