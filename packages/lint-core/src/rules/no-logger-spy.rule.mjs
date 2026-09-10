import { defineRule } from "../define-rule.mjs";

// Spying on a real logger patches a method on a shared pino instance for the
// life of the test process; a later test can observe (or fail to observe)
// the spy left behind. `createTestLogger()` gives a throwaway logger a test
// can assert on directly, with no patching.

const LOG_METHOD = /^(?:error|warn|info|debug)$/;

function isGoverned(file) {
  return file.isTest;
}

function isCreateLoggerCall(node) {
  return node?.type === "CallExpression" && node.callee.type === "Identifier" &&
    node.callee.name === "createLogger";
}

function isSpyOnCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "vi" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "spyOn"
  );
}

export const noLoggerSpyRule = defineRule({
  name: "no-logger-spy",
  kind: "problem",
  messages: {
    spyOnLogger: {
      what: "`vi.spyOn` patches a real logger here.",
      fix: "Inject `createTestLogger()` from `@langwatch/test-harness` and assert on `lines.find` instead.",
    },
  },
  create(context, file) {
    if (!isGoverned(file)) return {};

    const loggerVariables = new Set();

    return {
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && isCreateLoggerCall(node.init)) {
          loggerVariables.add(node.id.name);
        }
      },
      CallExpression(node) {
        if (!isSpyOnCall(node)) return;
        const [target, method] = node.arguments;

        if (isCreateLoggerCall(target)) {
          context.report({ node, messageId: "spyOnLogger" });
          return;
        }

        if (target?.type !== "Identifier" || !loggerVariables.has(target.name)) return;
        const methodName = method?.type === "Literal" ? method.value : undefined;
        if (typeof methodName === "string" && LOG_METHOD.test(methodName)) {
          context.report({ node, messageId: "spyOnLogger" });
        }
      },
    };
  },
});
