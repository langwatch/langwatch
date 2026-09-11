import { defineRule } from "../define-rule.mjs";

// A refusal written as a status and a body never reaches the error boundary,
// so it carries no `code` — and the code is the whole contract: it is what the
// client presentation registry keys the customer's words on, and what a test
// asserts instead of prose. `{ ok: false, status, body }` is the same mistake
// wearing a result type: the caller unwraps it and hand-renders it again.

/** The one place a status and a body legitimately meet: the boundary itself. */
const BOUNDARY = /canonical-error|error-response|handled-error|\.boundary\.ts$/;

// A family that published `{ status, message }` before the house shape existed
// renders its own refusals, and that renderer travels with the declaration so a
// published body cannot change because the installer moved. Inside it, and
// inside the helpers it hands the refusal to, a status and a body ARE the
// boundary. Exempting the whole FILE would exempt the route handlers beside it,
// which is exactly where the mistake lives.
const FAMILY_RENDERER = "RestErrorHandler";

const REFUSING_STATUS = /^[45]\d\d$/;

function isServerTransport(file) {
  return (
    file.isProduction &&
    (file.role === "server" || file.kind === "application") &&
    !BOUNDARY.test(file.sourcePath ?? "")
  );
}

function typeNameOf(annotation) {
  const reference = annotation?.typeAnnotation ?? annotation;
  return reference?.typeName?.name ?? reference?.typeName?.right?.name;
}

function collectCalls(node, into, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const child of node) collectCalls(child, into, seen);
    return;
  }
  if (node.type === "CallExpression" && node.callee?.type === "Identifier") {
    into.add(node.callee.name);
  }
  for (const [key, child] of Object.entries(node)) {
    if (key === "parent") continue;
    if (child && typeof child === "object") collectCalls(child, into, seen);
  }
}

/** The family's own renderer, and the names of the helpers it calls. */
function renderersIn(program) {
  const renderers = new Set();
  const helpers = new Set();

  for (const statement of program?.body ?? []) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;

    for (const declarator of declaration.declarations) {
      if (typeNameOf(declarator.id?.typeAnnotation) !== FAMILY_RENDERER) continue;
      renderers.add(declarator.init);
      collectCalls(declarator.init, helpers);
    }
  }

  return { helpers, renderers };
}

function insideFamilyRenderer(node, renderers, helpers) {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (renderers.has(scope)) return true;
    if (scope.type === "FunctionDeclaration" && helpers.has(scope.id?.name)) return true;
    if (
      scope.type === "VariableDeclarator" &&
      scope.id?.type === "Identifier" &&
      helpers.has(scope.id.name)
    ) {
      return true;
    }
  }

  return false;
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
      fix: "Throw a `HandledError` with a stable code and let the boundary render it, and give that code an entry in `packages/handled-error/src/presentation.ts` so the customer reads words instead of the slug.",
    },
  },
  applies: isServerTransport,
  create(context) {
    const { helpers, renderers } = renderersIn(context.sourceCode.ast);

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression" || callee.computed) return;
        if (callee.property?.name !== "json" || node.arguments.length < 2) return;
        if (insideFamilyRenderer(node, renderers, helpers)) return;

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
