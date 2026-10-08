import { defineRule } from "../define-rule.mjs";

// Every door left open states why (api-framework-bypass plan, guard 4). The rule
// checks a reason is there, never its wording (W-02 G4, Alex 2026-10-08).

const ESCAPE_KINDS = new Set([
  "publicRoute",
  "anyAuthenticated",
  "deferredScope",
  "optionalCredential",
  "noPermission",
  "serviceAuthorized",
]);
const ADMIT = /^admit[A-Z]/;

function calleeName(callee) {
  if (callee?.type === "Identifier") return callee.name;
  if (callee?.type === "MemberExpression") return callee.property?.name;

  return undefined;
}

function isHandleCallback(node) {
  const call = node?.parent;
  return call?.type === "CallExpression" && calleeName(call.callee) === "handle";
}

function isBlankText(value) {
  if (value?.type === "Literal") return typeof value.value === "string" && !value.value.trim();
  if (value?.type === "TemplateLiteral" && value.expressions.length === 0)
    return !value.quasis.some((quasi) => quasi.value.cooked?.trim());
  return false;
}

// A named declaration or a spread is typed `{ reason: string }`; only a literal is judged here.
function lacksReason(call) {
  const [declaration] = call.arguments;
  if (declaration === undefined) return true;
  if (declaration.type !== "ObjectExpression") return false;
  if (declaration.properties.some((property) => property.type === "SpreadElement")) return false;
  const reason = declaration.properties.find((property) => property.key?.name === "reason");
  return reason === undefined || isBlankText(reason.value);
}

// An admitX whose value the handler answers with is the operation, not a check beside it.
function isTheAnswer(call) {
  const parent = call.parent?.type === "AwaitExpression" ? call.parent.parent : call.parent;
  return parent?.type === "ReturnStatement" || isHandleCallback(parent);
}

export const accessEscapeKindRule = defineRule({
  name: "access-escape-kind",
  kind: "problem",
  applies: (file) => file.isProduction && Boolean(file.feature) && file.role === "process",
  escape: { framework: "the `@langwatch/api` door (`.withPermission`, `.withAccess`)" },
  messages: {
    escapeKind: {
      what: "`{{name}}` opens the door of a route in `{{path}}` without a reason.",
      why: "An open door is a security decision, so each one states the reason a reviewer can check.",
      fix: 'Pass `{ reason: "<why this route asks no permission>" }` to `{{name}}`, or declare `.withPermission(...)`. Read the `api-transports` skill.',
    },
    admitInHandler: {
      what: "The handler in `{{path}}` calls `{{name}}` beside the operation it guards.",
      why: "Authorization asked inside a handler is a bypass of the door that should have refused first.",
      fix: "Name the permission with `.withPermission(...)` on the route and delete the `{{name}}` call. Read the `api-transports` skill.",
    },
  },
  create(context, file) {
    const path = file.workspacePath;
    let handlers = 0;
    const enter = (node) => {
      if (isHandleCallback(node)) handlers += 1;
    };
    const leave = (node) => {
      if (isHandleCallback(node)) handlers -= 1;
    };

    return {
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": leave,
      FunctionExpression: enter,
      "FunctionExpression:exit": leave,
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (ESCAPE_KINDS.has(name)) {
          if (lacksReason(node))
            context.report({ node, messageId: "escapeKind", data: { name, path } });
        } else if (handlers > 0 && ADMIT.test(name ?? "") && !isTheAnswer(node)) {
          context.report({ node, messageId: "admitInHandler", data: { name, path } });
        }
      },
    };
  },
});
