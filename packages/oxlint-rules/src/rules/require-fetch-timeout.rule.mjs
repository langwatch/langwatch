import { defineRule } from "../define-rule.mjs";

// A channel is how a module talks to what it does not own; a `fetch` with no
// abort signal hangs its caller for as long as the peer holds the socket open.

function isChannelSource(file) {
  return file.layer === "channels" && !file.isTest;
}

function isGlobalFetch(callee) {
  if (callee.type === "Identifier") return callee.name === "fetch";

  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "globalThis" &&
    callee.property.name === "fetch"
  );
}

/** Whether an init object could carry a signal: it names one, or spreads something that might. */
function mayCarrySignal(init) {
  return init.properties.some(
    (property) =>
      property.type === "SpreadElement" || (!property.computed && property.key?.name === "signal"),
  );
}

export const requireFetchTimeoutRule = defineRule({
  name: "require-fetch-timeout",
  kind: "problem",
  applies: isChannelSource,
  messages: {
    fetchWithoutSignal: {
      what: "This `fetch` has no abort signal, so a peer that never answers hangs the caller.",
      fix: "Pass `signal: AbortSignal.timeout(ms)` (or a controller's signal) in the init object.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isGlobalFetch(node.callee)) return;
        const [, init] = node.arguments;
        if (init && (init.type !== "ObjectExpression" || mayCarrySignal(init))) return;
        context.report({ node, messageId: "fetchWithoutSignal" });
      },
    };
  },
});
