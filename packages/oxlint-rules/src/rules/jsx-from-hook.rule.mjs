import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";

// Hooks return state and callbacks; a component renders. CLAUDE.md and
// dev/docs/best_practices/react.md both say so — a hook that returns JSX is a
// component wearing the wrong name, and it recurs in generated code. Only the
// hook's own top-level returns count: a returned render callback (a
// render-prop factory) is a different function and stays out of scope.

const HOOK_NAME = /^use[A-Z]/;
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function isJsxReturn(node) {
  if (!node) return false;
  if (node.type === "JSXElement" || node.type === "JSXFragment") return true;
  if (node.type === "ConditionalExpression") {
    return isJsxReturn(node.consequent) || isJsxReturn(node.alternate);
  }
  if (node.type === "LogicalExpression") return isJsxReturn(node.left) || isJsxReturn(node.right);

  return false;
}

function checkHookBody(context, name, body) {
  if (!body || body.type !== "BlockStatement") return;

  walk(body, (node) => {
    if (node !== body && FUNCTION_TYPES.has(node.type)) return false;
    if (node.type === "ReturnStatement" && isJsxReturn(node.argument)) {
      context.report({ node, messageId: "hookReturnsJsx", data: { name } });
    }
  });
}

export const jsxFromHookRule = defineRule({
  name: "jsx-from-hook",
  kind: "problem",
  applies: (file) => file.isProduction && file.workspacePath.endsWith(".tsx"),
  messages: {
    hookReturnsJsx: {
      what: "Hook `{{name}}` returns JSX.",
      why: "Hooks return state and callbacks; a hook that renders is a component wearing the wrong name.",
      fix: "Return the state and callbacks, and move the JSX into the component that calls this hook.",
    },
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        if (node.id?.type !== "Identifier" || !HOOK_NAME.test(node.id.name)) return;
        checkHookBody(context, node.id.name, node.body);
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || !HOOK_NAME.test(node.id.name)) return;
        if (node.init?.type !== "FunctionExpression" && node.init?.type !== "ArrowFunctionExpression") {
          return;
        }
        checkHookBody(context, node.id.name, node.init.body);
      },
    };
  },
});
