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
 * Every registered route is either in the document or in the `UNPUBLISHED` list
 * in `openapi-route-exclusions.ts` with a reason. The list is ratcheted: an
 * entry matching nothing is itself a failure, so it cannot outlive the routes
 * it was written for.
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
import { type Exclusion, UNPUBLISHED } from "./openapi-route-exclusions";

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
  const declared = apiBasePathsOf(source);
  if (declared.length > 0) return declared;

  try {
    return apiBasePathsOf(readFileSync(join(dirname(file), "app.ts"), "utf8"));
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
  const routes: RegisteredRoute[] = [];

  for (const file of discoverTypeScriptFiles(roots)) {
    const source = readFileSync(file, "utf8");
    const basePaths = basePathsFor({ file, source });
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
    "Or record why it stays unpublished, in UNPUBLISHED in",
    "scripts/openapi-route-exclusions.ts.",
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
