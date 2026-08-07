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
 *   1. the operation is described. `generateSpecs` skips a handler carrying no
 *      `describeRoute({...})`, so the annotation is the precondition, not a
 *      nicety. A `@langwatch/api` service writes no `describeRoute` of its own:
 *      the framework emits one from the endpoint config, and only when the
 *      config declares an `output` or a `description`
 *   2. the route's Hono app is imported by `src/tasks/generateOpenAPISpec.ts`
 *   3. its prefix is in that file's `APP_DERIVED_PREFIXES`, or the merge keeps
 *      whatever the JSON already said
 *
 * So the answer to "can we just generate the spec for everything?" is yes,
 * mechanically (describe the operation, import its app), and the reason it had
 * not happened is that nothing made the omission visible. This gate does.
 *
 * Every registered route is either in the document, in `UNPUBLISHED` below with
 * a reason, or a `withdraw(...)` tombstone that answers 410 and has no handler
 * to describe. The list is ratcheted: an entry matching nothing is itself a
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
  importsApiFramework,
  joinRoutePath,
  serviceBasePathsOf,
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
 * decoration: `internal`, `alias` and `elsewhere` are permanent answers, `gap`
 * is a debt that should shrink, and keeping them apart is what stops the list
 * from quietly becoming a place to put anything inconvenient.
 */
export type AbsenceCategory =
  /** Not a customer-callable API. It must never appear in the reference. */
  | "internal"
  /** A retired or aliased path kept alive for older clients. */
  | "alias"
  /**
   * Public and deliberately documented somewhere other than the API
   * reference, because an OpenAPI operation is the wrong shape for it: the
   * contract belongs to someone else (OTLP), or the useful documentation is a
   * guide rather than a request schema.
   */
  | "elsewhere"
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

  {
    match: "POST /api/export/traces/download",
    category: "internal",
    why: "the dashboard's download button, authenticated by a browser session rather than an API key. An API-key holder cannot reach it; /api/traces/search is the programmatic equivalent",
  },
  {
    match: "POST /api/export/scenario-runs/download",
    category: "internal",
    why: "the dashboard's download button for scenario runs, session-authenticated in the same way as the trace export",
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

  // ── Elsewhere: public, documented outside the API reference ────────────
  {
    match: "POST /api/collector",
    category: "elsewhere",
    why: "the SDK trace ingestion path. Its contract is the span payload the SDKs build for you, and the integration guides are where a reader needs to meet it; an operation listing 40 span fields answers a question nobody asks here",
  },
  {
    match: "/api/otel/v1",
    category: "elsewhere",
    why: "OTLP/HTTP receivers. The contract is OpenTelemetry's protobuf, which an OpenAPI operation describes poorly; the integration docs point at the OTLP spec instead",
  },
  {
    match: "/api/ingest",
    category: "elsewhere",
    why: "AI Governance source receivers, addressed with a per-source ingestion key. Documented today in the governance sources guide rather than the API reference",
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
  /** Present when the route is a `withdraw(...)` 410 tombstone. */
  withdrawn?: boolean;
  /**
   * Present when the file declares its service through `@langwatch/api`, where
   * publishing an endpoint is a different instruction: the framework writes the
   * `describeRoute` itself, from the endpoint config.
   */
  usesApiFramework?: boolean;
}

/**
 * Every `/api` basePath a source declares, however it declares it.
 *
 * A `@langwatch/api` service names itself and lets the framework derive
 * `/api/<name>`, so the string the gate matches on never appears in the file.
 * Composing the two readings here rather than inside `apiBasePathsOf` keeps
 * that function answering the narrower question the completeness gate asks it.
 */
function declaredApiBasePaths(source: string): string[] {
  const declared = apiBasePathsOf(source);

  for (const derived of serviceBasePathsOf(source)) {
    if (!declared.includes(derived)) declared.push(derived);
  }

  return declared;
}

/**
 * The `/api` basePaths a file's routes are served under.
 *
 * Usually the file declares its own. The `app.v1.ts` files do not: they export
 * a register function that a sibling `app.ts` calls against an app it
 * constructed, so the basePath lives one file over. Reading only what a file
 * declares skipped all seven of them and the routes they register -- the whole
 * prompts, traces and evaluators v1 surfaces -- and a gate with a hole that
 * shape cannot claim to cover the API.
 *
 * Nothing was hidden by it: those routes are documented. But a new one added in
 * any of those files would never have been caught, which is the failure this
 * check exists to prevent.
 */
function basePathsFor({
  file,
  source,
}: {
  file: string;
  source: string;
}): string[] {
  const declared = declaredApiBasePaths(source);
  if (declared.length > 0) return declared;

  try {
    return declaredApiBasePaths(
      readFileSync(join(dirname(file), "app.ts"), "utf8"),
    );
  } catch {
    return [];
  }
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
  return discoverTypeScriptFiles(roots).flatMap((file) =>
    routesRegisteredIn({ file, source: readFileSync(file, "utf8") }),
  );
}

/** One file's registrations, keyed the way the document spells them. */
function routesRegisteredIn({
  file,
  source,
}: {
  file: string;
  source: string;
}): RegisteredRoute[] {
  const basePaths = basePathsFor({ file, source });
  if (basePaths.length === 0) return [];

  const relative = file.startsWith(`${LANGWATCH_ROOT}/`)
    ? file.slice(LANGWATCH_ROOT.length + 1)
    : file;
  const framework = importsApiFramework(source)
    ? { usesApiFramework: true as const }
    : {};

  return collectRouteRegistrations(source).flatMap((registration) =>
    basePaths.map((basePath) => ({
      key: `${registration.method.toUpperCase()} ${honoPathToTemplate(
        joinRoutePath({ basePath, routePath: registration.path }),
      )}`,
      file: relative,
      described: registration.described,
      ...(registration.withdrawn ? { withdrawn: true as const } : {}),
      ...framework,
    })),
  );
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
  /**
   * Registered, undocumented, and 410 Gone.
   *
   * A withdrawn endpoint is a tombstone: `@langwatch/api` keeps serving the
   * path so an older client gets an answer instead of a 404, and there is no
   * handler behind it for the generator to describe. It therefore cannot be
   * published at all, which makes an UNPUBLISHED entry for it a written reason
   * for something the route's own shape already says. The bucket accounts for
   * them instead, and stays visible so a tombstone that should have been
   * deleted is not silently free.
   */
  withdrawn: RegisteredRoute[];
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
    const seen = byKey.get(route.key);
    // A key registered more than once takes its withdrawal from the last
    // registration. Versions are declared in order and the bare alias serves
    // the last resolution of a path, so the canonical withdrawal reads exactly
    // this way: an early version registers the route, a later one withdraws it.
    byKey.set(
      route.key,
      seen === undefined ? route : { ...seen, withdrawn: route.withdrawn },
    );
  }

  const missing = [...byKey.values()].filter(
    (route) => !documented.has(route.key),
  );

  const used = new Set<Exclusion>();
  const unexcused = missing.filter((route) => {
    const excusing = exclusions.filter((exclusion) =>
      excludes({ exclusion, key: route.key }),
    );
    for (const exclusion of excusing) used.add(exclusion);
    return excusing.length === 0;
  });

  const byKeyOrder = (a: RegisteredRoute, b: RegisteredRoute) =>
    a.key.localeCompare(b.key);

  return {
    unexplained: unexcused
      .filter((route) => route.withdrawn !== true)
      .sort(byKeyOrder),
    withdrawn: unexcused
      .filter((route) => route.withdrawn === true)
      .sort(byKeyOrder),
    stale: exclusions.filter((exclusion) => !used.has(exclusion)),
    documented: byKey.size - missing.length,
    registered: byKey.size,
  };
}

