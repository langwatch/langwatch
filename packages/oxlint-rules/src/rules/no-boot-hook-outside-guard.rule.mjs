import { defineRule } from "../define-rule.mjs";

// Process-level failure handling is one seam, not one per package: a second
// `uncaughtException` or `unhandledRejection` listener races the boot guard
// and can swallow the exit it relies on.

// A `Server` installs the first; a one-shot executable boots through the second.
const BOOT_GUARD_FILES = new Set([
  "packages/process/src/server.ts",
  "packages/observability/src/boot-guard.ts",
]);
// A published SDK cannot reach either guard; it owns its own process.
const PUBLISHED_SDK = /^sdks\//;
const GOVERNED_EVENT = /^(?:uncaughtException|unhandledRejection)$/;
const LISTEN_METHOD = /^(?:on|once|addListener|prependListener|prependOnceListener)$/;

function isProcessListen(callee) {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "process" &&
    LISTEN_METHOD.test(callee.property.name)
  );
}

export const noBootHookOutsideGuardRule = defineRule({
  name: "no-boot-hook-outside-guard",
  kind: "problem",
  messages: {
    bootHookOutsideGuard: {
      what: '`process.{{method}}("{{event}}", ...)` is registered outside the boot guard.',
      why: "The boot guard owns shutdown and fatal errors; a second listener races it and can lose the exit code.",
      fix: "Delete this listener and boot through the guard: a long-running process through the `Server` from `@langwatch/process`, a one-shot executable through `bootNodeExecutable` from `@langwatch/observability`. Read the `process-composition` skill.",
    },
  },
  create(context, file) {
    if (BOOT_GUARD_FILES.has(file.workspacePath) || PUBLISHED_SDK.test(file.workspacePath))
      return {};

    return {
      CallExpression(node) {
        if (!isProcessListen(node.callee)) return;

        const eventArgument = node.arguments[0];
        const event = eventArgument?.type === "Literal" ? eventArgument.value : undefined;
        if (typeof event === "string" && GOVERNED_EVENT.test(event)) {
          const method = node.callee.property.name;
          context.report({ node, messageId: "bootHookOutsideGuard", data: { event, method } });
        }
      },
    };
  },
});
