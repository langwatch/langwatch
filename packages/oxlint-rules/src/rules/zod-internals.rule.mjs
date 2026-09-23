import { defineRule } from "../define-rule.mjs";

// Two shipped bugs, documented in dev/docs/best_practices/zod.md: `.innerType()`
// differs across the two installed Zod majors, and zod-3 `ZodError` fails
// `instanceof` against zod-4's class. `_def` fires on any object - a
// naming-convention gate would miss non-`*Schema`-named variables. One
// exclusion: the tRPC host file, whose only accessor for a procedure kind is `._def`.

const WHITESPACE = /\s+/g;
const TEXT_BUDGET = 40;

const GOVERNED_SOURCE = /^(?:enterprise\/modules|modules|apps|packages)\//;
const TRPC_HOST_FILE = "apps/api/src/app-trpc/api-trpc.host.ts";

function isGoverned(file) {
  return file.isProduction && GOVERNED_SOURCE.test(file.workspacePath);
}

/** The offending expression as the reader sees it written, truncated for the message. */
function textOf(source, node) {
  if (!node) return "this value";
  const text = source.slice(node.range[0], node.range[1]).replace(WHITESPACE, " ").trim();
  if (text.length === 0) return "this value";

  return text.length > TEXT_BUDGET ? `${text.slice(0, TEXT_BUDGET)}…` : text;
}

function isZodErrorReference(node) {
  if (node.type === "Identifier") return node.name === "ZodError";
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return (
      node.object.type === "Identifier" &&
      node.object.name === "z" &&
      node.property.name === "ZodError"
    );
  }

  return false;
}

export const zodInternalsRule = defineRule({
  name: "zod-internals",
  kind: "problem",
  applies: isGoverned,
  messages: {
    defAccess: {
      what: "`{{object}}._def` reads a Zod schema's internals, which differ between the two installed Zod majors.",
      fix: "Export the un-refined schema object from the contract and build from it instead of unwrapping this one.",
    },
    zodErrorInstanceOf: {
      what: "`instanceof {{right}}` tests an error against one Zod major's class, and the other major's errors fail it.",
      fix: "Test the error structurally instead: check `Array.isArray(error.issues)`.",
    },
  },
  create(context, file) {
    const source = context.sourceCode.text;
    // The tRPC router's own type declares no accessor for "what kind of
    // procedure lives at this path" — `._def` is the entire public surface
    // for that lookup, not a shortcut around one.
    const isTrpcHost = file.workspacePath === TRPC_HOST_FILE;

    return {
      MemberExpression(node) {
        if (node.computed) return;
        if (node.property.type !== "Identifier" || node.property.name !== "_def") return;
        if (isTrpcHost) return;

        context.report({
          node,
          messageId: "defAccess",
          data: { object: textOf(source, node.object) },
        });
      },
      BinaryExpression(node) {
        if (node.operator !== "instanceof") return;
        if (!isZodErrorReference(node.right)) return;

        context.report({
          node,
          messageId: "zodErrorInstanceOf",
          data: { right: textOf(source, node.right) },
        });
      },
    };
  },
});
