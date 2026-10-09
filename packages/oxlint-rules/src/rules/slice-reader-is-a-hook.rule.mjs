import { defineRule } from "../define-rule.mjs";

// The React Compiler knows a hook only by its `use` name: a slice reader bound to any other
// name has its call cached inside a memo block, and the next render skips the hook.

const SLICE_FACTORIES = new Set(["defineSlice", "readSlice"]);
const HOOK_NAME = /^use[A-Z0-9]/;

export const sliceReaderIsAHookRule = defineRule({
  name: "slice-reader-is-a-hook",
  kind: "problem",
  applies: (file) => file.isProduction,
  messages: {
    sliceReaderName: {
      what: "`{{name}}` holds a `{{factory}}(...)` reader, which is a hook.",
      why: "The React Compiler caches a call to a non-`use` name, so the hook runs on one render and not the next.",
      fix: "Rename it `use{{suggestion}}` and call it only where a hook may be called.",
    },
  },
  create(context) {
    return {
      VariableDeclarator(node) {
        const init = node.init;
        if (init?.type !== "CallExpression" || init.callee.type !== "Identifier") return;
        if (!SLICE_FACTORIES.has(init.callee.name)) return;
        if (node.id.type !== "Identifier" || HOOK_NAME.test(node.id.name)) return;
        const name = node.id.name;
        context.report({
          node: node.id,
          messageId: "sliceReaderName",
          data: {
            name,
            factory: init.callee.name,
            suggestion: `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
          },
        });
      },
    };
  },
});
