import { defineRule } from "../define-rule.mjs";
import { assignedFieldNameOf, idempotencyKeyTargetOf, mintedSourceOf } from "./idempotency-key.mjs";

// A key minted where the request is built differs on every retry: the field is
// on the wire and the guarantee is absent. A house ksuid changes nothing; where
// the key comes from is what has to change.

const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

/** Hooks whose first argument runs once for the mount, not once per render. */
const BIND_ONCE_HOOKS = new Set(["useState", "useRef", "useMemo", "lazy"]);

/** The slot a `useRef` holds its value in — a write there outlives the render. */
const REF_SLOT = "current";

function calleeName(callee) {
  if (callee?.type === "Identifier") return callee.name;
  if (callee?.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return callee.property.name;
  }

  return undefined;
}

function isBindOnceInitializer(fn) {
  const call = fn.parent;
  if (call?.type !== "CallExpression") return false;
  const name = calleeName(call.callee) ?? "";
  if (!BIND_ONCE_HOOKS.has(name)) return false;

  return (call.arguments ?? []).includes(fn);
}

/**
 * Whether the mint reached here sits in a place evaluated once for the
 * operation rather than once per attempt: a ref slot, a bind-once hook's
 * initializer, or module scope.
 */
function isBoundOnce(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (assignedFieldNameOf(current) === REF_SLOT) return true;
    if (FUNCTION_TYPES.has(current.type)) return isBindOnceInitializer(current);
    if (current.type === "Program") return true;
  }

  return true;
}

function isProductionSource(file) {
  return file.isProduction;
}

export const idempotencyKeyIsStableRule = defineRule({
  name: "idempotency-key-is-stable",
  kind: "problem",
  applies: isProductionSource,
  messages: {
    mintedAtCallSite: {
      what: "`{{name}}` is minted here by `{{source}}`, so every retry sends a different key and nothing is deduplicated.",
      why: "A key that changes per attempt is a field on the wire, not a guarantee: the server sees each retry as a new operation.",
      fix: "Derive it from the request's own content, or bind it once for the operation it identifies — `useState(() => crypto.randomUUID())` for a form, a key threaded from the caller for a mutation — and pass that binding here.",
    },
  },
  create(context, _file) {
    const check = (node) => {
      const target = idempotencyKeyTargetOf(node);
      if (!target) return;

      const source = mintedSourceOf(target.value);
      if (!source || isBoundOnce(node)) return;

      context.report({
        node: target.value,
        messageId: "mintedAtCallSite",
        data: { name: target.name, source },
      });
    };

    return {
      AssignmentExpression: check,
      CallExpression: check,
      Property: check,
      VariableDeclarator: check,
    };
  },
});
