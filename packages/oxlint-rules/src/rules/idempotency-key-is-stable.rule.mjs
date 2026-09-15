import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";
import { assignedFieldNameOf, idempotencyKeyTargetOf, mintedSourceOf } from "./idempotency-key.mjs";

// An idempotency key exists so a retry of the same logical operation is
// recognised as the same operation. Minting one where the request is built
// gives every attempt a different key: the field is on the wire and the
// guarantee is absent. Swapping the random for a house ksuid changes nothing —
// what has to change is where the key comes from.

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
  if (!BIND_ONCE_HOOKS.has(calleeName(call.callee) ?? "")) return false;

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
  create(context, file) {
    const baselined = isBaselined({
      cwd: context.cwd,
      file: file.workspacePath,
      rule: "idempotency-key-is-stable",
    });
    if (baselined) return {};

    const check = (node) => {
      const target = idempotencyKeyTargetOf(node);
      if (!target) return;

      const source = mintedSourceOf(target.value);
      if (!source || isBoundOnce(node)) return;

      context.report({
        node: target.value,
        messageId: "mintedAtCallSite",
        data: { name: "idempotencyKey", source },
      });
    };

    return { AssignmentExpression: check, Property: check, VariableDeclarator: check };
  },
});
