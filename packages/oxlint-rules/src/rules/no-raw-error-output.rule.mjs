import { defineRule } from "../define-rule.mjs";

// A raw `console.error(err)` or a `.stack` dump bypasses the structured
// logger: it has no trace id, no level filtering, and reads as an unhandled
// crash in the terminal even when the caller recovered. Log through
// `createLogger` with the error as a field instead.

const GOVERNED_SOURCE =
  /^apps\/(?:api|worker|tasks)\/src\/|^(?:enterprise\/)?modules\/[^/]+\/server\/src\/|^packages\/[^/]+\/src\//;
const EXCLUDED =
  /(?:^|\/)__tests__(?:\/|$)|\.(?:test|spec|unit|integration|e2e)\.[cm]?[jt]sx?$|^packages\/observability\/src\/boot-guard\.ts$/;
const ERRORISH_NAME = /^(?:err|error|e|cause|exception)$/;

function isGoverned(workspacePath) {
  return GOVERNED_SOURCE.test(workspacePath) && !EXCLUDED.test(workspacePath);
}

function isErrorishArgument(node) {
  if (node.type === "Identifier") return ERRORISH_NAME.test(node.name);
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return node.property.name === "stack" && isErrorishArgument(node.object);
  }
  return false;
}

function consoleMethod(callee) {
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.object.type !== "Identifier" ||
    callee.object.name !== "console" ||
    callee.property.type !== "Identifier"
  ) {
    return undefined;
  }
  return callee.property.name;
}

function isStderrWrite(callee) {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "MemberExpression" &&
    !callee.object.computed &&
    callee.object.object.type === "Identifier" &&
    callee.object.object.name === "process" &&
    callee.object.property.type === "Identifier" &&
    callee.object.property.name === "stderr" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "write"
  );
}

export const noRawErrorOutputRule = defineRule({
  name: "no-raw-error-output",
  kind: "problem",
  messages: {
    rawErrorOutput: {
      what: "`{{call}}` dumps `{{name}}` straight to the console.",
      fix: "Log through `createLogger` with the error as a field instead of a raw console dump.",
    },
  },
  create(context, file) {
    if (!isGoverned(file.workspacePath)) return {};

    return {
      CallExpression(node) {
        const method = consoleMethod(node.callee);
        const isConsoleCall = method !== undefined;
        const isWrite = !isConsoleCall && isStderrWrite(node.callee);
        if (!isConsoleCall && !isWrite) return;

        const argument = node.arguments[0];
        if (!argument || !isErrorishArgument(argument)) return;

        const name = argument.type === "Identifier" ? argument.name : argument.property.name;
        const call = isConsoleCall ? `console.${method}` : "process.stderr.write";
        context.report({ node, messageId: "rawErrorOutput", data: { call, name } });
      },
    };
  },
});
