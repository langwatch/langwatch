import { defineRule } from "../define-rule.mjs";

// A class whose every member is static is a module that put on a class. The
// reader pays for `this`-less methods behind a name, an unused `create`, and a
// file that looks like a service. Rules functions in a rules/ module are the
// house shape for pure behaviour.

function isStrictServerSource(file) {
  return file.role === "server" && file.layoutVersion === 0 && Boolean(file.strictSource);
}

function memberName(member) {
  return member.key?.type === "Identifier" ? member.key.name : undefined;
}

function isConstructor(member) {
  return member.type === "MethodDefinition" && member.kind === "constructor";
}

function isStaticBlock(member) {
  return member.type === "StaticBlock";
}

export const namespaceClassRule = defineRule({
  name: "namespace-class",
  kind: "problem",
  applies: (file) => file.isProduction && isStrictServerSource(file),
  messages: {
    namespaceClass: {
      what: "`{{name}}` has only static members ({{count}}), so it is a module wearing a class.",
      why: "A class earns its name by holding state; a bag of statics hides plain functions behind a namespace and a `create` nobody calls.",
      fix: "Export the functions from a `rules/` module and delete the class.",
    },
  },
  create(context) {
    return {
      ClassDeclaration(node) {
        const members = node.body.body.filter(
          (member) => !isConstructor(member) && !isStaticBlock(member),
        );

        if (members.length === 0) return;

        if (!members.every((member) => member.static)) return;

        // A provider descriptor (`static requires` beside `static create`) is the
        // registry's shape, not a namespace: only static methods count as behaviour.
        const behaviour = members.filter(
          (member) => member.type === "MethodDefinition" && memberName(member) !== "create",
        );

        if (behaviour.length === 0) return;

        context.report({
          node: node.id ?? node,
          messageId: "namespaceClass",
          data: { name: node.id?.name ?? "This class", count: members.length },
        });
      },
    };
  },
});
