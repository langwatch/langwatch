#!/usr/bin/env tsx
/**
 * Route-coverage gate for the whole `/api` surface.
 *
 * `check-openapi-completeness.ts` asks whether a documented operation is
 * described well enough to generate a client from. This asks the question
 * before it: does the operation reach the document at all?
 *
 * That gap is invisible from either side on its own. The route works, the SDKs
 * call it, and the API reference simply has no page for it — which reads to an
 * integrator as "the REST API cannot do this". It is how `POST
 * /api/experiment/init`, the call every SDK makes to create an experiment,
 * stayed unpublished long enough for a customer to conclude experiments were
 * SDK-only.
 *
 * Three things have to line up for a route to be published, and missing any one
 * of them produces the same silence:
 *
 *   1. the handler carries `describeRoute({...})` — `generateSpecs` skips a
 *      handler that has none, so the annotation is the precondition, not a
 *      nicety
 *   2. the route's Hono app is imported by `src/tasks/generateOpenAPISpec.ts`
 *   3. its prefix is in that file's `APP_DERIVED_PREFIXES`, or the merge keeps
 *      whatever the JSON already said
 *
 * So the answer to "can we just generate the spec for everything?" is yes,
 * mechanically — annotate the handler and import its app — and the reason it
 * had not happened is that nothing made the omission visible. This gate does.
 *
 * Every registered route is either in the document or in `UNPUBLISHED` below
 * with a reason. The list is ratcheted: an entry matching nothing is itself a
 * failure, so it cannot outlive the routes it was written for.
 *
 * Usage:
 *   pnpm check:openapi-route-coverage           # exit 1 on an unexplained gap
 *   pnpm check:openapi-route-coverage --json    # machine-readable report
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  apiBasePathsOf,
  collectRouteRegistrations,
  discoverTypeScriptFiles,
  HTTP_METHODS,
  honoPathToTemplate,
  joinRoutePath,
} from "./lib/hono-route-table";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LANGWATCH_ROOT = resolve(__dirname, "..");

export const SPEC_PATH = join(
  LANGWATCH_ROOT,
  "src/app/api/openapiLangWatch.json",
);

/** Trees that hold Hono route registrations. */
export const HANDLER_ROOTS = [
  join(LANGWATCH_ROOT, "src/app/api"),
  join(LANGWATCH_ROOT, "src/server/routes"),
  join(LANGWATCH_ROOT, "ee"),
] as const;

/**
 * Why a route is absent from the published document. The category is not
 * decoration: `internal` and `alias` are permanent answers, `gap` is a debt
 * that should shrink, and keeping them apart is what stops the list from
 * quietly becoming a place to put anything inconvenient.
 */
export type AbsenceCategory =
  /** Not a customer-callable API. It must never appear in the reference. */
  | "internal"
  /** A retired or aliased path kept alive for older clients. */
  | "alias"
  /** A public endpoint that genuinely should be documented and is not yet. */
  | "gap";

export interface Exclusion {
  /**
   * `METHOD /path/{template}`, or a bare `/prefix` matching every operation
   * beneath it. A prefix keeps a whole internal surface to one reviewable
   * entry rather than fifteen copies of the same sentence.
   */
  match: string;
  category: AbsenceCategory;
  why: string;
}

/**
 * Every registered route that the published document deliberately omits.
 *
 * Adding an entry is a claim that a reader of the API reference is better off
 * without this route. For `gap` entries that claim is temporary, and the fix is
 * always the same three steps from the module docstring.
 */
