import { defineRule } from "../define-rule.mjs";

// A class whose every member is static is a module that put on a class. The
// reader pays for `this`-less methods behind a name, an unused `create`, and a
// file that looks like a service. Rules functions in a rules/ module are the
// house shape for pure behaviour.

function isStrictProcessSource(file) {
  return file.role === "process" && Boolean(file.strictSource);
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

// A class name is always PascalCase in this codebase, so kebab-casing it
// deterministically names the sibling `rules/` file to move its statics into.
function toKebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export const namespaceClassRule = defineRule({
  name: "namespace-class",
  kind: "problem",
  applies: (file) => file.isProduction && isStrictProcessSource(file),
  messages: {
    namespaceClass: {
      what: "`{{name}}` has only static members ({{count}}), so it is a module wearing a class.",
      why: "A class earns its name by holding state; a bag of statics hides plain functions behind a namespace and a `create` nobody calls.",
      fix: "Export the functions to `{{target}}` and delete the class.",
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

        const name = node.id?.name;
        context.report({
          node: node.id ?? node,
          messageId: "namespaceClass",
          data: {
            count: members.length,
            name: name ?? "This class",
            target: name ? `rules/${toKebab(name)}.rules.ts` : "rules/<name>.rules.ts",
          },
        });
      },
    };
  },
});
