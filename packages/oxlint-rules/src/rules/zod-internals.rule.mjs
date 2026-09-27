import { defineRule } from "../define-rule.mjs";

// Two shipped bugs, documented in dev/docs/best_practices/zod.md: `.innerType()`
// differs across the two installed Zod majors, and zod-3 `ZodError` fails
// `instanceof` against zod-4's class. `_def` is reported only off a receiver that
// is recognisably Zod (a z. chain, a schema name, a Zod annotation, or an alias of one).

const WHITESPACE = /\s+/g;
const TEXT_BUDGET = 40;

const GOVERNED_SOURCE = /^(?:enterprise\/modules|modules|apps|packages)\//;
const SCHEMA_NAME = /schema/i;
const ZOD_ANNOTATION = /\bZod[A-Z]\w*|\bz\.\w+/;
const ZOD_MODULE = /^zod(?:\/|$)/;
const ALIAS_DEPTH = 4;

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

function variableDefinition(context, identifier) {
  let scope = context.sourceCode.getScope(identifier);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;

  return scope?.set.get(identifier.name)?.defs[0];
}

function annotationIsZod(source, holder) {
  const annotation = holder?.typeAnnotation;
  return annotation
    ? ZOD_ANNOTATION.test(source.slice(annotation.range[0], annotation.range[1]))
    : false;
}

/** Whether a local names a Zod schema: by its name, its annotation, its import or what it aliases. */
function isZodBinding({ context, source, identifier, depth }) {
  if (identifier.name === "z" || SCHEMA_NAME.test(identifier.name)) return true;
  const definition = variableDefinition(context, identifier);
  if (!definition) return false;
  if (definition.type === "ImportBinding") {
    return ZOD_MODULE.test(String(definition.parent?.source?.value ?? ""));
  }
  if (annotationIsZod(source, definition.name)) return true;
  if (definition.type !== "Variable" || !definition.node.init) return false;

  return isZodReceiver({ context, source, node: definition.node.init, depth: depth + 1 });
}

/** Whether an expression is recognisably a Zod schema, as far as this file can tell. */
function isZodReceiver({ context, source, node, depth = 0 }) {
  if (!node || depth > ALIAS_DEPTH) return false;
  switch (node.type) {
    case "Identifier":
      return isZodBinding({ context, source, identifier: node, depth });
    case "CallExpression":
      return isZodReceiver({ context, source, node: node.callee, depth });
    case "MemberExpression":
      return isZodReceiver({ context, source, node: node.object, depth });
    case "ChainExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return isZodReceiver({ context, source, node: node.expression, depth });
    default:
      return false;
  }
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
  create(context) {
    const source = context.sourceCode.text;

    return {
      MemberExpression(node) {
        if (node.computed) return;
        if (node.property.type !== "Identifier" || node.property.name !== "_def") return;
        if (!isZodReceiver({ context, source, node: node.object })) return;

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
