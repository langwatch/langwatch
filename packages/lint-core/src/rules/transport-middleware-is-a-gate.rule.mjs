import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A middleware fact carries credentials, audit, rate limits and body format -
// the things a process resolves once at the boot seam before a handler ever
// runs. A capability (call a peer, report a result, build something) is
// behaviour, and behaviour belongs on the app as a method, not smuggled in as
// a resolved-per-request fact.

const GOVERNED_TRANSPORT = /^modules\/[^/]+\/server\/src\/transport\/[^/]+\.(?:rest|trpc)\.ts$/;
const RESERVED_NAME = /effect|capabilit|client|builder|report/i;

function isGoverned(workspacePath) {
  return GOVERNED_TRANSPORT.test(workspacePath);
}

function isDefineRestMiddlewareCall(node) {
  return node.type === "CallExpression" && node.callee.type === "Identifier" &&
    node.callee.name === "defineRestMiddleware";
}

function schemaObject(node) {
  const schemaArgument = node.arguments[1];
  if (schemaArgument?.type !== "CallExpression") return undefined;
  const callee = schemaArgument.callee;
  const isZodObject =
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "z" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "object";
  if (!isZodObject) return undefined;
  const shape = schemaArgument.arguments[0];
  return shape?.type === "ObjectExpression" ? shape : undefined;
}

function isFunctionTypedCustom(value) {
  if (value.type !== "CallExpression") return false;
  const callee = value.callee;
  const isZodCustom =
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "z" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "custom";
  if (!isZodCustom) return false;
  const typeArgument = value.typeArguments?.params?.[0] ?? value.typeParameters?.params?.[0];
  return typeArgument?.type === "TSFunctionType";
}

export const transportMiddlewareIsAGateRule = defineRule({
  name: "transport-middleware-is-a-gate",
  kind: "problem",
  messages: {
    reservedName: {
      what: "Middleware fact `{{name}}` is named like a capability, not a gate.",
      fix: "Make this a method on the module's app; a middleware fact carries only credentials, audit, rate limits or body format.",
    },
    functionMember: {
      what: "Middleware fact field `{{field}}` is function-typed.",
      fix: "Drop this field and call the method on the module's app instead; a middleware fact never carries a function.",
    },
  },
  create(context, file) {
    if (!isGoverned(file.workspacePath)) return {};
    if (
      isBaselined({
        cwd: context.cwd,
        file: file.workspacePath,
        rule: "transport-middleware-is-a-gate",
      })
    ) {
      return {};
    }

    return {
      CallExpression(node) {
        if (!isDefineRestMiddlewareCall(node)) return;

        const nameArgument = node.arguments[0];
        const name =
          nameArgument?.type === "Literal" && typeof nameArgument.value === "string"
            ? nameArgument.value
            : undefined;
        if (name && RESERVED_NAME.test(name)) {
          context.report({ node, messageId: "reservedName", data: { name } });
        }

        const shape = schemaObject(node);
        if (!shape) return;
        for (const property of shape.properties) {
          if (property.type !== "Property") continue;
          if (!isFunctionTypedCustom(property.value)) continue;
          const field = property.key.type === "Identifier" ? property.key.name : "(computed)";
          context.report({ node: property, messageId: "functionMember", data: { field } });
        }
      },
    };
  },
});
