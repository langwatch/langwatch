import { defineRule } from "../define-rule.mjs";

// One clock. `Date` survives only where a boundary refuses anything else: a
// persistence seam, and the two named helpers in @langwatch/time that convert
// for an SDK. Everywhere else a moment is a `Temporal.Instant`.

const GOVERNED = /^(?:apps\/[^/]+\/src\/|packages\/[^/]+\/|modules\/[^/]+\/[^/]+\/|enterprise\/)/;
const TIME_PACKAGE = /^packages\/time\//;

// The published SDK, MCP server and ksuid cannot resolve the private
// @langwatch/time the fix names, so they are out of scope; their wire contract
// stays ISO 8601 (specs/tooling/lint-temporal-only.feature).
const PUBLISHED_ARTEFACT = /^(?:sdks\/typescript\/|mcp\/typescript\/|packages\/ksuid\/)/;
// The seams where a driver binds a real `Date` and will not take an `Instant`.
// Eventing's Prisma stores predate `repositories/prisma/`; the path goes when they move.
const PERSISTENCE_SEAM =
  /(?:^|\/)repositories\/(?:prisma|clickhouse)\/|^packages\/eventing\/src\/server\/adapters\/postgres\//;
const DECLARATION = /\.d\.[cm]?ts$/;
const BOUNDARY_HELPER = new Set(["fromDate", "toDate"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "global", "self"]);
const DATE_STATIC_MESSAGE = {
  now: "mintNowMilliseconds",
  parse: "parseInstant",
  UTC: "utcInstant",
};
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
  if (PUBLISHED_ARTEFACT.test(path)) return false;
  if (TIME_PACKAGE.test(path)) return false;
  if (PERSISTENCE_SEAM.test(path)) return false;
  if (DECLARATION.test(path)) return false;

  return file.isProduction;
}

/** `Date`, or `globalThis.Date` and its `window`/`global`/`self` spellings. */
function isDateReference(node) {
  if (node?.type === "Identifier") return node.name === "Date";
  if (node?.type !== "MemberExpression" || node.computed) return false;

  return (
    node.object.type === "Identifier" &&
    GLOBAL_OBJECTS.has(node.object.name) &&
    node.property.name === "Date"
  );
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

function constructionFinding(node) {
  if (!isDateReference(node.callee)) return undefined;
  if ((node.arguments?.length ?? 0) === 0)
    return { messageId: "mintNow", data: { name: "`new Date()`" } };

  return { messageId: "constructInstant", data: { name: "`new Date(…)`" } };
}

function staticCallFinding(node) {
  const { callee } = node;
  if (callee?.type !== "MemberExpression" || callee.computed) return undefined;
  const member = callee.property?.name;
  if (!isDateReference(callee.object) || !Object.hasOwn(DATE_STATIC_MESSAGE, member))
    return undefined;

  return { messageId: DATE_STATIC_MESSAGE[member], data: { name: `\`Date.${member}()\`` } };
}

function dateTypeFinding(node) {
  if (node.typeName?.type !== "Identifier" || node.typeName.name !== "Date") return undefined;

  return { messageId: "dateType", data: { name: annotatedName(node) } };
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
    const report = (node, finding) => {
      if (finding && !insideBoundaryHelper(node)) context.report({ node, ...finding });
    };

    return {
      NewExpression: (node) => report(node, constructionFinding(node)),
      CallExpression: (node) => report(node, staticCallFinding(node)),
      TSTypeReference: (node) => report(node, dateTypeFinding(node)),
    };
  },
});