export const UNPUBLISHED = [
  // ── Internal: the app talking to itself ────────────────────────────────
  {
    match: "/api/trpc",
    category: "internal",
    why: "the app's own tRPC transport; its contract is the TypeScript router, not an HTTP schema",
  },
  {
    match: "/api/sse",
    category: "internal",
    why: "server-sent event channels the dashboard subscribes to, with no stable per-message contract to publish",
  },
  {
    match: "/api/copilotkit",
    category: "internal",
    why: "AG-UI runtime endpoint owned by the CopilotKit client in our own frontend",
  },
  {
    match: "/api/playground",
    category: "internal",
    why: "backs the in-app model playground and takes whatever the playground UI currently sends",
  },
  {
    match: "/api/cron",
    category: "internal",
    why: "scheduler-triggered jobs, authenticated by the cron secret rather than a customer credential",
  },
  {
    match: "/api/internal",
    category: "internal",
    why: "control-plane calls from the gateway and langy workers, authenticated by an internal shared secret",
  },
  {
    match: "/api/admin",
    category: "internal",
    why: "LangWatch staff back-office, including impersonation; publishing it would advertise a surface no customer may call",
  },
  {
    match: "/api/ops",
    category: "internal",
    why: "operator debugging (ClickHouse EXPLAIN), reachable only with ops credentials",
  },
  {
    match: "/api/health",
    category: "internal",
    why: "liveness probes for the deployment, not a product capability",
  },
  {
    match: "/api/auth",
    category: "internal",
    why: "session, OAuth callback and CLI device-flow endpoints; the contract is the flows themselves (RFC 8628 for the CLI), and the browser and CLI are the only intended callers",
  },
  {
    match: "/api/mcp/authorize",
    category: "internal",
    why: "one step of the MCP OAuth flow, driven by the MCP client rather than called directly",
  },
  {
    match: "/api/webhooks/stripe",
    category: "internal",
    why: "inbound Stripe webhook; the schema is Stripe's and the signature check makes us the only valid caller",
  },
  {
    match: "/api/webhooks/auth0-scim",
    category: "internal",
    why: "inbound Auth0 provisioning webhook, addressed by Auth0 and no one else",
  },
  {
    match: "/api/github-langy",
    category: "internal",
    why: "GitHub App install callbacks and webhook, addressed by GitHub",
  },
  {
    match: "/api/track_usage",
    category: "internal",
    why: "anonymous self-hosted instance telemetry, posted by the instance itself",
  },
  {
    match: "/api/demo/hotel_bot",
    category: "internal",
    why: "scripted demo agent behind the sample project",
  },
  {
    match: "/api/image-proxy",
    category: "internal",
    why: "SSRF-guarded image fetch for rendering trace attachments in the dashboard",
  },
  {
    match: "/api/user-avatar",
    category: "internal",
    why: "avatar image bytes for the dashboard, not a data API",
  },
  {
    match: "/api/bug-reports",
    category: "internal",
    why: "in-app report form intake",
  },
  {
    match: "/api/unsubscribe",
    category: "internal",
    why: "RFC 8058 one-click unsubscribe, addressed by mail clients from a link we send",
  },
  {
    match: "/api/dataset/generate",
    category: "internal",
    why: "LLM-backed dataset generation for the dataset editor, streaming UI-shaped partial state",
  },
  {
    match: "/api/scenario/generate",
    category: "internal",
    why: "LLM-backed scenario drafting for the scenario editor, same UI-shaped streaming as dataset generation",
  },
  {
    match: "/api/workflows/code-completion",
    category: "internal",
    why: "editor autocomplete for the Optimization Studio code node",
  },
  {
    match: "/api/workflows/post_event",
    category: "internal",
    why: "the studio's own execution event channel, carrying workbench state rather than a public run contract",
  },
  {
    match: "/api/files",
    category: "internal",
    why: "signed-URL redirect for stored objects; callers reach files through the link the owning resource hands them",
  },
  {
    match: "/api/gateway/v1/openapi.json",
    category: "internal",
    why: "serves the gateway's own spec document, so it is the reference rather than an entry in it",
  },
  {
    match: "POST /api/experiments/execute",
    category: "internal",
    why: "browser-session authenticated and streams workbench UI state; an API-key caller cannot reach it, and POST /api/experiments/{slug}/run is the documented equivalent",
  },
  {
    match: "POST /api/experiments/abort",
    category: "internal",
    why: "the stop button next to execute, session authenticated for the same reason",
  },

  // ── Aliases: older paths kept working ──────────────────────────────────
  {
    match: "/api/evaluations/v3",
    category: "alias",
    why: "deprecated alias that rewrites onto /api/experiments/...; documenting it would publish the path we are moving clients off",
  },
  {
    match: "GET /api/thread/{id}",
    category: "alias",
    why: "superseded by the trace endpoints under /api/traces",
  },

  // ── Gaps: public endpoints that should be documented ───────────────────
  {
    match: "POST /api/collector",
    category: "gap",
    why: "the SDK trace ingestion endpoint. Its body is the full span payload, so publishing it means describing the span schema itself rather than annotating one handler",
  },
  {
    match: "/api/otel/v1",
    category: "gap",
    why: "OTLP/HTTP receivers. The contract is OpenTelemetry's protobuf, which an OpenAPI operation describes poorly; the integration docs point at the OTLP spec instead",
  },
  {
    match: "/api/ingest",
    category: "gap",
    why: "AI Governance source receivers, addressed with a per-source ingestion key. Documented today in the governance sources guide rather than the API reference",
  },
  {
    match: "POST /api/evaluations/{evaluator}/evaluate",
    category: "gap",
    why: "per-evaluator invocation. Every evaluator's own body and result are already generated into openapi-evals.json, so this needs those two documents joined rather than a new annotation",
  },
  {
    match: "POST /api/evaluations/{evaluator}/{subpath}/evaluate",
    category: "gap",
    why: "the two-segment evaluator ids (ragas/faithfulness), same reasoning as the single-segment form",
  },
  {
    match: "POST /api/guardrails/{evaluator}/evaluate",
    category: "gap",
    why: "the guardrail form of the evaluate call, same reasoning",
  },
  {
    match: "GET /api/evaluations/list",
    category: "gap",
    why: "lists the evaluators available to a project; belongs with the evaluator documents above",
  },
  {
    match: "POST /api/evaluations/batch/log_results",
    category: "gap",
    why: "how an SDK batch evaluation reports its rows back after POST /api/experiment/init; the payload is the batch result schema",
  },
  {
    match: "POST /api/dataset/evaluate",
    category: "gap",
    why: "runs an evaluator across a dataset; shares the evaluator body shape above",
  },
  {
    match: "POST /api/dspy/log_steps",
    category: "gap",
    why: "reports DSPy optimizer steps against an experiment; the payload is the DSPy step schema",
  },
  {
    match: "POST /api/track_event",
    category: "gap",
    why: "customer event tracking. /api/events/track is the documented successor and this is its predecessor, still called by older SDKs",
  },
  {
    match: "POST /api/analytics",
    category: "gap",
    why: "predecessor of the documented POST /api/analytics/timeseries, still accepted for older callers",
  },
  {
    match: "POST /api/trigger/slack",
    category: "gap",
    why: "creates a Slack alert trigger with a project key. The documented /api/triggers family supersedes it, and this narrower form is still accepted",
  },
  {
    match: "POST /api/workflows/{workflowId}/run",
    category: "gap",
    why: "runs an Optimization Studio workflow. The response is the workflow's own output shape, which varies per workflow and needs a documented envelope first",
  },
  {
    match: "POST /api/workflows/{workflowId}/{versionId}/run",
    category: "gap",
    why: "the pinned-version form of the workflow run, same reasoning",
  },
  {
    match: "POST /api/optimization/{workflowId}/{versionId}",
    category: "gap",
    why: "starts an optimization run over a workflow version, same envelope question as the workflow run",
  },
  {
    match: "POST /api/export/traces/download",
    category: "gap",
    why: "returns a file stream rather than JSON, so it needs a documented binary response",
  },
  {
    match: "POST /api/export/scenario-runs/download",
    category: "gap",
    why: "same file-stream response as the trace export",
  },
  {
    match: "/api/scim/v2",
    category: "gap",
    why: "SCIM 2.0 user and group provisioning for enterprise directories. The wire contract is RFC 7644 rather than ours, but enterprise buyers do look for it in the reference",
  },
  {
    match: "GET /api/projects/{id}/api-key",
    category: "gap",
    why: "annotated already, but /api/projects entries in the document are hand-authored and richer than the app generates, so switching the family to app-derived would lose the schemas it publishes today; enriching those describeRoute calls is the prerequisite",
  },
  {
    match: "POST /api/projects/{id}/regenerate-api-key",
    category: "gap",
    why: "same prerequisite as reading the project API key",
  },
  {
    match: "/api/annotations/trace/{trace}",
    category: "gap",
    why: "documented at /api/annotations/trace/{id} while the handler names the segment :trace; the endpoint is published, the placeholder names disagree",
  },
] as const satisfies readonly Exclusion[];

