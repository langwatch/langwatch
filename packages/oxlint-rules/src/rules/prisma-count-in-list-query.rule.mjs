import { defineRule } from "../define-rule.mjs";

// Documented production incident: Prisma builds `_count` as an uncorrelated
// join over the whole related table, re-run once per listed row (2.3s/call
// on a 192k-row table). Fix: a second `groupBy` count restricted to the
// listed row ids (CLAUDE.md's Database table). Gated on the Prisma seam so
// an unrelated `_count` key elsewhere in the tree never fires this.

function isPrismaSeamFile(file) {
  return file.isPrismaSeam;
}

/** The static name of a non-computed object key, or null if it isn't statically known. */
function staticKeyName(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
}

/** Whether the walk has passed through an `include` or `select` key on its way here. */
function passesThroughIncludeOrSelect(path) {
  return path.includes("include") || path.includes("select");
}

/**
 * Walks a query's option object for `_count` reached through `include` or
 * `select` at any depth. `orderBy: { relation: { _count: "desc" } }` passes
 * through neither, so relation-count ordering needs no separate check.
 */
function findCountUnderIncludeOrSelect(objectExpression, path, report) {
  for (const property of objectExpression.properties) {
    if (property.type !== "Property") continue;
    const name = staticKeyName(property);
    if (name == null) continue;

    if (name === "_count" && passesThroughIncludeOrSelect(path)) report(property);

    if (property.value?.type === "ObjectExpression") {
      findCountUnderIncludeOrSelect(property.value, [...path, name], report);
    }
  }
}

export const prismaCountInListQueryRule = defineRule({
  name: "prisma-count-in-list-query",
  kind: "problem",
  applies: isPrismaSeamFile,
  messages: {
    countInsideFindMany: {
      what: "`_count` rides this `findMany`, and the planner can re-run its aggregate once per listed row.",
      why: "Prisma builds `_count` as an uncorrelated join over the whole related table.",
      fix: "Drop `_count` from the query and run a second `groupBy` count restricted to the listed row ids.",
    },
  },
  create(context, _file) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression" || callee.computed) return;
        if (callee.property?.type !== "Identifier" || callee.property.name !== "findMany") return;

        const [firstArgument] = node.arguments;
        if (firstArgument?.type !== "ObjectExpression") return;

        findCountUnderIncludeOrSelect(firstArgument, [], (property) => {
          context.report({ node: property, messageId: "countInsideFindMany" });
        });
      },
    };
  },
});
