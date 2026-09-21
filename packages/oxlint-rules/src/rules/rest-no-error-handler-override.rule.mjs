import { defineRule } from "../define-rule.mjs";

// ARCHITECTURE-LAW.md, "Transport law": `RestErrorHandler` (`packages/api/src/
// rest/credential.ts`) is the per-namespace `onError` override, and it is
// banned outright - no exemption, unlike the escapes the other two REST
// handler rules carry. A handler always throws; the mount's own middleware
// serialises every response.

const BANNED = "RestErrorHandler";

function isServerSource(file) {
  return file.isProduction && file.role === "process";
}

export const restNoErrorHandlerOverrideRule = defineRule({
  name: "rest-no-error-handler-override",
  kind: "problem",
  applies: isServerSource,
  messages: {
    override: {
      what: "`{{path}}` imports `RestErrorHandler`, the per-namespace error override.",
      fix: "Delete it. Throw a HandledError (or a plain Error) from the handler instead; the mount's own middleware serialises every response.",
    },
  },
  create(context, file) {
    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const imported = specifier.imported?.name ?? specifier.imported?.value;
          if (imported !== BANNED) continue;

          context.report({ node: specifier, messageId: "override", data: { path: file.workspacePath } });
        }
      },
    };
  },
});
