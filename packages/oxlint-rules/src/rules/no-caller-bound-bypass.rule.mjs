import { defineRule } from "../define-rule.mjs";

// A caller that holds a boolean saying "do not limit me" decides a limit that is not its own.
// The owner decides its limits from where the call came from, so the contract carries an origin
// and the owner maps it to a limit. A property named like a bypass in a contract is that boolean.

const BYPASS_NAME = /^(?:is)?exempt|^bypass|^skip\w*limit|^ignore\w*limit/i;

function propertyName(key) {
  if (key?.type === "Identifier") return key.name;
  if (key?.type === "Literal" && typeof key.value === "string") return key.value;

  return undefined;
}

export const noCallerBoundBypassRule = defineRule({
  name: "no-caller-bound-bypass",
  kind: "problem",
  applies: (file) => file.isProduction && file.role === "contract",
  messages: {
    callerBoundBypass: {
      what: "`{{name}}` lets the caller say that a limit does not apply to it.",
      why: "The owner decides its own limits; a boolean the caller holds moves that decision to the caller.",
      fix: "Pass the origin of the call (where it came from) and let the owner map the origin to its limit. Read the `contract` skill.",
    },
  },
  create(context) {
    const check = (key) => {
      const name = propertyName(key);
      if (name !== undefined && BYPASS_NAME.test(name)) {
        context.report({ node: key, messageId: "callerBoundBypass", data: { name } });
      }
    };

    return {
      // Interface and type-literal members, which is how an `*Api` method input is declared.
      TSPropertySignature(node) {
        if (!node.computed) check(node.key);
      },
      // Zod object shapes, which is how a schema-first contract declares the same input.
      "CallExpression > ObjectExpression > Property"(node) {
        const call = node.parent.parent;
        const callee = call.callee;
        const isShape =
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "z" &&
          callee.property.type === "Identifier" &&
          ["object", "strictObject", "looseObject"].includes(callee.property.name);
        if (isShape && !node.computed) check(node.key);
      },
    };
  },
});
