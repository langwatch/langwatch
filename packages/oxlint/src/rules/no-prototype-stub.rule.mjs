import { defineRule } from "../define-rule.mjs";

// A test that builds its double with `Object.create(X.prototype)` gets an
// object that answers `instanceof` but has none of its fields set, which
// hides the class's real shape from the reader and from the test itself.

function isGoverned(file) {
  return file.isTest;
}

function isPrototypeMember(node) {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "prototype"
  );
}

export const noPrototypeStubRule = defineRule({
  name: "no-prototype-stub",
  kind: "problem",
  messages: {
    prototypeStub: {
      what: "`Object.create({{name}}.prototype)` builds a test double from a class prototype.",
      fix: "Build the stub as an object literal typed as the interface, or use the module fixture.",
    },
  },
  create(context, file) {
    if (!isGoverned(file)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        const isObjectCreate =
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier" &&
          callee.object.name === "Object" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "create";
        if (!isObjectCreate) return;

        const target = node.arguments[0];
        if (!isPrototypeMember(target)) return;
        const name = target.object.type === "Identifier" ? target.object.name : "(expression)";
        context.report({ node, messageId: "prototypeStub", data: { name } });
      },
    };
  },
});
