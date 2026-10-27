import { defineRule } from "../define-rule.mjs";

// In module code a scope travels as a named parameter, never ambient
// (ARCHITECTURE.md section 3.2). The framework's trace context lives in
// packages/observability, outside this rule's scope.

const MODULE_SOURCE = /^(?:enterprise\/)?modules\/[^/]+\/(?:process|browser)\/src\//;
const ASYNC_HOOKS = /^(?:node:)?async_hooks$/;

// Named exceptions: the file shape that may, and the reason (Alex, 2026-10-06).
// Better Auth's logger and callbacks are a third-party seam a parameter cannot reach.
const NAMED_EXCEPTIONS = [
  {
    path: /^modules\/auth\/process\/src\/channels\/http\/http\.[^/]+\.channel\.ts$/,
    reason: "adapts Better Auth, a third-party seam the framework cannot reach",
  },
];

function isGoverned(file) {
  return (
    !file.isTest &&
    MODULE_SOURCE.test(file.workspacePath) &&
    !NAMED_EXCEPTIONS.some((exception) => exception.path.test(file.workspacePath))
  );
}

const isAsyncLocalStorage = (node) =>
  node?.type === "Identifier" && node.name === "AsyncLocalStorage";

export const noAmbientContextRule = defineRule({
  name: "no-ambient-context",
  kind: "problem",
  messages: {
    ambientContext: {
      what: "`AsyncLocalStorage` carries a scope ambiently here.",
      why: "An ambient scope hides what a function depends on, so a caller cannot see or test what it must supply.",
      fix: "Pass the scope as a named parameter from the caller down to where it is read. Read the `architecture-guide` skill.",
    },
  },
  create(context, file) {
    if (!isGoverned(file)) return {};

    return {
      ImportSpecifier(node) {
        const from = node.parent?.source?.value;
        if (typeof from !== "string" || !ASYNC_HOOKS.test(from)) return;
        if (isAsyncLocalStorage(node.imported))
          context.report({ node, messageId: "ambientContext" });
      },
      MemberExpression(node) {
        if (!node.computed && isAsyncLocalStorage(node.property)) {
          context.report({ node: node.property, messageId: "ambientContext" });
        }
      },
    };
  },
});
