#!/usr/bin/env tsx
/**
 * OpenAPI completeness gate for the two public REST surfaces,
 * `/api/gateway/v1` and `/api/webhooks/v1`.
 *
 * The generated document at `src/app/api/openapiLangWatch.json` is what an
 * external integrator reads and what client generators compile. A route whose
 * `describeRoute({...})` leaves out its body, its parameters, or its success
 * response still appears in the document, so the omission is invisible: the
 * endpoint looks documented and generates a client that cannot call it. This
 * check makes each omission a build failure instead.
 *
 * Three rules, applied to every operation under the gated prefixes:
 *
 *   1. `request-body`     a body-accepting write (POST/PATCH/PUT) declares a
 *                         `requestBody`.
 *   2. `query-parameters` an operation whose handler reads the query string
 *                         declares at least one `in: "query"` parameter.
 *   3. `response-schema`  the operation declares at least one 2xx response
 *                         carrying a `content.<media>.schema`.
 *
 * Rules 1 and 3 read only the document. Rule 2 cannot: nothing in an OpenAPI
 * operation records that a handler reads a query it forgot to declare, and
 * that omission is precisely the drift worth catching. So rule 2 cross-checks
 * the handler sources, as follows.
 *
 *   - Every `.ts` file under the handler roots is read, and the ones declaring
 *     a `basePath` equal to a gated prefix are kept. A kept file may declare
 *     only one such prefix; two would make its route paths ambiguous and the
 *     check fails rather than guessing.
 *   - `./lib/hono-route-table` finds the route registrations in a kept file and
 *     says which of them read the query string; see that module for what counts
 *     as either. `check-openapi-route-coverage.ts` reads the same table for a
 *     different question, which is why the parsing lives there and not here.
 *   - The Hono path is joined to the basePath and `:param` is rewritten to
 *     `{param}` to match the document's path templates.
 *
 * A handler that reads a query but has no operation in the document at all is
 * reported under the same rule: the document is stale, and skipping the case
 * would let a whole undocumented endpoint through the one check that would
 * have noticed it.
 *
 * Both suppression lists below are data with a reason per entry, and both are
 * ratcheted: an entry that stops suppressing anything is itself a failure, so
 * the lists cannot outlive the reasons they were written for.
 *
 * Usage:
 *   pnpm check:openapi-completeness           # exit 1 on any gap
 *   pnpm check:openapi-completeness --json    # machine-readable report
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRouteRegistrations,
  discoverTypeScriptFiles,
  HTTP_METHODS,
  honoPathToTemplate,
  joinRoutePath,
} from "./lib/hono-route-table";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LANGWATCH_ROOT = resolve(__dirname, "..");

/** The generated document this gate reads. */
export const SPEC_PATH = join(
  LANGWATCH_ROOT,
  "src/app/api/openapiLangWatch.json",
);

/** The REST surfaces published to external integrators. */
export const GATED_PREFIXES = ["/api/gateway/v1", "/api/webhooks/v1"];

/** Trees that hold Hono route registrations for those surfaces. */
export const HANDLER_ROOTS = [
  join(LANGWATCH_ROOT, "src/app/api"),
  join(LANGWATCH_ROOT, "src/server/routes"),
  join(LANGWATCH_ROOT, "ee"),
];

const BODY_ACCEPTING_METHODS = new Set(["post", "patch", "put"]);

export type Rule = "request-body" | "query-parameters" | "response-schema";

export interface Suppression {
  /** `METHOD /path/with/{templates}`, exactly as the document spells it. */
  operation: string;
  rules: Rule[];
  why: string;
}

export interface Violation {
  operation: string;
  rule: Rule;
  detail: string;
}

/**
 * Operations that are complete WITHOUT the thing the rule asks for, because
 * the thing would be wrong to add. These are permanent, not debt.
 *
 * `disable` and `reset` are deliberately absent: both take a body today
 * (a disable reason, a reset's period boundary), so exempting them would be
 * stale on arrival and the ratchet below would reject it.
 */
