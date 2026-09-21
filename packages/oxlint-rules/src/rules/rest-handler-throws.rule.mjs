import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import { memberName } from "./zod-schema-origin.mjs";
import { isEscapedRoute, operationNameOf, routeChainOf } from "./rest-route.mjs";

// ARCHITECTURE-LAW.md, "Transport law": a REST handler returns its declared
// output or throws; it never builds its own answer. `publicRoute` and a
// `withRawResponse` answer are the same two escapes `rest-declares-input-output`
// exempts - a raw answer's own `RestRawResult` type is a real `Response`.

const CONTEXT_NAMES = new Set(["c", "ctx", "context"]);
const HANDLER_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

function isRestTransportSource(file) {
  return file.isProduction && file.role === "process" && /\.rest\.ts$/.test(file.sourcePath ?? "");
}

/** The banned symbol a call or `new` expression spells, or undefined for anything else. */
function manualAnswerSymbol(node) {
  if (node.type === "CallExpression") {
    if (node.callee.type === "Identifier" && node.callee.name === "jsonAnswer") return "jsonAnswer(...)";
    if (
      node.callee.type === "MemberExpression" &&
      node.callee.object.type === "Identifier" &&
      CONTEXT_NAMES.has(node.callee.object.name) &&
      memberName(node.callee) === "json"
    ) {
      return `${node.callee.object.name}.json(...)`;
    }
    return void 0;
  }

  if (node.type === "NewExpression" && node.callee.type === "Identifier") {
    if (node.callee.name === "Response") return "new Response(...)";
    if (node.callee.name === "HTTPException") return "new HTTPException(...)";
  }

  return void 0;
}

export const restHandlerThrowsRule = defineRule({
  name: "rest-handler-throws",
  kind: "problem",
  applies: isRestTransportSource,
  messages: {
    manualAnswer: {
      what: "The handler for `{{operation}}` builds its own answer with `{{symbol}}`.",
      fix: "Return the plain result the declared output describes and throw a HandledError (or Error) for the failure - the mount's own middleware serialises both.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || memberName(node.callee) !== "handle") return;

        const chain = routeChainOf(node);
        if (!chain || isEscapedRoute(chain.calls)) return;

        const handler = node.arguments[0];
        if (!handler || !HANDLER_TYPES.has(handler.type)) return;

        const operation = operationNameOf(chain.opener);

        walk(handler.body, (child) => {
          const symbol = manualAnswerSymbol(child);
          if (symbol) context.report({ node: child, messageId: "manualAnswer", data: { operation, symbol } });
        });
      },
    };
  },
});
