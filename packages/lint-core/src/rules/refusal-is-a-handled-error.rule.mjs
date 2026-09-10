import { defineRule } from "../define-rule.mjs";

// A refusal written as a status and a body never reaches the error boundary,
// so it carries no `code` — and the code is the whole contract: it is what the
// client presentation registry keys the customer's words on, and what a test
// asserts instead of prose. `{ ok: false, status, body }` is the same mistake
// wearing a result type: the caller unwraps it and hand-renders it again.

/** The one place a status and a body legitimately meet: the boundary itself. */
const BOUNDARY = /canonical-error|error-response|handled-error|\.boundary\.ts$/;

const REFUSING_STATUS = /^[45]\d\d$/;

function isServerTransport(file) {
  return (
    file.isProduction &&
    (file.role === "server" || file.kind === "application") &&
    !BOUNDARY.test(file.sourcePath ?? "")
  );
}

function keysOf(node) {
  if (node?.type !== "ObjectExpression") return [];

  return node.properties
    .filter((property) => property.type === "Property" && !property.computed)
    .map((property) =>
      property.key.type === "Identifier" ? property.key.name : String(property.key.value),
    );
}

function isRefusingStatus(node) {
  return node?.type === "Literal" && REFUSING_STATUS.test(String(node.value));
}

export const refusalIsAHandledErrorRule = defineRule({
  name: "refusal-is-a-handled-error",
  kind: "problem",
  messages: {
    handWrittenRefusal: {
      what: "A refusal is written as a status and a body ({{shape}}).",
      why: "Nothing hand-rendered reaches the error boundary, so the answer carries no code: the client presentation registry has nothing to key the customer's words on, and a test can only assert prose that will change.",
      fix: "Throw a `HandledError` with a stable code and let the boundary render it",
    },
  },
  applies: isServerTransport,
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression" || callee.computed) return;
        if (callee.property?.name !== "json" || node.arguments.length < 2) return;

        const keys = keysOf(node.arguments[0]);
        const second = node.arguments[1];
        const status =
          second?.type === "ObjectExpression"
            ? second.properties.find(
                (property) => property.type === "Property" && property.key?.name === "status",
              )?.value
            : second;

        if (isRefusingStatus(status) && keys.some((key) => key === "error" || key === "message")) {
          context.report({ node, messageId: "handWrittenRefusal", data: { shape: "c.json" } });
        }
      },
      ObjectExpression(node) {
        const keys = keysOf(node);
        if (!keys.includes("status") || !keys.includes("body")) return;

        const ok = node.properties.find(
          (property) => property.type === "Property" && property.key?.name === "ok",
        );
        if (ok && ok.value?.type === "Literal" && ok.value.value === false) {
          context.report({ node, messageId: "handWrittenRefusal", data: { shape: "ok: false" } });
        }
      },
    };
  },
});
