import { defineRule } from "../define-rule.mjs";

// Auth headers are the door's input (api-framework-bypass plan, guard 2).

const AUTH_HEADERS = new Set(["authorization", "x-auth-token", "x-api-key", "x-project-id"]);
const GOVERNED_FOLDERS = new Set(["app", "transport"]);

function isGoverned(file) {
  if (!file.isProduction || !file.feature || file.role !== "process") return false;
  if (file.workspacePath.endsWith(".module.ts")) return true;

  return GOVERNED_FOLDERS.has(file.sourcePath?.split("/")[0]);
}

export const authHeaderReadRule = defineRule({
  name: "auth-header-read",
  kind: "problem",
  applies: isGoverned,
  escape: { framework: "the `@langwatch/api` door (`.withPermission`, `.withAccess`)" },
  messages: {
    authHeader: {
      what: "`{{path}}` names the auth header `{{header}}`.",
      why: "The door reads auth headers and resolves the caller; a transport, app or module reading one bypasses it.",
      fix: "Delete the header read and take `actor` and `scope` from the handler the door already resolved. Read the `api-transports` skill.",
    },
  },
  create(context, file) {
    return {
      Literal(node) {
        if (typeof node.value !== "string" || node.parent?.type === "TSLiteralType") return;
        const header = node.value.toLowerCase();
        if (!AUTH_HEADERS.has(header)) return;
        context.report({
          node,
          messageId: "authHeader",
          data: { header, path: file.workspacePath },
        });
      },
    };
  },
});
