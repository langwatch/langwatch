import { defineRule } from "../define-rule.mjs";

// A module's shape is read at compile time, not discovered at runtime: no
// Proxy standing in for a class, no Reflect call routing around a method, no
// defineProperty patching an object that is not a class prototype. The one
// sanctioned exception is `packages/test-harness`'s `createApiFixture`, which
// builds a throwaway double for a test rather than production behaviour.

const GOVERNED_SOURCE =
  /^(?:enterprise\/)?modules\/[^/]+\/(?:contract|process|browser|browser-kit)\/src\/|^apps\/api\/src\/features\/|^apps\/worker\/src\/app\//;
const EXCLUDED = /(?:^|\/)__tests__(?:\/|$)|^packages\/test-harness\//;
const REFLECT_MEMBERS = new Set(["get", "set", "has", "apply", "construct", "deleteProperty"]);
const WHITESPACE = /\s+/g;
const TARGET_BUDGET = 40;

/** The patched target as the reader sees it written, so the message quotes the source. */
function targetTextOf(source, node) {
  if (!node) return "this target";
  const text = source.slice(node.range[0], node.range[1]).replace(WHITESPACE, " ").trim();
  if (text.length === 0) return "this target";

  return text.length > TARGET_BUDGET ? `${text.slice(0, TARGET_BUDGET)}…` : text;
}

function isGoverned(workspacePath) {
  return GOVERNED_SOURCE.test(workspacePath) && !EXCLUDED.test(workspacePath);
}

function isPrototypeTarget(node) {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "prototype"
  );
}

export const noRuntimeReflectionRule = defineRule({
  name: "no-runtime-reflection",
  kind: "problem",
  messages: {
    proxy: {
      what: "`new Proxy(...)` stands in for a class here.",
      fix: "Write the class or app the module already declares instead of intercepting it at runtime.",
    },
    reflect: {
      what: "`Reflect.{{member}}` reaches around a method call.",
      fix: "Call the method directly; add it to the interface if it is missing.",
    },
    defineProperty: {
      what: "`Object.defineProperty` patches `{{target}}`, which is not a class prototype.",
      fix: "Declare the property directly where `{{target}}` is defined — in its class body or its object literal — instead of patching it in afterward.",
    },
  },
  create(context, file) {
    if (!isGoverned(file.workspacePath)) return {};
    const source = context.sourceCode.text;

    return {
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Proxy") {
          context.report({ node, messageId: "proxy" });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.object.type === "Identifier" && callee.object.name === "Reflect") {
          const member = callee.property.type === "Identifier" ? callee.property.name : undefined;
          if (member && REFLECT_MEMBERS.has(member)) {
            context.report({ node, messageId: "reflect", data: { member } });
          }
          return;
        }
        if (callee.object.type !== "Identifier") return;
        if (callee.object.name !== "Object") return;
        if (callee.property.type !== "Identifier") return;
        if (callee.property.name !== "defineProperty") return;
        const target = node.arguments[0];
        if (!isPrototypeTarget(target)) {
          context.report({
            node,
            messageId: "defineProperty",
            data: { target: targetTextOf(source, target) },
          });
        }
      },
    };
  },
});