export const EXEMPTIONS: Suppression[] = [
  {
    operation: "POST /api/gateway/v1/virtual-keys/{id}/rotate",
    rules: ["request-body"],
    why: "the key is named by the path and the replacement secret is minted server side, so there is nothing for the caller to send",
  },
  {
    operation: "POST /api/gateway/v1/virtual-keys/{id}/enable",
    rules: ["request-body"],
    why: "a state transition on the key named by the path; enable restores the key exactly as it was and takes no options",
  },
  {
    operation: "POST /api/gateway/v1/virtual-keys/{id}/revoke",
    rules: ["request-body"],
    why: "revocation is terminal and has no variants, so the path names everything the call needs",
  },
  {
    operation: "POST /api/webhooks/v1/endpoints/{id}/roll-secret",
    rules: ["request-body"],
    why: "the new signing secret is generated server side and the previous secret's 24h overlap is a server rule, not a caller choice",
  },
  {
    operation: "POST /api/webhooks/v1/endpoints/{id}/test",
    rules: ["request-body"],
    why: "a test fire delivers a synthetic envelope the server builds, so the caller supplies nothing beyond the endpoint id",
  },

  // The provider tombstones. Gateway provider bindings folded into
  // ModelProvider in iter 110; all four routes answer 410 Gone with
  // `gateway_provider_bindings_gone` and point callers at /api/model-providers.
  // Publishing the tombstone is the point, so a 2xx response on any of them
  // would document a capability that no longer exists.
  {
    operation: "GET /api/gateway/v1/providers",
    rules: ["response-schema"],
    why: "410 Gone tombstone for a capability removed in iter 110; it has no success case to describe",
  },
  {
    operation: "POST /api/gateway/v1/providers",
    rules: ["request-body", "response-schema"],
    why: "410 Gone tombstone; it accepts nothing and succeeds at nothing, and a request body would describe a binding format that no longer exists",
  },
  {
    operation: "PATCH /api/gateway/v1/providers/{id}",
    rules: ["request-body", "response-schema"],
    why: "410 Gone tombstone; same reasoning as the POST",
  },
  {
    operation: "DELETE /api/gateway/v1/providers/{id}",
    rules: ["response-schema"],
    why: "410 Gone tombstone; it has no success case to describe",
  },
];

/**
 * Gaps that are real. Every entry here is an endpoint an integrator cannot
 * generate a client for, listed so the gate can go green on the surfaces that
 * ARE complete while naming exactly what is not.
 *
 * This list only shrinks. Fixing an entry means adding the missing piece to
 * the route's `describeRoute({...})`, regenerating the document with
 * `pnpm run task generateOpenAPISpec`, and deleting the line: the ratchet
 * fails on an entry that no longer suppresses anything, so a fix cannot land
 * while leaving its excuse behind.
 */
export const KNOWN_GAPS: Suppression[] = [];

interface OpenApiOperation {
  requestBody?: unknown;
  parameters?: { in?: string; name?: string }[];
  responses?: Record<
    string,
    { content?: Record<string, { schema?: unknown }> } | undefined
  >;
}

interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation | undefined>>;
}

export function isGatedPath(path: string): boolean {
  return GATED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * The operations whose handlers read the query string, as
 * `METHOD /path/{template}` keys. See the rule 2 note in the module docstring
 * for what counts as a registration and what counts as a read.
 */
export function collectQueryReadingOperations(roots: string[]): Set<string> {
  const found = new Set<string>();

  for (const file of discoverTypeScriptFiles(roots)) {
    const source = readFileSync(file, "utf8");
    const basePath = gatedBasePathOf(source, file);
    if (basePath === null) continue;

    for (const registration of collectRouteRegistrations(source)) {
      if (!registration.readsQuery) continue;
      const path = honoPathToTemplate(
        joinRoutePath({ basePath, routePath: registration.path }),
      );
      found.add(`${registration.method.toUpperCase()} ${path}`);
    }
  }

  return found;
}

/**
 * The gated basePath a source file declares, or null when it declares none.
 * Two different gated basePaths in one file would make its route paths
 * ambiguous, so that throws rather than picking one.
 */
export function gatedBasePathOf(source: string, file: string): string | null {
  const declared = new Set<string>();
  for (const match of source.matchAll(/basePath:\s*"([^"]+)"/g)) {
    const value = match[1];
    if (value !== undefined && GATED_PREFIXES.includes(value)) {
      declared.add(value);
    }
  }
  if (declared.size === 0) return null;
  if (declared.size > 1) {
    throw new Error(
      `${file} declares more than one gated basePath (${[...declared].join(", ")}); route paths in it cannot be resolved unambiguously`,
    );
  }
  return [...declared][0] ?? null;
}

