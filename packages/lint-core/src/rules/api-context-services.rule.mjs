import { defineRule } from "../define-rule.mjs";

/**
 * A door in a strict feature package: `src/transport/<surface>/<name>.api.ts`.
 * `src/api/<surface>/` is the name that directory used to have, and four packages still publish
 * a family from it, so both are matched.
 */
function isFeatureApi(file) {
  return (
    file.role === "server" &&
    /^src\/(?:transport|api)\/[^/]+\/.+\.api\.ts$/.test(file.relative ?? "")
  );
}

function identifierName(node) {
  return node?.type === "Identifier" ? node.name : undefined;
}

function isContextIdentifier(node) {
  return ["c", "ctx", "context"].includes(identifierName(node));
}

function isOptionsMethodCall(node) {
  if (node.callee.type !== "MemberExpression") return false;
  const owner = node.callee.object;
  return (
    owner.type === "MemberExpression" &&
    owner.object.type === "ThisExpression" &&
    !owner.computed &&
    identifierName(owner.property) === "options"
  );
}

export const apiContextServicesRule = defineRule({
  name: "api-context-services",
  kind: "problem",
  applies: isFeatureApi,
  messages: {
    contextCast: {
      what: "API context is already typed; do not cast it to recover application services.",
      fix: "Remove the cast and use `context` directly.",
    },
    construction: {
      what: "`new {{name}}` inside an API class.",
      fix: "Take it from `context.app` and let the composition root construct it.",
    },
    doubleAwait: {
      what: "Await one service call; do not await a resolver and then await the service operation.",
      fix: "Collapse to a single `await`.",
    },
    resolver: {
      what: "API options are static configuration, not per-request callbacks.",
      fix: "Use context.app, context.actor(), context.authorize(), and validated input.",
    },
  },
  create(context) {
    return {
      AwaitExpression(node) {
        const nestedAwait =
          node.argument.type === "AwaitExpression" ||
          (node.argument.type === "CallExpression" &&
            node.argument.callee.type === "MemberExpression" &&
            node.argument.callee.object.type === "AwaitExpression");
        if (nestedAwait) {
          context.report({ node, messageId: "doubleAwait" });
        }
      },
      CallExpression(node) {
        if (isOptionsMethodCall(node)) {
          context.report({ node, messageId: "resolver" });
        }
      },
      NewExpression(node) {
        const name = identifierName(node.callee);
        if (name && /(Service|Repository|Store|Adapter)$/.test(name)) {
          context.report({ node, messageId: "construction", data: { name } });
        }
      },
      TSAsExpression(node) {
        if (isContextIdentifier(node.expression)) {
          context.report({ node, messageId: "contextCast" });
        }
      },
    };
  },
});
