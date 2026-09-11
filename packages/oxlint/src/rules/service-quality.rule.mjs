import { defineRule } from "../define-rule.mjs";

// Duplicate members and keys, and a `static create` factory whose constructor
// stayed public so callers could bypass it.
//
// This used to also re-scan the raw class source for a duplicate method oxc
// silently dropped while parser-recovering. It no longer does either: a `.ts`
// file with a duplicate class member now fails to parse at all (verified
// against the pinned oxlint), and a `.js` file keeps both members in the AST.
// The native per-member check below already reports both cases; the O(n*m)
// source rescan was reporting a condition that can no longer occur.

function memberName(member) {
  if (!member.key) return undefined;
  if (member.computed && member.key.type === "Literal") {
    return String(member.key.value);
  }
  if (member.computed) return undefined;
  if (member.key.type === "Identifier" || member.key.type === "PrivateIdentifier") {
    return member.key.name;
  }
  if (member.key.type === "Literal") return String(member.key.value);
  return undefined;
}

function objectKeyName(property) {
  if (property.type === "SpreadElement") return undefined;
  if (property.computed && property.key?.type === "Literal") {
    return String(property.key.value);
  }
  if (property.computed) return undefined;
  if (property.key?.type === "Identifier") return property.key.name;
  if (property.key?.type === "Literal") return String(property.key.value);
  return undefined;
}

export const serviceQualityRule = defineRule({
  name: "service-quality",
  kind: "problem",
  applies: (file) => file.isServiceModule,
  messages: {
    duplicateMember: {
      what: "A service class cannot declare the member {{name}} more than once.",
      fix: "Remove or rename one of the declarations.",
    },
    duplicateObjectKey: {
      what: "A service object literal cannot declare the key {{name}} more than once.",
      fix: "Remove or rename one of the keys.",
    },
    publicConstructor: {
      what: "`{{name}}` has `static create`, so its constructor must be `private` so callers cannot bypass it.",
      fix: "Mark the constructor `private`.",
    },
  },
  create(context) {
    return {
      ClassBody(node) {
        const names = new Map();
        for (const member of node.body) {
          const name = memberName(member);
          if (!name || name === "constructor") continue;
          const accessor = member.kind === "get" || member.kind === "set";
          const key = `${member.static ? "static" : "instance"}:${name}`;
          const prior = names.get(key);
          const overloadPair =
            prior &&
            member.type === "MethodDefinition" &&
            prior.type === "MethodDefinition" &&
            !prior.value?.body;
          if (
            prior &&
            !overloadPair &&
            !(accessor && prior.accessor && prior.kind !== member.kind)
          ) {
            context.report({
              node: member,
              messageId: "duplicateMember",
              data: { name },
            });
          }
          names.set(key, member);
        }
      },
      ClassDeclaration(node) {
        if (!node.id?.name.endsWith("Service") || node.abstract) return;
        const hasStaticCreate = node.body.body.some(
          (member) =>
            member.type === "MethodDefinition" && member.static && memberName(member) === "create",
        );
        if (!hasStaticCreate) return;
        const constructor = node.body.body.find(
          (member) => member.type === "MethodDefinition" && member.kind === "constructor",
        );
        if (constructor && (!constructor.accessibility || constructor.accessibility === "public")) {
          context.report({
            node: constructor,
            messageId: "publicConstructor",
            data: { name: node.id.name },
          });
        }
      },
      ObjectExpression(node) {
        const keys = new Set();
        for (const property of node.properties) {
          const key = objectKeyName(property);
          if (!key) continue;
          if (keys.has(key)) {
            context.report({
              node: property,
              messageId: "duplicateObjectKey",
              data: { name: key },
            });
          }
          keys.add(key);
        }
      },
    };
  },
});
