import { defineRule } from "../define-rule.mjs";
import { isClickHouseRepository } from "./clickhouse-query-text.mjs";
import baseline from "./no-raw-clickhouse-sql.baseline.json" with { type: "json" };

// ADR-202 §3: a module's process half hands ClickHouse built statements, never SQL text.
// Unported sites sit in a generated, shrink-only baseline. Goose migrations and
// packages/clickhouse-migrations are not module code, so this rule never sees them.

const SINK_METHODS = new Set(["query", "command", "exec"]);
const FORWARDING_METHODS = new Set(["query", "command"]);
const REQUEST_SQL_KEYS = new Set(["sql", "query"]);
const SKIP_MARKERS = new Set(["SKIP_TENANT_CHECK", "SKIP_COLD_SCAN_CHECK"]);
const MARKER_PACKAGE = "@langwatch/clickhouse-markers";
const VENDOR_CLIENTS = new Set(["@clickhouse/client", "@clickhouse/client-web"]);
const BASELINE_COMMAND = "pnpm --filter @langwatch/oxlint-rules baseline:no-raw-clickhouse-sql";
const BUILD_FIX =
  "Build it with `clickhouseRead` from `@langwatch/clickhouse-client/builder` under a `tenantScope`, and send it with `client.read({ statement })`.";

/** Files that send SQL text by design; each reason says why the builder cannot express it. */
export const EXEMPT_FILES = new Map([
  [
    "modules/analytics/process/src/repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts",
    "LangWatchQL user SQL, sent by its own client as the LangWatchQL user under its own tenant setting (ADR-200).",
  ],
  [
    "modules/analytics/process/src/repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts",
    "LangWatchQL provisioning DDL and key-map reads on the admin identity, worker and tasks app only (ADR-159).",
  ],
]);

/** Files whose writes (`command`, `kind: "write"`) are system-identity mutations; reads count. */
export const MUTATION_FILES = new Map([
  [
    "enterprise/modules/governance/process/src/repositories/clickhouse/clickhouse.rollup-erasure.repository.ts",
    "Rollup erasure: ALTER ... DELETE and UPDATE over one project's rows on the system identity.",
  ],
  [
    "modules/data-retention/process/src/repositories/clickhouse/clickhouse.retroactive-retention.repository.ts",
    "Retention: ALTER ... UPDATE, MODIFY and KILL MUTATION on the system identity (ADR-202 Decided 13).",
  ],
  [
    "modules/trace/process/src/repositories/clickhouse/clickhouse.trace-index-materialisation.repository.ts",
    "Id-index materialisation: ALTER ... MATERIALIZE INDEX on the system identity.",
  ],
]);

/** Remaining raw sites per file; written by the baseline command, never by hand. */
const LISTED = baseline.findings;

/** Production source in a module's process half, other than a file exempt by design. */
function isModuleProcessSource(file) {
  return (
    file.role === "process" &&
    file.isProduction &&
    Boolean(file.sourcePath) &&
    !EXEMPT_FILES.has(file.workspacePath)
  );
}

function keyName(property) {
  if (property.type !== "Property" || property.computed) return void 0;
  if (property.key.type === "Identifier") return property.key.name;

  return typeof property.key.value === "string" ? property.key.value : void 0;
}

function sinkMethodOf(call) {
  const callee = call.callee;
  if (callee?.type !== "MemberExpression") return void 0;
  const name = callee.computed ? callee.property.value : callee.property.name;

  return SINK_METHODS.has(name) ? name : void 0;
}

/** `report` every site, `stale` when the file holds fewer than listed, `pass` otherwise. */
export function baselineVerdict({ found, listed }) {
  if (found > listed) return "report";

  return found < listed ? "stale" : "pass";
}

function hasKey(object, name) {
  return object?.type === "ObjectExpression" && object.properties.some((p) => keyName(p) === name);
}

function isWriteRequest(method, request) {
  if (method === "command") return true;

  return request.properties.some(
    (property) => keyName(property) === "kind" && property.value?.value === "write",
  );
}

function isValueImport(node) {
  if (node.importKind === "type" || node.exportKind === "type") return false;
  const specifiers = node.specifiers ?? [];

  return specifiers.length === 0 || specifiers.some((specifier) => specifier.importKind !== "type");
}

function note(state, site) {
  state.found.push({ data: {}, ...site });
}

function requestKeyOf(request) {
  if (request?.type !== "ObjectExpression") return void 0;

  return request.properties.map(keyName).find((name) => REQUEST_SQL_KEYS.has(name));
}

