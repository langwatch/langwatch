import { defineRule } from "../define-rule.mjs";
import { isErrorToastType, isToasterGovernedCode } from "../toaster-shapes.mjs";

// A feature-web module must not raise a failure straight onto the Design System toaster: use the
// host port (`showErrorToast`, `host.failed`). Once a file imports the toaster, every
// `<toaster>.error(...)` and `type: "error"` counts, including a const holding "error".
// See dev/docs/adr/182-platform-blocks-architecture-drift.md.

const TOASTER_MODULE = "@langwatch/design-system/toaster";
const TRANSPARENT = new Set(["TSAsExpression", "TSSatisfiesExpression", "ParenthesizedExpression"]);

function unwrap(node) {
  let current = node;
  while (current && TRANSPARENT.has(current.type)) current = current.expression;

  return current;
}

/** `ds.toaster` off a namespace import: the namespace's name, if it is one. */
function namespaceHolderOf(object) {
  if (object?.type !== "MemberExpression" || object.computed) return undefined;

  return object.object?.type === "Identifier" ? object.object.name : undefined;
}

/** `type: kind` or the shorthand `{ type }`: the identifier the type is read from. */
function typeIdentifierOf(property) {
  if (property.type !== "Property" || property.computed) return undefined;
  const name = property.key?.type === "Identifier" ? property.key.name : property.key?.value;
  const value = unwrap(property.value);

  return name === "type" && value?.type === "Identifier" ? value.name : undefined;
}

function recordToasterImport({ node, state }) {
  if (node.source?.value !== TOASTER_MODULE) return;
  for (const specifier of node.specifiers ?? []) {
    if (specifier.type === "ImportSpecifier") state.bindings.add(specifier.local.name);
    if (specifier.type === "ImportNamespaceSpecifier") state.namespaces.add(specifier.local.name);
  }
}

function recordErrorConstant({ node, state }) {
  const init = unwrap(node.init);
  const holdsErrorLiteral = init?.type === "Literal" && init.value === "error";
  if (node.id?.type === "Identifier" && holdsErrorLiteral) state.errorConstants.add(node.id.name);
}

function recordErrorCall({ node, state }) {
  const callee = node.callee;
  if (callee?.type !== "MemberExpression" || callee.computed) return;
  if (callee.property?.name !== "error") return;
  if (callee.object?.type === "Identifier") {
    state.candidates.push({ node, binding: callee.object.name });
    return;
  }
  const namespace = namespaceHolderOf(callee.object);
  if (namespace !== undefined) state.candidates.push({ node, namespace });
}

function recordErrorProperty({ node, state }) {
  if (isErrorToastType(node)) {
    state.candidates.push({ node });
    return;
  }
  const constant = typeIdentifierOf(node);
  if (constant !== undefined) state.candidates.push({ node, constant });
}

/** Whether a candidate's binding, namespace or constant traces back to the toaster import. */
function isRaisedOnToaster({ candidate, state }) {
  const { binding, namespace, constant } = candidate;
  if (binding !== undefined && !state.bindings.has(binding)) return false;
  if (namespace !== undefined && !state.namespaces.has(namespace)) return false;
  if (constant !== undefined && !state.errorConstants.has(constant)) return false;

  return true;
}

export const noFailureOnToasterRule = defineRule({
  name: "no-failure-on-toaster",
  kind: "problem",
  applies: (file) => isToasterGovernedCode(file),
  messages: {
    failureOnToaster: {
      what: "This module raises a failure on the Design System toaster directly.",
      why: "A failure on the toaster singleton skips the code-keyed presentation registry and the trace id the boundary attaches.",
      fix: "Report it through the host port: `showErrorToast({ error, fallbackTitle })` or `host.failed(...)`. Success, info and warning notices may stay on the toaster. Read the `browser-telemetry-and-errors` skill.",
    },
  },
  create(context) {
    const state = {
      bindings: new Set(),
      namespaces: new Set(),
      errorConstants: new Set(),
      candidates: [],
    };

    return {
      ImportDeclaration: (node) => recordToasterImport({ node, state }),
      VariableDeclarator: (node) => recordErrorConstant({ node, state }),
      CallExpression: (node) => recordErrorCall({ node, state }),
      Property: (node) => recordErrorProperty({ node, state }),
      "Program:exit"() {
        if (state.bindings.size === 0 && state.namespaces.size === 0) return;
        for (const candidate of state.candidates) {
          if (isRaisedOnToaster({ candidate, state })) {
            context.report({ node: candidate.node, messageId: "failureOnToaster" });
          }
        }
      },
    };
  },
});
