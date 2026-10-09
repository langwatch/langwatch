import { defineRule } from "../define-rule.mjs";

// Auth headers are the door's input (api-framework-bypass plan, guard 2).

const AUTH_HEADERS = new Set(["authorization", "x-auth-token", "x-api-key", "x-project-id"]);
const GOVERNED_FOLDERS = new Set(["app", "transport"]);

function isGoverned(file) {
  if (!file.isProduction || !file.feature || file.role !== "process") return false;
  if (file.workspacePath.endsWith(".module.ts")) return true;

  return GOVERNED_FOLDERS.has(file.sourcePath?.split("/")[0]);
}

// A header named without a string: a `.withHeaders(...)` key or `headers.authorization`.
function isNamedHeader(node) {
  const parent = node.parent;
  if (parent?.computed) return false;
  if (parent?.type === "MemberExpression")
    return parent.property === node && nameOf(parent.object) === "headers";
  if (parent?.type !== "Property" || parent.key !== node) return false;
  for (let child = parent, up = parent.parent; up; child = up, up = up.parent)
    if (up.type === "CallExpression" && nameOf(up.callee) === "withHeaders")
      return up.arguments.includes(child);

  return false;
}

// `.withPermission(..., { at: "header", header: "x-project-id" })` tells the door which header to read.
function isDeclaredScopeHeader(node) {
  const property = node.parent;
  if (property?.type !== "Property" || property.value !== node) return false;
  if (nameOf(property.key) !== "header") return false;
  const call = property.parent?.parent;

  return call?.type === "CallExpression" && nameOf(call.callee) === "withPermission";
}

function nameOf(node) {
  if (node?.type === "Identifier") return node.name;

  return node?.type === "MemberExpression" ? node.property?.name : undefined;
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
    const check = (node, name) => {
      const header = name.toLowerCase();
      if (!AUTH_HEADERS.has(header)) return;
      context.report({ node, messageId: "authHeader", data: { header, path: file.workspacePath } });
    };

    return {
      Literal(node) {
        if (typeof node.value !== "string" || node.parent?.type === "TSLiteralType") return;
        if (isDeclaredScopeHeader(node)) return;
        check(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0) check(node, node.quasis[0]?.value.cooked ?? "");
      },
      Identifier(node) {
        if (isNamedHeader(node)) check(node, node.name);
      },
    };
  },
});
