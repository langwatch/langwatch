import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import { isEscapedRoute, operationNameOf, routeChainOf } from "./rest-route.mjs";
import { memberName } from "./zod-schema-origin.mjs";

// ARCHITECTURE-LAW.md, "Transport law": a REST route declares `withOutput` so
// the framework serialises its answer; the two escapes are `publicRoute` and
// a `withRawResponse` answer, verified against `RouteBuilder` in
// `packages/api/src/rest/declaration.ts`. Omitting output is itself
// sanctioned there for a handler that answers with nothing.

const OUTPUT_CALLS = new Set(["withOutput", "responds"]);
const FUNCTION_BOUNDARY = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function isRestTransportSource(file) {
  return (
    file.isProduction && file.role === "process" && (file.sourcePath ?? "").endsWith(".rest.ts")
  );
}

function isVoidExpression(node) {
  if (!node) return true;
  return (
    (node.type === "Identifier" && node.name === "undefined") ||
    (node.type === "UnaryExpression" && node.operator === "void")
  );
}

// `handle()`'s own generic constrains a return to `void` when no output is
// declared (declaration.ts:1097, `TResult extends RouteResult<Output>`), so
// only a handler that visibly returns a value is actually missing its
// `withOutput` - one that answers with nothing is the sanctioned idiom.
function handlerReturnsValue(handler) {
  if (handler?.type !== "ArrowFunctionExpression" && handler?.type !== "FunctionExpression")
    return true;
  if (handler.expression) return !isVoidExpression(handler.body);

  let found = false;
  walk(handler.body, (node) => {
    if (found) return false;
    if (FUNCTION_BOUNDARY.has(node.type)) return false;
    if (node.type === "ReturnStatement" && !isVoidExpression(node.argument)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

export const restDeclaresInputOutputRule = defineRule({
  name: "rest-declares-input-output",
  kind: "problem",
  applies: isRestTransportSource,
  messages: {
    missingOutput: {
      what: "REST route `{{operation}}` declares no answer.",
      fix: "Add `.withOutput(<schema>)`, or `.responds({...})` for several statuses, from the module's own contract before `.handle()`.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || memberName(node.callee) !== "handle") return;

        const chain = routeChainOf(node);
        if (!chain || isEscapedRoute(chain.calls)) return;

        const declared = new Set(chain.calls.map((call) => call.name));
        const hasOutput = [...OUTPUT_CALLS].some((name) => declared.has(name));
        if (hasOutput) return;
        if (!handlerReturnsValue(node.arguments[0])) return;

        const operation = operationNameOf(chain.opener);
        context.report({ node: chain.opener, messageId: "missingOutput", data: { operation } });
      },
    };
  },
});