function visitCall(state, node) {
  const method = sinkMethodOf(node);
  if (!method) return;
  const request = node.arguments[0];
  const key = requestKeyOf(request);
  if (!key) {
    if (state.inRepository && FORWARDING_METHODS.has(method))
      note(state, { node: node, messageId: "forwardedRequest", data: { method } });
    return;
  }
  state.requests.add(request);
  if (state.mutationsPass && isWriteRequest(method, request)) state.passed.add(request);
  else note(state, { node: node, messageId: "rawRequest", data: { method, key } });
}

function visitProperty(state, node) {
  const owner = node.parent;
  if (!state.inRepository || owner?.type !== "ObjectExpression" || state.passed.has(owner)) return;
  const name = keyName(node);
  if (name === "sql" && !state.requests.has(owner))
    note(state, { node: node, messageId: "sqlProperty" });
  if (SKIP_MARKERS.has(name) && !hasKey(owner, "rows"))
    note(state, { node: node, messageId: "skipMarker", data: { name } });
}

function visitImport(state, node) {
  const source = node.source?.value;
  if (source === MARKER_PACKAGE) note(state, { node: node, messageId: "fenceMarker" });
  if (VENDOR_CLIENTS.has(source) && isValueImport(node))
    note(state, { node: node, messageId: "vendorClient", data: { source } });
}

/** Reports the file's sites only past its listed count, and a stale listing once. */
function settle(state, { program, listed }) {
  const found = state.found.length;
  const verdict = baselineVerdict({ found, listed });
  if (verdict === "report") for (const site of state.found) state.context.report(site);
  if (verdict !== "stale") return;
  state.context.report({
    node: program,
    messageId: "baselineStale",
    data: { file: state.file.workspacePath, found, listed },
  });
}

export const noRawClickhouseSqlRule = defineRule({
  name: "no-raw-clickhouse-sql",
  kind: "problem",
  applies: isModuleProcessSource,
  options: {
    baseline: {
      type: "boolean",
      default: true,
      description: "Honour the shrink-only baseline; the baseline command turns it off to count.",
    },
  },
  messages: {
    rawRequest: {
      what: "`.{{method}}({ {{key}} })` hands ClickHouse a hand-written statement.",
      why: "Hand-written SQL can drop its tenant predicate; a built read renders it from its scope.",
      fix: BUILD_FIX,
    },
    forwardedRequest: {
      what: "`.{{method}}(...)` sends ClickHouse a request this repository did not build.",
      why: "Hand-written SQL can drop its tenant predicate; a built read renders it from its scope.",
      fix: BUILD_FIX,
    },
    sqlProperty: {
      what: "This object spells a ClickHouse statement as text under `sql`.",
      why: "Hand-written SQL can drop its tenant predicate; a built read renders it from its scope.",
      fix: BUILD_FIX,
    },
    skipMarker: {
      what: "`{{name}}` opts a hand-written ClickHouse request out of a check the builder makes by construction.",
      why: "A built read states all-tenant or full-scan intent in its scope, not in a request flag.",
      fix: "Use `tenantScope.allTenants({ reason })` on a built read for `SKIP_TENANT_CHECK`, or `client.read({ statement, declaresFullScan: true })` for `SKIP_COLD_SCAN_CHECK`.",
    },
    fenceMarker: {
      what: "This file imports `@langwatch/clickhouse-markers`, the fence markers that only work inside hand-written SQL.",
      why: "The builder renders the fence's scope, windows and latest-version reads itself.",
      fix: "Use `tenantScope.fromProof(...)` and the read's `.withinWindows()`, `.latestVersion()` or `.braided()` instead of the markers.",
    },
    vendorClient: {
      what: "This file imports `{{source}}`, the vendor ClickHouse client.",
      why: "The vendor client skips the house client's tenant routing and the tenant setting the row policies read.",
      fix: "Send built statements through the module store's `ClickHouseQueryClient` with `client.read({ statement })`.",
    },
    baselineStale: {
      what: "`{{file}}` holds {{found}} raw ClickHouse sites but the baseline lists {{listed}}.",
      why: "The baseline only shrinks, so a removed site lowers it in the same change.",
      fix: `Run \`${BASELINE_COMMAND}\` and commit the lowered baseline.`,
    },
  },
  create(context, file, options) {
    const state = {
      context,
      file,
      found: [],
      inRepository: isClickHouseRepository(file),
      mutationsPass: MUTATION_FILES.has(file.workspacePath),
      passed: new WeakSet(),
      requests: new WeakSet(),
    };
    const listed = options.baseline ? (LISTED[file.workspacePath] ?? 0) : 0;
    const onImport = (node) => visitImport(state, node);

    return {
      CallExpression: (node) => visitCall(state, node),
      Property: (node) => visitProperty(state, node),
      ImportDeclaration: onImport,
      ExportNamedDeclaration: onImport,
      ExportAllDeclaration: onImport,
      "Program:exit": (program) => settle(state, { program, listed }),
    };
  },
});
