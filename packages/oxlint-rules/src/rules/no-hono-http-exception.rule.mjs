import { defineRule } from "../define-rule.mjs";

// A module answers with a HandledError, never a hand-built HTTPException (W-02 G3c, Alex 2026-10-08).

const HONO_EXCEPTION = "hono/http-exception";

export const noHonoHttpExceptionRule = defineRule({
  name: "no-hono-http-exception",
  kind: "problem",
  applies: (file) => file.isProduction && Boolean(file.feature),
  messages: {
    honoException: {
      what: "`{{path}}` imports `hono/http-exception`.",
      why: "A module answers with a HandledError; a raw HTTPException skips the framework's error mapping.",
      fix: "Drop the hand-built answer: `.withBodyLimit` refuses with `PayloadTooLargeError`; throw a HandledError otherwise. Read the `api-transports` skill.",
    },
  },
  create(context, file) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== HONO_EXCEPTION) return;
        context.report({ node, messageId: "honoException", data: { path: file.workspacePath } });
      },
    };
  },
});
