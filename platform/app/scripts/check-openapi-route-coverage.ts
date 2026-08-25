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
 *      the framework emits one from the definition chain, and only when the
 *      chain carries a `withOutput(...)` or a `withDocs(...)`
 *   2. the route's Hono app is imported by `src/tasks/generateOpenAPISpec.ts`
 *   3. its prefix is in that file's `APP_DERIVED_PREFIXES`, or the merge keeps
 *      whatever the JSON already said
 *
 * So the answer to "can we just generate the spec for everything?" is yes,
 * mechanically (describe the operation, import its app), and the reason it had
 * not happened is that nothing made the omission visible. This gate does.
 *
 * Every registered route is either in the document, in the `UNPUBLISHED` list
 * in `openapi-route-exclusions.ts` with a reason, or a `withdraw(...)`
 * tombstone that answers 410 and has no handler to describe. The list is
 * ratcheted: an entry matching nothing is itself a failure, so it cannot
 * outlive the routes it was written for.
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
  type RouteRegistration,
  serviceBasePathsOf,
} from "./lib/hono-route-table";
import { type Exclusion, UNPUBLISHED } from "./openapi-route-exclusions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LANGWATCH_ROOT = resolve(__dirname, "..");

export const SPEC_PATH = join(LANGWATCH_ROOT, "src/app/api/openapiLangWatch.json");

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

/** Every `export const NAME = "YYYY-MM-DD"` in the scanned sources. */
function dateConstantsOf(files: string[]): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern = /export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*"(20\d{2}-\d{2}-\d{2})"/g;

  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
      constants.set(match[1]!, match[2]!);
    }
  }

  return constants;
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
function basePathsFor({ file, source }: { file: string; source: string }): string[] {
  const declared = declaredApiBasePaths(source);
  if (declared.length > 0) return declared;

  try {
    return declaredApiBasePaths(readFileSync(join(dirname(file), "app.ts"), "utf8"));
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
export function collectRegisteredRoutes(roots: readonly string[]): RegisteredRoute[] {
  const files = discoverTypeScriptFiles(roots);
  // Version constants live outside the handler roots by design —
  // `MANAGEMENT_API_VERSION` sits in `src/server/api/management/version.ts` —
  // so the scan for them casts a wider net than the route walk itself.
  const constants = dateConstantsOf(
    discoverTypeScriptFiles([...roots, join(LANGWATCH_ROOT, "src/server/api")]),
  );
  return files.flatMap((file) =>
    routesRegisteredIn({
      file,
      source: readFileSync(file, "utf8"),
      constants,
    }),
  );
}

/** One file's registrations, keyed the way the document spells them. */
function routesRegisteredIn({
  file,
  source,
  constants,
}: {
  file: string;
  source: string;
  constants: Map<string, string>;
}): RegisteredRoute[] {
  const basePaths = basePathsFor({ file, source });
  if (basePaths.length === 0) return [];

  const relative = file.startsWith(`${LANGWATCH_ROOT}/`)
    ? file.slice(LANGWATCH_ROOT.length + 1)
    : file;
  const framework = importsApiFramework(source);

  return basePaths.flatMap((basePath) =>
    framework
      ? expandServiceRegistrations({
          registrations: collectRouteRegistrations(source),
          basePath,
          file: relative,
          constants,
        })
      : collectRouteRegistrations(source).map((registration) => ({
          key: `${registration.method.toUpperCase()} ${honoPathToTemplate(
            joinRoutePath({ basePath, routePath: registration.path }),
          )}`,
          file: relative,
          described: registration.described,
          ...(registration.withdrawn ? { withdrawn: true as const } : {}),
        })),
  );
}

// ---------------------------------------------------------------------------
// @langwatch/api services: one registration fans out into dated + latest mounts
// ---------------------------------------------------------------------------

/**
 * The version namespace a registration names, resolved.
 *
 * The argument is a literal, `"preview"`, or an identifier for a shared
 * constant (`MANAGEMENT_API_VERSION`) that the constants map resolves. An
 * unresolvable reference fails loudly: guessing a namespace would count the
 * route under a path it is not served at, which is the silence the gate
 * exists to break.
 */
function resolveVersionNamespace({
  registration,
  file,
  constants,
}: {
  registration: RouteRegistration;
  file: string;
  constants: Map<string, string>;
}): string {
  if (registration.version !== undefined) return registration.version;

  const resolved =
    registration.versionRef !== undefined
      ? constants.get(registration.versionRef)
      : undefined;
  if (resolved !== undefined) return resolved;

  throw new Error(
    `${file} registers ${registration.method.toUpperCase()} ${registration.path} ` +
      `with version ${registration.versionRef ?? "<none>"}, which no scanned ` +
      `source exports as a YYYY-MM-DD constant, so no namespace can be derived ` +
      `for it. Spell the date literally, or export the constant.`,
  );
}

/**
 * The mounts one service file's registrations produce, per ADR 102: every
 * dated version of every endpoint, plus `latest`. There is no bare alias, and
 * inheritance is folded in — an endpoint registered at an earlier version is
 * counted at every later dated namespace too, because that is what the
 * document publishes.
 *
 * State at a namespace is the last event dated on or before it: a
 * re-registration overrides, a `withdraw(...)` tombstones from its version
 * onward. Withdrawals name no method, so they apply to every method the file
 * registered at that path — the same rule the framework applies.
 */
function expandServiceRegistrations({
  registrations,
  basePath,
  file,
  constants,
}: {
  registrations: RouteRegistration[];
  basePath: string;
  file: string;
  constants: Map<string, string>;
}): RegisteredRoute[] {
  interface ServiceEvent {
    namespace: string;
    index: number;
    registration: RouteRegistration;
  }

  const events: ServiceEvent[] = registrations.map((registration, index) => ({
    namespace: resolveVersionNamespace({ registration, file, constants }),
    index,
    registration,
  }));

  const dated = [
    ...new Set(events.map((event) => event.namespace).filter((v) => v !== "preview")),
  ].sort((a, b) => a.localeCompare(b));

  const methodsByPath = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.registration.withdrawn) continue;
    const methods = methodsByPath.get(event.registration.path) ?? new Set();
    methods.add(event.registration.method);
    methodsByPath.set(event.registration.path, methods);
  }

  /** The state one endpoint is in at one namespace, or null when it does not exist there. */
  const stateAt = (
    method: string,
    path: string,
    namespace: string,
  ): RouteRegistration | null => {
    let state: RouteRegistration | null = null;
    for (const event of events) {
      if (event.namespace === "preview" || event.namespace > namespace) {
        continue;
      }
      const applies = event.registration.withdrawn
        ? event.registration.path === path
        : event.registration.path === path && event.registration.method === method;
      if (applies) state = event.registration;
    }
    return state;
  };

  const out: RegisteredRoute[] = [];
  const emit = (
    method: string,
    path: string,
    namespace: string,
    state: RouteRegistration,
  ): void => {
    out.push({
      key: `${method.toUpperCase()} ${honoPathToTemplate(
        joinRoutePath({
          basePath: `${basePath}/${namespace}`,
          routePath: path,
        }),
      )}`,
      file,
      described: state.described,
      usesApiFramework: true,
      ...(state.withdrawn ? { withdrawn: true as const } : {}),
    });
  };

  for (const [path, methods] of methodsByPath) {
    for (const method of methods) {
      for (const namespace of dated) {
        const state = stateAt(method, path, namespace);
        if (state) emit(method, path, namespace, state);
      }
      if (dated.length > 0) {
        const latest = stateAt(method, path, dated[dated.length - 1]!);
        if (latest) emit(method, path, "latest", latest);
      }
      // Preview is its own namespace: only preview events apply, and a
      // preview mount is never documented.
      let preview: RouteRegistration | null = null;
      for (const event of events) {
        if (event.namespace !== "preview") continue;
        const applies = event.registration.withdrawn
          ? event.registration.path === path
          : event.registration.path === path && event.registration.method === method;
        if (applies) preview = event.registration;
      }
      if (preview) emit(method, path, "preview", preview);
    }
  }

  return out;
}

