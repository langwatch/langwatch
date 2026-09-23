import { defineRule } from "../define-rule.mjs";

// Spying on a real logger patches a method on a shared pino instance for the
// life of the test process; a later test can observe (or fail to observe)
// the spy left behind. `createTestLogger()` gives a throwaway logger a test
// can assert on directly, with no patching.

const LOG_METHOD = /^(?:fatal|error|warn|info|debug|trace)$/;
// `logger`, `log`, `appLogger`, `request_log`; never `catalog` or `dialog`.
const LOGGER_NAME = /(?:^|_)(?:log|logger|Log|Logger|LOG|LOGGER)$|[\da-z](?:Log|Logger)$/;

function isGoverned(file) {
  return file.isTest;
}

function isCreateLoggerCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "createLogger"
  );
}

function isSpyOnCall(node) {
  const { callee } = node;
  if (callee.type !== "MemberExpression" || callee.computed) return false;

  return (
    callee.object.type === "Identifier" &&
    callee.object.name === "vi" &&
    callee.property.name === "spyOn"
  );
}

/** The name a spy target goes by: `logger`, or `deps.logger`'s `logger`. */
function receiverName(target) {
  if (target?.type === "Identifier") return target.name;
  if (target?.type === "MemberExpression" && !target.computed) return target.property.name;

  return undefined;
}

function isLogMethod(method) {
  return (
    method?.type === "Literal" && typeof method.value === "string" && LOG_METHOD.test(method.value)
  );
}

function isLoggerTarget(target, loggerVariables) {
  const name = receiverName(target);
  if (name === undefined) return false;

  return loggerVariables.has(name) || LOGGER_NAME.test(name);
}

function spiesOnALogger([target, method], loggerVariables) {
  if (isCreateLoggerCall(target)) return true;

  return isLogMethod(method) && isLoggerTarget(target, loggerVariables);
}

export const noLoggerSpyRule = defineRule({
  name: "no-logger-spy",
  kind: "problem",
  messages: {
    spyOnLogger: {
      what: "`vi.spyOn` patches a real logger here.",
      fix: "Inject the `logger` from `createTestLogger()` (`@langwatch/test-harness`) and assert with `lines.findLine(level, text)` instead.",
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
        if (isSpyOnCall(node) && spiesOnALogger(node.arguments, loggerVariables)) {
          context.report({ node, messageId: "spyOnLogger" });
        }
      },
    };
  },
});
