import { defineRule } from "../define-rule.mjs";

// Process-level failure handling is one seam, not one per package: a second
// `uncaughtException` or `unhandledRejection` listener races the boot guard
// and can swallow the exit it relies on.

const BOOT_GUARD_FILE = "packages/observability/src/boot-guard.ts";
const GOVERNED_EVENT = /^(?:uncaughtException|unhandledRejection)$/;

export const noBootHookOutsideGuardRule = defineRule({
  name: "no-boot-hook-outside-guard",
  kind: "problem",
  messages: {
    bootHookOutsideGuard: {
      what: "`process.on(\"{{event}}\", ...)` is registered outside the boot guard.",
      fix: "Let the boot guard (`packages/observability/src/boot-guard.ts`) own process-level failure handling.",
    },
  },
  create(context, file) {
    if (file.workspacePath === BOOT_GUARD_FILE) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        const isProcessOn =
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier" &&
          callee.object.name === "process" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "on";
        if (!isProcessOn) return;

        const eventArgument = node.arguments[0];
        const event = eventArgument?.type === "Literal" ? eventArgument.value : undefined;
        if (typeof event === "string" && GOVERNED_EVENT.test(event)) {
          context.report({ node, messageId: "bootHookOutsideGuard", data: { event } });
        }
      },
    };
  },
});
