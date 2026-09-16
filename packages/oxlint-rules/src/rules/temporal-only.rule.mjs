import { defineRule } from "../define-rule.mjs";

// One clock. `Date` survives only where a boundary refuses anything else: a
// persistence seam, and the two named helpers in @langwatch/time that convert
// for an SDK. Everywhere else a moment is a `Temporal.Instant`.

const GOVERNED =
  /^(?:apps\/[^/]+\/src\/|packages\/[^/]+\/|modules\/[^/]+\/[^/]+\/|enterprise\/|sdks\/typescript\/src\/|mcp\/typescript\/src\/)/;
const TIME_PACKAGE = /^packages\/time\//;
// The seams where a driver binds a real `Date` and will not take an `Instant`.
//
// `adapters/postgres.` is the flat spelling (`adapters/postgres.foo.adapter.ts`)
// and `adapters/postgres/` the directory one -- the second was missing, which
// is why packages/eventing's own Prisma store was being asked to hold an
// `Instant` for a column Prisma binds as a `Date`.
//
// ClickHouse is here for exactly the reason Prisma is, and was simply never
// added: the client binds a `Date` for a `DateTime64` parameter. The
// repositories under it already convert at the write boundary -- scenario's
// simulation-run store maps its own date columns to `Date | null` through a
// `WithDateWrites` type and imports `toDate` to fill them -- so the rule was
// reporting, 81 times, the one shape those files are required to have.
const PERSISTENCE_SEAM =
  /(?:^|\/)(?:repositories\/(?:prisma|clickhouse)\/|adapters\/postgres[./])/;
const DECLARATION = /\.d\.[cm]?ts$/;
const BOUNDARY_HELPER = new Set(["fromDate", "toDate"]);
const FUNCTION_NODE = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
]);

/** Every file the one-clock rule governs: product source, outside the seams. */
function isTemporalOnlySource(file) {
  const path = file.workspacePath;
  if (!GOVERNED.test(path)) return false;
  if (TIME_PACKAGE.test(path)) return false;
  if (PERSISTENCE_SEAM.test(path)) return false;
  if (DECLARATION.test(path)) return false;

  return file.isProduction;
}

function enclosingFunctionName(node) {
  if (node.type === "FunctionDeclaration" || node.type === "TSDeclareFunction") {
    return node.id?.name;
  }
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator") return parent.id?.name;
  if (parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") {
    return parent.key?.name;
  }
  if (parent?.type === "Property") return parent.key?.name;

  return undefined;
}

/** True inside `fromDate` or `toDate`: the two conversions that own a Date. */
function insideBoundaryHelper(node) {
  let current = node.parent;
  while (current) {
    if (FUNCTION_NODE.has(current.type)) {
      const name = enclosingFunctionName(current);
      if (name && BOUNDARY_HELPER.has(name)) return true;
    }
    current = current.parent;
  }

  return false;
}

/** What the reader sees beside the annotation, so the message names it. */
function annotatedName(node) {
  let current = node.parent;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current.type === "Identifier" && current.name) return current.name;
    if (current.key?.type === "Identifier") return current.key.name;
    if (current.id?.type === "Identifier") return current.id.name;
    current = current.parent;
  }

  return "This value";
}

export const temporalOnlyRule = defineRule({
  name: "temporal-only",
  kind: "problem",
  applies: isTemporalOnlySource,
  messages: {
    mintNow: {
      what: "{{name}} mints a Date for the current moment.",
      why: "One clock: every moment in the product is a Temporal.Instant.",
      fix: "Call `nowInstant()` from @langwatch/time.",
    },
    mintNowMilliseconds: {
      what: "{{name}} reads the current moment as Date epoch milliseconds.",
      fix: "Call `nowInstant().epochMilliseconds` from @langwatch/time.",
    },
    constructInstant: {
      what: "{{name}} builds a Date out of a value.",
      fix: "Use `Temporal.Instant.from(iso)` for an ISO string, `Temporal.Instant.fromEpochMilliseconds(ms)` for a millisecond count, or `fromDate(date)` from @langwatch/time when a boundary handed you a Date.",
    },
    parseInstant: {
      what: "{{name}} parses a moment through Date.",
      fix: "Use `Temporal.Instant.from(iso).epochMilliseconds` from @langwatch/time.",
    },
    utcInstant: {
      what: "{{name}} builds an epoch count out of calendar parts through Date.",
      fix: 'Build the moment with `Temporal.PlainDateTime.from({ year, month, day }).toZonedDateTime("UTC").epochMilliseconds` from @langwatch/time.',
    },
    dateType: {
      what: "{{name}} is typed `Date`.",
      why: "A Date on a declared type invites one to be minted to satisfy it.",
      fix: "Declare it `Temporal.Instant` from @langwatch/time, or `string` when the value only ever comes off the wire, and convert with `toDate()` at the Prisma or SDK boundary.",
    },
  },
  create(context, _file) {
    return {
      NewExpression(node) {
        if (node.callee?.type !== "Identifier" || node.callee.name !== "Date") return;
        if (insideBoundaryHelper(node)) return;
        const empty = (node.arguments?.length ?? 0) === 0;
        context.report({
          node,
          messageId: empty ? "mintNow" : "constructInstant",
          data: { name: empty ? "`new Date()`" : "`new Date(…)`" },
        });
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression" || callee.computed) return;
        if (callee.object?.type !== "Identifier" || callee.object.name !== "Date") return;
        const member = callee.property?.name;
        const messageId =
          member === "now"
            ? "mintNowMilliseconds"
            : member === "parse"
              ? "parseInstant"
              : member === "UTC"
                ? "utcInstant"
                : undefined;
        if (!messageId) return;
        if (insideBoundaryHelper(node)) return;
        context.report({ node, messageId, data: { name: `\`Date.${member}()\`` } });
      },
      TSTypeReference(node) {
        if (node.typeName?.type !== "Identifier" || node.typeName.name !== "Date") return;
        if (insideBoundaryHelper(node)) return;
        context.report({ node, messageId: "dateType", data: { name: annotatedName(node) } });
      },
    };
  },
});
