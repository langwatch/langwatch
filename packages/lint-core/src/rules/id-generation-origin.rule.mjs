import { defineRule } from "../define-rule.mjs";

// Every id the platform mints is a ksuid behind a kind prefix, so an id says
// what it names and sorts by time. A `nanoid` import or a `randomUUID()` call
// in a feature or a process starts a second scheme that neither sorts nor
// names its kind.

const FOREIGN_ID_MODULES = new Set(["nanoid", "nanoid/non-secure", "uuid"]);

function isFeatureOrProcessSource(file) {
  if (file.kind === "application") return true;

  return file.layoutVersion === 0 && Boolean(file.strictSource);
}

function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;

  if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return callee.property.name;
  }

  return undefined;
}

export const idGenerationOriginRule = defineRule({
  name: "id-generation-origin",
  kind: "problem",
  applies: (file) => file.isProduction && isFeatureOrProcessSource(file),
  messages: {
    foreignIdModule: {
      what: "`{{name}}` mints ids outside the house scheme.",
      why: "A second id scheme neither sorts by time nor names its kind, and two schemes in one table are a migration.",
      fix: "Import `generate` from `@langwatch/ksuid` and prefix the kind: `agent_${generate()}`.",
    },
    randomUuid: {
      what: "`randomUUID()` mints an id outside the house scheme.",
      why: "A UUID neither sorts by time nor names its kind, and two schemes in one table are a migration.",
      fix: "Import `generate` from `@langwatch/ksuid` and prefix the kind: `agent_${generate()}`.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (!FOREIGN_ID_MODULES.has(node.source.value)) return;

        context.report({
          node: node.source,
          messageId: "foreignIdModule",
          data: { name: node.source.value },
        });
      },
      CallExpression(node) {
        if (calleeName(node.callee) !== "randomUUID") return;

        context.report({ node: node.callee, messageId: "randomUuid" });
      },
    };
  },
});
