import { defineRule } from "../define-rule.mjs";

// A refusal written as a result carries no `code`, and the code is the whole contract: the client
// presentation registry keys the customer's words on it. A REST handler's hand-built answer is
// `rest-route`'s `manualAnswer`; this rule keeps the `{ ok: false, status, body }` result shape.

/** The one place a status and a body legitimately meet: the boundary itself. */
const BOUNDARY = /canonical-error|error-response|handled-error|\.boundary\.ts$/;

function isServerTransport(file) {
  return (
    file.isProduction &&
    (file.role === "process" || file.kind === "application") &&
    !BOUNDARY.test(file.sourcePath ?? "")
  );
}

function keysOf(node) {
  return node.properties
    .filter((property) => property.type === "Property" && !property.computed)
    .map((property) =>
      property.key.type === "Identifier" ? property.key.name : String(property.key.value),
    );
}

function isFalseOk(node) {
  const ok = node.properties.find(
    (property) => property.type === "Property" && property.key?.name === "ok",
  );

  return ok?.value?.type === "Literal" && ok.value.value === false;
}

export const refusalIsAHandledErrorRule = defineRule({
  name: "refusal-is-a-handled-error",
  kind: "problem",
  messages: {
    handWrittenRefusal: {
      what: "A refusal is written as a status and a body ({{shape}}).",
      why: "Nothing hand-rendered reaches the error boundary, so the answer carries no code: the client presentation registry has nothing to key the customer's words on, and a test can only assert prose that will change.",
      fix: 'Throw a `HandledError` with a stable `code` — set `fault: "platform"` or `"provider"` explicitly if the status is 5xx — and let the boundary render it; register the code in `packages/handled-error/src/app-codes.ts` (sorted) and give it a customer-safe entry in `packages/handled-error/src/presentation.ts`.',
    },
  },
  applies: isServerTransport,
  create(context) {
    return {
      ObjectExpression(node) {
        const keys = keysOf(node);
        if (!keys.includes("status") || !keys.includes("body")) return;
        if (isFalseOk(node)) {
          context.report({ node, messageId: "handWrittenRefusal", data: { shape: "ok: false" } });
        }
      },
    };
  },
});
