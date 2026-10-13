import { childNodes } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import { createSetterScopes, hookNameOf, isBrowserCode, isFunction } from "../react-state.mjs";

// An effect whose whole body copies a value derived from its dependencies into
// state is a second render for nothing (ARCHITECTURE.md, browser state tiers).
// Left alone: an empty dependency array, guarded or mixed bodies, a cleanup, a
// setter fed a literal, a setter that is a prop, and anything reading a ref, the DOM, a clock
// or a promise.

const EFFECTS = new Set(["useEffect", "useLayoutEffect"]);
const IMPURE = new Set([
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "Date",
  "performance",
  "setTimeout",
]);

function rootsOf(node, names) {
  if (node.type === "Identifier") names.add(node.name);
  if (node.type === "MemberExpression" && !node.computed) return rootsOf(node.object, names);
  for (const child of childNodes(node)) rootsOf(child, names);

  return names;
}

function isImpure(node) {
  if (node.type === "AwaitExpression") return true;
  if (node.type === "Identifier" && IMPURE.has(node.name)) return true;
  if (node.type === "MemberExpression" && node.property?.name === "current") return true;

  return [...childNodes(node)].some(isImpure);
}

function statementsOf(callback) {
  if (callback.body.type !== "BlockStatement") return [callback.body];

  return callback.body.statements ?? callback.body.body;
}

function setterCallOf({ scopes, statement }) {
  const call = statement.type === "ExpressionStatement" ? statement.expression : statement;
  if (call.type !== "CallExpression" || call.callee.type !== "Identifier") return undefined;

  return scopes.has(call.callee.name) && call.arguments.length === 1 ? call : undefined;
}

function depsOf(depsArray) {
  const deps = new Set();
  for (const element of depsArray.elements) if (element) rootsOf(element, deps);

  return deps;
}

function isDerived({ call, deps }) {
  const argument = call.arguments[0];
  if (isImpure(argument)) return false;

  return [...rootsOf(argument, new Set())].some((name) => deps.has(name));
}

export const effectDerivesStateRule = defineRule({
  name: "effect-derives-state",
  kind: "problem",
  applies: isBrowserCode,
  messages: {
    effectDerivesState: {
      what: "This effect only copies a value derived from its dependencies into `{{setter}}`.",
      why: "The component renders stale, then renders again; state that follows props or state is not state.",
      fix: "Delete the effect and the state, and compute the value during render (`useMemo` only if it is measurably slow). Read the `browser-module` skill.",
    },
  },
  create(context) {
    const scopes = createSetterScopes();

    return {
      ...scopes.visitors,
      VariableDeclarator(declarator) {
        scopes.collect(declarator);
      },
      CallExpression(node) {
        if (!EFFECTS.has(hookNameOf(node))) return;
        const [callback, depsArray] = node.arguments;
        if (!isFunction(callback) || depsArray?.type !== "ArrayExpression") return;
        if (depsArray.elements.length === 0) return;

        const calls = statementsOf(callback).map((statement) =>
          setterCallOf({ scopes, statement }),
        );
        if (calls.length === 0 || calls.includes(undefined)) return;
        const deps = depsOf(depsArray);
        if (!calls.every((call) => isDerived({ call, deps }))) return;

        context.report({
          node,
          messageId: "effectDerivesState",
          data: { setter: calls.map((call) => call.callee.name).join(", ") },
        });
      },
    };
  },
});