/** Every `METHOD /path` the document describes. */
export function documentedOperations(document: OpenApiDocument): Set<string> {
  const documented = new Set<string>();
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    // A trailing slash is the same resource to both sides of this comparison:
    // the framework mounts a family root as `/{version}/`, the document keeps
    // that spelling, and the route table's join strips it. Normalize here
    // rather than reporting twelve collection roots as missing over a `/`.
    const normalized = path.length > 1 ? path.replace(/\/$/, "") : path;
    for (const method of HTTP_METHODS) {
      if (item[method] !== undefined) {
        documented.add(`${method.toUpperCase()} ${normalized}`);
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
   * for something the route's own shape already says: such an entry excuses
   * nothing and is reported stale. The bucket accounts for them instead, and
   * stays visible so a tombstone that should have been deleted is not silently
   * free.
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
    // A key registered more than once resolves to its last registration, as a
    // whole record. The latest namespace serves the last resolution of a
    // path, so that registration is the one the document describes there: an
    // early version registers the route, a later one withdraws it or stops
    // describing it, and both the withdrawal and the diagnostic have to read
    // the later shape.
    byKey.set(route.key, route);
  }

  const missing = [...byKey.values()].filter((route) => !documented.has(route.key));

  // A tombstone is accounted for by its own shape, so it never counts as the
  // route an UNPUBLISHED entry was written for. Letting it count would leave a
  // redundant entry earning its keep off a route that can never be published,
  // and the ratchet would stop being one.
  const publishable = missing.filter((route) => route.withdrawn !== true);

  const used = new Set<Exclusion>();
  const unexcused = publishable.filter((route) => {
    const excusing = exclusions.filter((exclusion) =>
      excludes({ exclusion, key: route.key }),
    );
    for (const exclusion of excusing) used.add(exclusion);
    return excusing.length === 0;
  });

  const byKeyOrder = (a: RegisteredRoute, b: RegisteredRoute) =>
    a.key.localeCompare(b.key);

  return {
    unexplained: unexcused.sort(byKeyOrder),
    withdrawn: missing.filter((route) => route.withdrawn === true).sort(byKeyOrder),
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
    ? "no withOutput or withDocs in its definition chain, so the framework describes nothing for the generator to publish"
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
    "or withOutput(...)/withDocs(...) in the definition chain of an",
    "@langwatch/api service), import its app in src/tasks/generateOpenAPISpec.ts,",
    "add its prefix to APP_DERIVED_PREFIXES, then run `pnpm run task",
    "generateOpenAPISpec`.",
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

  const document = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as OpenApiDocument;

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
  const gaps = UNPUBLISHED.filter((entry: Exclusion) => entry.category === "gap").length;
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