interface OpenApiDocument {
  paths?: Record<string, Record<string, unknown>>;
}

export interface RegisteredRoute {
  /** `METHOD /path/{template}` as the document would spell it. */
  key: string;
  /** Repo-relative source file that registers it. */
  file: string;
  /** Whether the handler carries `describeRoute` — step 1 of publishing. */
  described: boolean;
}

/**
 * Every route the codebase registers under an `/api` basePath.
 *
 * A file declaring more than one `/api` basePath contributes each registration
 * under every one of them. That is not a guess: the only file that does it
 * mounts a rewriting alias app beside the real one, so both spellings really
 * are served, and both have to be accounted for.
 */
export function collectRegisteredRoutes(
  roots: readonly string[],
): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];

  for (const file of discoverTypeScriptFiles(roots)) {
    const source = readFileSync(file, "utf8");
    const basePaths = apiBasePathsOf(source);
    if (basePaths.length === 0) continue;

    const relative = file.startsWith(`${LANGWATCH_ROOT}/`)
      ? file.slice(LANGWATCH_ROOT.length + 1)
      : file;

    for (const registration of collectRouteRegistrations(source)) {
      for (const basePath of basePaths) {
        const path = honoPathToTemplate(
          joinRoutePath({ basePath, routePath: registration.path }),
        );
        routes.push({
          key: `${registration.method.toUpperCase()} ${path}`,
          file: relative,
          described: registration.described,
        });
      }
    }
  }

  return routes;
}

