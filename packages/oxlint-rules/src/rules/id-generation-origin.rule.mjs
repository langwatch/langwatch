import { defineRule } from "../define-rule.mjs";
import { withinAnIdempotencyKey } from "./idempotency-key.mjs";

// Every id the platform mints is a ksuid behind a kind prefix, so an id says
// what it names and sorts by time. A `nanoid` import or a `randomUUID()` call
// in a feature or a process starts a second scheme that neither sorts nor
// names its kind. An `idempotencyKey` is not an id: `idempotency-key-is-stable`
// governs it, because a ksuid there is one fresh random for another.

const FOREIGN_ID_MODULES = new Set(["nanoid", "nanoid/non-secure", "uuid"]);

function isFeatureOrProcessSource(file) {
  if (file.kind === "application") return true;

  return Boolean(file.strictSource);
}

function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;

  if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return callee.property.name;
  }

  return undefined;
}

// The example in the fix must name THIS file's own kind, not a fixed one —
// a module file already carries it (`agent.service.ts` -> feature `agent`);
// an `apps/*/src/features/<name>/...` process file names it in its path too.
function likelyKindPrefix(file) {
  if (file.feature) return file.feature;

  return file.sourcePath?.match(/^features\/([^/]+)\//)?.[1];
}

export const idGenerationOriginRule = defineRule({
  name: "id-generation-origin",
  kind: "problem",
  applies: (file) => file.isProduction && isFeatureOrProcessSource(file),
  messages: {
    foreignIdModule: {
      what: "`{{name}}` mints ids outside the house scheme.",
      why: "A second id scheme neither sorts by time nor names its kind, and two schemes in one table are a migration.",
      fix: 'Import `generate` from `@langwatch/ksuid` and mint it with its kind: `generate("{{kindPrefix}}").toString()`.',
    },
    randomUuid: {
      what: "`randomUUID()` mints an id outside the house scheme.",
      why: "A UUID neither sorts by time nor names its kind, and two schemes in one table are a migration.",
      fix: 'Import `generate` from `@langwatch/ksuid` and mint it with its kind: `generate("{{kindPrefix}}").toString()`.',
    },
  },
  create(context, file) {
    const kindPrefix = likelyKindPrefix(file) ?? "<kind>";

    return {
      ImportDeclaration(node) {
        if (!FOREIGN_ID_MODULES.has(node.source.value)) return;

        context.report({
          node: node.source,
          messageId: "foreignIdModule",
          data: { kindPrefix, name: node.source.value },
        });
      },
      CallExpression(node) {
        if (calleeName(node.callee) !== "randomUUID") return;
        if (withinAnIdempotencyKey(node)) return;

        context.report({ node: node.callee, messageId: "randomUuid", data: { kindPrefix } });
      },
    };
  },
});
