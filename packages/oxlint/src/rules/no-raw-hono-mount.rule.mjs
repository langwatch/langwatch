import { defineRule } from "../define-rule.mjs";

// The raw Hono app behind a SecuredApp. Registering a verb on it mounts a
// route the access policy never saw: the type system seals the published
// view and the boot assertion catches a mount that got past it, and this
// catches the source.

const RAW_HONO_MOUNT = /\.hono\.(?:get|post|put|patch|delete|all|on|use)\s*\(/g;

export const noRawHonoMountRule = defineRule({
  name: "no-raw-hono-mount",
  kind: "problem",
  create(context, file) {
    if (!/^(?:apps|packages)\//.test(file.workspacePath)) return {};

    return {
      Program() {
        const source = context.sourceCode.text;
        RAW_HONO_MOUNT.lastIndex = 0;
        let match = RAW_HONO_MOUNT.exec(source);
        while (match) {
          context.report({
            loc: { line: source.slice(0, match.index).split(/\r?\n/).length, column: 0 },
            messageId: "rawMount",
          });
          match = RAW_HONO_MOUNT.exec(source);
        }
      },
    };
  },
  messages: {
    rawMount: {
      what: "Mount through `app.access(policy)`; the raw Hono app skips the access policy.",
      fix: "Register the route through `app.access(policy)` instead of `app.hono`.",
    },
  },
});
