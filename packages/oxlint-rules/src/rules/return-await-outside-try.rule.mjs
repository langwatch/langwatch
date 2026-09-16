import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";

// `return await x` outside a try adds a microtask tick with no observable
// effect, since nothing here can catch and rewrap a rejection. Inside a
// try, the await is load-bearing - it lets that try's own catch/finally
// observe the rejection. A `using` declaration or an async generator's
// `return` is also load-bearing and never reported (scope: `ReturnStatement` only).

const GOVERNED =
  /^(?:enterprise\/modules|modules|apps|packages|sdks\/typescript\/src|mcp\/typescript\/src)\//;

function isGoverned(file) {
  return GOVERNED.test(file.workspacePath);
}

const FUNCTION_BOUNDARY = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const USING_KINDS = new Set(["using", "await using"]);
const WHITESPACE = /\s+/g;
const EXPRESSION_BUDGET = 40;

/** The expression as the reader sees it written, so the message quotes the source. */
function expressionTextOf(source, node) {
  const text = source.slice(node.range[0], node.range[1]).replace(WHITESPACE, " ").trim();
  if (text.length === 0) return "the expression";

  return text.length > EXPRESSION_BUDGET ? `${text.slice(0, EXPRESSION_BUDGET)}…` : text;
}

/** The nearest function a return statement returns from, walking up parents. */
function enclosingFunction(node) {
  let current = node.parent;
  while (current && !FUNCTION_BOUNDARY.has(current.type)) current = current.parent;
  return current;
}

/** Whether a `TryStatement` sits anywhere between the return and its enclosing function. */
function isInsideTry(node, boundary) {
  let current = node.parent;
  while (current && current !== boundary) {
    if (current.type === "TryStatement") return true;
    current = current.parent;
  }
  return false;
}

// Walks `root` for a node `matches`, without crossing into a nested
// function's own body -- reused shape from fallible-result-naming.rule.mjs's
// scopedSearch, so a callback's own `using` declaration is not this one's.
function scopedSearch(root, matches) {
  let found = false;
  walk(root, (node) => {
    if (found) return false;
    if (matches(node)) {
      found = true;
      return false;
    }
    if (node !== root && FUNCTION_BOUNDARY.has(node.type)) return false;
    return true;
  });
  return found;
}

const hasUsingDeclarationInScope = (root) =>
  scopedSearch(
    root,
    (node) => node.type === "VariableDeclaration" && USING_KINDS.has(node.kind),
  );

export const returnAwaitOutsideTryRule = defineRule({
  name: "return-await-outside-try",
  kind: "problem",
  fixable: "code",
  applies: isGoverned,
  messages: {
    ritualReturnAwait: {
      what: "`return await {{expression}}` sits outside any `try`, so the `await` changes nothing the caller can observe.",
      why: "Inside a `try`, `return await` lets the enclosing `catch`/`finally` observe the rejection; outside one it only adds a tick.",
      fix: "Delete the `await` and return the expression directly.",
    },
  },
  create(context) {
    const source = context.sourceCode.text;

    return {
      ReturnStatement(node) {
        const awaitExpression = node.argument;
        if (!awaitExpression || awaitExpression.type !== "AwaitExpression") return;

        const boundary = enclosingFunction(node);
        if (!boundary) return;
        if (boundary.generator && boundary.async) return;
        if (isInsideTry(node, boundary)) return;
        if (hasUsingDeclarationInScope(boundary.body)) return;

        const awaited = awaitExpression.argument;
        context.report({
          node: awaitExpression,
          messageId: "ritualReturnAwait",
          data: { expression: expressionTextOf(source, awaited) },
          fix: (fixer) =>
            fixer.replaceTextRange(
              awaitExpression.range,
              source.slice(awaited.range[0], awaited.range[1]),
            ),
        });
      },
    };
  },
});
