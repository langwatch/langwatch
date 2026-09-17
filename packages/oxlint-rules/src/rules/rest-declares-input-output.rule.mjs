import { defineRule } from "../define-rule.mjs";
import { memberName } from "./zod-schema-origin.mjs";
import { BODY_BEARING_OPENERS, isEscapedRoute, operationNameOf, routeChainOf } from "./rest-route.mjs";

// ARCHITECTURE-LAW.md, "Transport law": a REST route declares `withInput` and
// `withOutput` so the framework parses, validates and serialises; the two
// escapes are `publicRoute` and a `withRawResponse` answer, verified against
// `RouteBuilder` in `packages/api/src/rest/declaration.ts`.

const OUTPUT_CALLS = new Set(["withOutput", "responds"]);
const INPUT_CALLS = new Set(["withInput", "withRawBody", "withMultipart"]);

function isRestTransportSource(file) {
  return file.isProduction && file.role === "server" && /\.rest\.ts$/.test(file.sourcePath ?? "");
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
    missingInput: {
      what: "REST route `{{operation}}` parses a body without declaring `withInput`.",
      fix: "Add `.withInput(<schema>)` from the module's own contract before `.handle()`.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || memberName(node.callee) !== "handle") return;

        const chain = routeChainOf(node);
        if (!chain || isEscapedRoute(chain.calls)) return;

        const operation = operationNameOf(chain.opener);
        const declared = new Set(chain.calls.map((call) => call.name));

        if (![...OUTPUT_CALLS].some((name) => declared.has(name))) {
          context.report({ node: chain.opener, messageId: "missingOutput", data: { operation } });
        }

        if (BODY_BEARING_OPENERS.has(chain.opens) && ![...INPUT_CALLS].some((name) => declared.has(name))) {
          context.report({ node: chain.opener, messageId: "missingInput", data: { operation } });
        }
      },
    };
  },
});
