import { defineRule } from "../define-rule.mjs";

// A component that receives the form and calls `form.watch()` re-renders on
// every keystroke of the whole form, because only the form's owner may watch.

function isBrowserSource(file) {
  return (file.role === "browser" || file.role === "browser-kit") && !file.isTest;
}

function isParameter(context, identifier) {
  let scope = context.sourceCode.getScope(identifier);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;

  return scope?.set.get(identifier.name)?.defs[0]?.type === "Parameter";
}

export const noFormWatchInChildRule = defineRule({
  name: "no-form-watch-in-child",
  kind: "problem",
  applies: isBrowserSource,
  messages: {
    watchOnReceivedForm: {
      what: "`{{form}}.watch()` runs on a form this component received as a prop, so the whole form tree re-renders on every keystroke.",
      fix: "Read the value with `useWatch({ control: {{form}}.control, name })` instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.name !== "watch" || callee.object.type !== "Identifier") return;
        if (!isParameter(context, callee.object)) return;
        context.report({
          node,
          messageId: "watchOnReceivedForm",
          data: { form: callee.object.name },
        });
      },
    };
  },
});