/** Every `METHOD /path` the document describes. */
export function documentedOperations(document: OpenApiDocument): Set<string> {
  const documented = new Set<string>();
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (item[method] !== undefined) {
        documented.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return documented;
}

/** Does this exclusion cover that operation key? */
export function excludes({
  exclusion,
  key,
}: {
  exclusion: Exclusion;
  key: string;
}): boolean {
  if (!exclusion.match.startsWith("/")) return exclusion.match === key;
  const path = key.slice(key.indexOf(" ") + 1);
  return path === exclusion.match || path.startsWith(`${exclusion.match}/`);
}

export interface CoverageResult {
  /** Registered, undocumented, and excused by nothing. */
  unexplained: RegisteredRoute[];
  /** Entries that excused no undocumented route, so they have to go. */
  stale: Exclusion[];
  documented: number;
  registered: number;
}

export function auditCoverage({
  routes,
  documented,
  exclusions,
}: {
  routes: RegisteredRoute[];
  documented: Set<string>;
  exclusions: readonly Exclusion[];
}): CoverageResult {
  const byKey = new Map<string, RegisteredRoute>();
  for (const route of routes) {
    if (!byKey.has(route.key)) byKey.set(route.key, route);
  }

  const missing = [...byKey.values()].filter(
    (route) => !documented.has(route.key),
  );

  const used = new Set<Exclusion>();
  const unexplained = missing.filter((route) => {
    const excusing = exclusions.filter((exclusion) =>
      excludes({ exclusion, key: route.key }),
    );
    for (const exclusion of excusing) used.add(exclusion);
    return excusing.length === 0;
  });

  return {
    unexplained: unexplained.sort((a, b) => a.key.localeCompare(b.key)),
    stale: exclusions.filter((exclusion) => !used.has(exclusion)),
    documented: byKey.size - missing.length,
    registered: byKey.size,
  };
}

/** Why each route reached the report, and which publishing step it skipped. */
function formatUnexplained(routes: RegisteredRoute[]): string[] {
  if (routes.length === 0) return [];

  const lines = [
    `${routes.length} registered route${routes.length === 1 ? " is" : "s are"} missing from the OpenAPI document with no reason on record:`,
    "",
  ];

  for (const route of routes) {
    lines.push(`  ${route.key}`);
    lines.push(
      `    ${route.file}${route.described ? " (has describeRoute, so its app is probably not imported by generateOpenAPISpec)" : " (no describeRoute, so the generator skips it)"}`,
    );
  }

  lines.push(
    "",
    "Publish it: add describeRoute({...}) to the handler, import its app in",
    "src/tasks/generateOpenAPISpec.ts, add its prefix to APP_DERIVED_PREFIXES,",
    "then run `pnpm run task generateOpenAPISpec`.",
    "",
    "Or record why it stays unpublished, in UNPUBLISHED in this file.",
  );

  return lines;
}

/** Entries that excused nothing, with the reason they are no longer earning. */
function formatStale(exclusions: Exclusion[]): string[] {
  if (exclusions.length === 0) return [];

  const lines = [
    `${exclusions.length} UNPUBLISHED entr${exclusions.length === 1 ? "y excuses" : "ies excuse"} nothing and must be deleted:`,
    "",
  ];

  for (const exclusion of exclusions) {
    lines.push(`  ${exclusion.match} [${exclusion.category}]`);
    lines.push(`    was excused because: ${exclusion.why}`);
  }

  return lines;
}

function formatReport(result: CoverageResult): string {
  return [formatUnexplained(result.unexplained), formatStale(result.stale)]
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
}

function main(): void {
  const asJson = process.argv.includes("--json");

  const document = JSON.parse(
    readFileSync(SPEC_PATH, "utf8"),
  ) as OpenApiDocument;

  const result = auditCoverage({
    routes: collectRegisteredRoutes(HANDLER_ROOTS),
    documented: documentedOperations(document),
    exclusions: UNPUBLISHED,
  });

  const failed = result.unexplained.length > 0 || result.stale.length > 0;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          registered: result.registered,
          documented: result.documented,
          unexplained: result.unexplained,
          staleExclusions: result.stale,
          ok: !failed,
        },
        null,
        2,
      ),
    );
    process.exit(failed ? 1 : 0);
  }

  const gaps = UNPUBLISHED.filter((e) => e.category === "gap").length;
  console.log(
    `openapi route coverage: ${result.documented}/${result.registered} registered routes are in the document`,
  );
  console.log(
    `unpublished on purpose: ${UNPUBLISHED.length} entries (${gaps} of them recorded as gaps still worth closing)`,
  );
  console.log("");

  if (!failed) {
    console.log("OK: every registered route is documented or accounted for.");
    return;
  }

  console.error(formatReport(result));
  process.exit(1);
}

/**
 * Is this module the one node was asked to run? Both sides resolve through
 * `realpathSync` first so a symlinked invocation still matches; comparing the
 * paths lexically would be fail-open, exiting 0 having checked nothing.
 */
export function isEntryModule({
  invokedPath,
  modulePath,
}: {
  invokedPath: string | undefined;
  modulePath: string;
}): boolean {
  if (invokedPath === undefined) return false;
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  return real(invokedPath) === real(modulePath);
}

if (isEntryModule({ invokedPath: process.argv[1], modulePath: __filename })) {
  main();
}