function hasTwoHundredSchema(operation: OpenApiOperation): boolean {
  return Object.entries(operation.responses ?? {}).some(
    ([status, response]) =>
      /^2\d\d$/.test(status) &&
      Object.values(response?.content ?? {}).some(
        (media) => media?.schema !== undefined,
      ),
  );
}

function declaredResponseCodes(operation: OpenApiOperation): string {
  const codes = Object.keys(operation.responses ?? {});
  return codes.length === 0 ? "none at all" : codes.join(", ");
}

function auditOperation(subject: {
  key: string;
  method: (typeof HTTP_METHODS)[number];
  operation: OpenApiOperation;
  readsQuery: boolean;
}): Violation[] {
  const { key, method, operation, readsQuery } = subject;
  const violations: Violation[] = [];

  if (BODY_ACCEPTING_METHODS.has(method) && !operation.requestBody) {
    violations.push({
      operation: key,
      rule: "request-body",
      detail: `${method.toUpperCase()} accepts a body but the operation declares no requestBody`,
    });
  }

  const declaresQuery = (operation.parameters ?? []).some(
    (parameter) => parameter.in === "query",
  );
  if (readsQuery && !declaresQuery) {
    violations.push({
      operation: key,
      rule: "query-parameters",
      detail:
        "the handler reads the query string but the operation declares no query parameters",
    });
  }

  if (!hasTwoHundredSchema(operation)) {
    violations.push({
      operation: key,
      rule: "response-schema",
      detail: `no 2xx response carries a schema (declared responses: ${declaredResponseCodes(operation)})`,
    });
  }

  return violations;
}

/** Every `METHOD /path` the document describes under the gated prefixes. */
function gatedOperationsOf(document: OpenApiDocument): {
  key: string;
  method: (typeof HTTP_METHODS)[number];
  operation: OpenApiOperation;
}[] {
  return Object.entries(document.paths ?? {})
    .filter(([path]) => isGatedPath(path))
    .flatMap(([path, item]) =>
      HTTP_METHODS.filter((method) => item[method] !== undefined).map(
        (method) => ({
          key: `${method.toUpperCase()} ${path}`,
          method,
          operation: item[method] as OpenApiOperation,
        }),
      ),
    );
}

/**
 * Every gap in the document, before suppression. `queryReadingOperations` is
 * the rule 2 input, kept as a parameter so the audit itself stays pure.
 */
export function auditSpec(
  document: OpenApiDocument,
  queryReadingOperations: Set<string>,
): Violation[] {
  const described = gatedOperationsOf(document);
  const documented = new Set(described.map(({ key }) => key));

  const violations = described.flatMap((subject) =>
    auditOperation({
      ...subject,
      readsQuery: queryReadingOperations.has(subject.key),
    }),
  );

  for (const key of queryReadingOperations) {
    if (documented.has(key)) continue;
    violations.push({
      operation: key,
      rule: "query-parameters",
      detail:
        "the handler reads the query string and the document has no operation for this route at all; regenerate with `pnpm run task generateOpenAPISpec`",
    });
  }

  return violations.sort((a, b) =>
    `${a.operation} ${a.rule}`.localeCompare(`${b.operation} ${b.rule}`),
  );
}

export interface SuppressionResult {
  reported: Violation[];
  stale: { list: string; operation: string; rule: Rule; why: string }[];
}

type NamedList = readonly [name: string, entries: Suppression[]];

/** Every (operation, rule) either list excuses, flattened for lookup. */
function flattenSuppressions(
  lists: NamedList[],
): { key: string; list: string; operation: string; rule: Rule; why: string }[] {
  return lists.flatMap(([list, entries]) =>
    entries.flatMap((entry) =>
      entry.rules.map((rule) => ({
        key: `${entry.operation} ${rule}`,
        list,
        operation: entry.operation,
        rule,
        why: entry.why,
      })),
    ),
  );
}

/**
 * Applies both suppression lists and reports which entries did nothing. An
 * entry that suppresses nothing is either fixed or wrong, and either way it
 * has to leave, so it comes back as `stale` for the caller to fail on.
 */