/**
 * Which publishing step a route skipped.
 *
 * A described route reaching this report has an app the generator never asks
 * for a spec. An undescribed one is missing its annotation, and where that
 * annotation goes depends on the family: a `@langwatch/api` service never
 * writes `describeRoute` by hand, so telling its author there is none sends
 * them looking for a call their family does not make.
 */
function publishingStepMissing(route: RegisteredRoute): string {
  if (route.described) {
    return "described, so its app is probably not imported by generateOpenAPISpec";
  }
  return route.usesApiFramework
    ? "no output or description in its endpoint config, so the framework describes nothing for the generator to publish"
    : "no describeRoute, so the generator skips it";
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
    lines.push(`    ${route.file} (${publishingStepMissing(route)})`);
  }

  lines.push(
    "",
    "Publish it: describe the operation (describeRoute({...}) on the handler,",
    "or output/description in the endpoint config of an @langwatch/api",
    "service), import its app in src/tasks/generateOpenAPISpec.ts, add its",
    "prefix to APP_DERIVED_PREFIXES, then run `pnpm run task",
    "generateOpenAPISpec`.",
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
          withdrawn: result.withdrawn,
          staleExclusions: result.stale,
          ok: !failed,
        },
        null,
        2,
      ),
    );
    process.exit(failed ? 1 : 0);
  }

  // Annotated because the list narrows to the categories it currently holds:
  // with the last `gap` entry closed, an unannotated comparison against "gap"
  // is a type error rather than the zero it should report.
  const gaps = UNPUBLISHED.filter(
    (entry: Exclusion) => entry.category === "gap",
  ).length;
  console.log(
    `openapi route coverage: ${result.documented}/${result.registered} registered routes are in the document`,
  );
  console.log(
    `unpublished on purpose: ${UNPUBLISHED.length} entries (${gaps} of them recorded as gaps still worth closing)`,
  );
  if (result.withdrawn.length > 0) {
    console.log(
      `withdrawn tombstones: ${result.withdrawn.length} route${result.withdrawn.length === 1 ? "" : "s"} answer 410 Gone, so nothing about them can reach the document`,
    );
  }
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
