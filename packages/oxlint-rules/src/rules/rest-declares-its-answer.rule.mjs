import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import { memberName } from "./zod-schema-origin.mjs";
import { operationNameOf, routeChainOf } from "./rest-route.mjs";

// packages/api's declared-response-kind seam (`.withResponse`): a route
// declares the kind it answers with and the handler is handed the one
// producer for that kind - it can produce nothing else. This rule catches a
// handler that still builds its own answer instead of using the seam. Not
// yet enabled in oxlint.architecture.jsonc: the tree carries roughly 124
// pre-existing findings the migration sweep has not cleared, and the current
// lint-rule policy carries no baseline tier to defer them to.

const CONTEXT_NAMES = new Set(["c", "ctx", "context"]);
const HANDLER_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
const BANNED_ENVELOPE_IMPORTS = new Set(["jsonResponse", "rateLimitedResponse"]);

function isRestOrTransportSource(file) {
  if (!file.isProduction || file.role !== "process") return false;

  const path = file.sourcePath ?? "";

  return path.endsWith('.rest.ts') || /(?:^|\/)transport\/.*\.api\.ts$/.test(path);
}

function isContextJsonCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    CONTEXT_NAMES.has(node.callee.object.name) &&
    memberName(node.callee) === "json"
  );
}

function isRawAnswerObjectReturn(node) {
  if (node.type !== "ReturnStatement" || node.argument?.type !== "ObjectExpression") return false;

  const keys = new Set(
    node.argument.properties
      .filter((property) => property.type === "Property" && property.key.type === "Identifier")
      .map((property) => property.key.name),
  );

  return keys.has("status") && keys.has("headers") && keys.has("body");
}

export const restDeclaresItsAnswerRule = defineRule({
  name: "rest-declares-its-answer",
  kind: "problem",
  applies: isRestOrTransportSource,
  messages: {
    manualResponse: {
      what: "REST `{{operation}}` builds a Response by hand.",
      fix: 'Declare the kind it answers with - `.withResponse("bytes" | "sse" | "redirect" | "protocol" | "forwarded")` - and produce it through the `response` argument.',
    },
    undeclaredAnswer: {
      what: "REST `{{operation}}` writes its own answer without declaring one.",
      fix: "A JSON route returns a plain value; anything else declares its kind.",
    },
    rawResponseHatch: {
      what: "`.withRawResponse` is the old hatch.",
      fix: 'Declare the kind: `produces: "application/json"` means this route returns a plain value instead.',
    },
    canonicalEnvelope: {
      what: "`{{name}}` is imported from `@langwatch/api/rest`.",
      fix: "The canonical envelope is the framework's; throw a HandledError.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@langwatch/api/rest") return;

        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;

          const imported = specifier.imported?.name ?? specifier.imported?.value;
          if (!BANNED_ENVELOPE_IMPORTS.has(imported)) continue;

          context.report({ node: specifier, messageId: "canonicalEnvelope", data: { name: imported } });
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || memberName(node.callee) !== "handle") return;

        const chain = routeChainOf(node);
        if (!chain) return;

        const operation = operationNameOf(chain.opener);
        const rawResponseCall = chain.calls.find((call) => call.name === "withRawResponse");
        const hasResponse = chain.calls.some((call) => call.name === "withResponse");

        if (rawResponseCall) {
          context.report({ node: rawResponseCall.node, messageId: "rawResponseHatch", data: { operation } });
        }

        const handler = node.arguments[0];
        if (!handler || !HANDLER_TYPES.has(handler.type)) return;

        walk(handler.body, (child) => {
          if (child.type === "NewExpression" && child.callee.type === "Identifier" && child.callee.name === "Response") {
            context.report({ node: child, messageId: "manualResponse", data: { operation } });
            return;
          }

          if (hasResponse || rawResponseCall) return;

          if (isContextJsonCall(child) || isRawAnswerObjectReturn(child)) {
            context.report({ node: child, messageId: "undeclaredAnswer", data: { operation } });
          }
        });
      },
    };
  },
});