export function applySuppressions(
  violations: Violation[],
  lists: { exemptions: Suppression[]; knownGaps: Suppression[] },
): SuppressionResult {
  const entries = flattenSuppressions([
    ["EXEMPTIONS", lists.exemptions],
    ["KNOWN_GAPS", lists.knownGaps],
  ]);
  const excused = new Set(entries.map(({ key }) => key));

  const used = new Set<string>();
  const reported = violations.filter((violation) => {
    const key = `${violation.operation} ${violation.rule}`;
    if (!excused.has(key)) return true;
    used.add(key);
    return false;
  });

  const stale = entries
    .filter(({ key }) => !used.has(key))
    .map(({ list, operation, rule, why }) => ({ list, operation, rule, why }));

  return { reported, stale };
}

function formatViolations(reported: Violation[]): string[] {
  if (reported.length === 0) return [];

  const lines = [
    `${reported.length} incomplete operation${reported.length === 1 ? "" : "s"} under ${GATED_PREFIXES.join(", ")}:`,
    "",
  ];

  let current = "";
  for (const violation of reported) {
    if (violation.operation !== current) {
      current = violation.operation;
      lines.push(`  ${current}`);
    }
    lines.push(`    [${violation.rule}] ${violation.detail}`);
  }

  lines.push(
    "",
    "Fix each by completing the route's describeRoute({...}), then regenerate",
    "the document: pnpm run task generateOpenAPISpec",
  );
  return lines;
}

function formatStale(stale: SuppressionResult["stale"]): string[] {
  if (stale.length === 0) return [];

  const lines = [
    stale.length === 1
      ? "1 suppression entry no longer suppresses anything and must be deleted:"
      : `${stale.length} suppression entries no longer suppress anything and must be deleted:`,
    "",
  ];

  for (const entry of stale) {
    lines.push(`  ${entry.list}: ${entry.operation} [${entry.rule}]`);
    lines.push(`    was excused because: ${entry.why}`);
  }
  return lines;
}

export function formatReport(result: SuppressionResult): string {
  return [formatViolations(result.reported), formatStale(result.stale)]
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
}

function main(): void {
  const asJson = process.argv.includes("--json");

  const document = JSON.parse(
    readFileSync(SPEC_PATH, "utf8"),
  ) as OpenApiDocument;

  const gatedOperations = Object.entries(document.paths ?? {})
    .filter(([path]) => isGatedPath(path))
    .flatMap(([, item]) => HTTP_METHODS.filter((m) => item[m] !== undefined));

  const result = applySuppressions(
    auditSpec(document, collectQueryReadingOperations(HANDLER_ROOTS)),
    { exemptions: EXEMPTIONS, knownGaps: KNOWN_GAPS },
  );

  const failed = result.reported.length > 0 || result.stale.length > 0;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          operations: gatedOperations.length,
          violations: result.reported,
          staleSuppressions: result.stale,
          ok: !failed,
        },
        null,
        2,
      ),
    );
    process.exit(failed ? 1 : 0);
  }

  console.log(
    `openapi completeness: ${gatedOperations.length} operations under ${GATED_PREFIXES.join(", ")}`,
  );
  console.log(
    `suppressed: ${EXEMPTIONS.length} exemptions, ${KNOWN_GAPS.length} known gaps`,
  );
  console.log("");

  if (!failed) {
    console.log("OK: every unsuppressed operation is completely described.");
    return;
  }

  console.error(formatReport(result));
  process.exit(1);
}

/**
 * Is this module the one node was asked to run?
 *
 * Comparing `process.argv[1]` to this file lexically is fail-open: invoked
 * through a symlink (a `node_modules/.bin` shim, a pnpm store link, a
 * symlinked worktree) the paths differ, `main()` never runs, and the process
 * exits 0 having checked nothing. Both sides resolve through `realpathSync`
 * first, and a path that does not exist falls back to its lexical resolution
 * so the case stays a mismatch instead of a crash.
 */
export function isEntryModule({
  invokedPath,
  modulePath,
}: {
  invokedPath: string | undefined;
  modulePath: string;
}): boolean {
  if (invokedPath === undefined) return false;
  return realPathOrResolved(invokedPath) === realPathOrResolved(modulePath);
}

function realPathOrResolved(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

// Run only when invoked as a script, so the collectors above can be imported
// and exercised by unit tests without the repo scan and its `process.exit(1)`
// running on import.
if (isEntryModule({ invokedPath: process.argv[1], modulePath: __filename })) {
  main();
}
