import { defineRule } from "../define-rule.mjs";

function chainsOffAwait(node) {
  if (node.type === "AwaitExpression") return false;
  return walksToAwait(node);
}

/** Whether `call.callee` is a member expression sitting directly on an awaited value. */
function calleeAwaitsDirectly(call) {
  if (call.callee.type !== "MemberExpression") return false;
  return call.callee.object.type === "AwaitExpression";
}

function walksToAwait(node) {
  let current = node;
  while (current) {
    if (current.type === "MemberExpression" || current.type === "OptionalMemberExpression") {
      if (current.object.type === "AwaitExpression") return true;
      current = current.object;
      continue;
    }
    if (current.type === "CallExpression" || current.type === "OptionalCallExpression") {
      if (calleeAwaitsDirectly(current)) return true;
      current = current.callee;
      continue;
    }
    return false;
  }
  return false;
}

export const awaitedReturnChainRule = defineRule({
  name: "awaited-return-chain",
  kind: "problem",
  applies: (file) => file.isServiceModule,
  messages: {
    awaitedReturnChain: {
      what: "Name the awaited result before chaining properties or calls from it.",
      fix: "Assign the awaited value to a const, then chain from the const.",
    },
  },
  create(context) {
    return {
      ReturnStatement(node) {
        if (node.argument && chainsOffAwait(node.argument)) {
          context.report({ node, messageId: "awaitedReturnChain" });
        }
      },
    };
  },
});
