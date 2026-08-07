/**
 * Reading the app's Hono route table out of its own source.
 *
 * Two checks need the same answer — "which routes does this codebase actually
 * register, and at what path" — for different reasons: the completeness gate
 * cross-checks handlers that read a query string against what the document
 * declares, and the coverage gate compares the whole registered surface to the
 * document's path list. Booting the router to ask it would drag in Prisma, the
 * env schema, and every service a route imports, so both parse the sources.
 *
 * What counts as a registration: a `.get(`/`.post(`/`.put(`/`.patch(`/
 * `.delete(` call whose first argument is a string literal starting with `/`.
 * That deliberately excludes context and collection reads such as
 * `c.get("project")` or `cache.delete(key)`, which are far more common in these
 * files than route registrations are.
 *
 * Services built on `@langwatch/api` spell two more shapes. `v.sse("/x", ...)`
 * is a GET once mounted, so it is read as one. `v.withdraw("get", "/x")` is a
 * 410 tombstone for a path an earlier version served, so it is read as a route
 * that exists and can never be documented.
 *
 * The parse is textual on purpose. A route registered through a helper, a loop,
 * or a computed path is invisible to it — the repo has none today, and a check
 * that silently under-reports is the failure mode to watch for if that changes.
 */

import type { Dirent } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * `:id` segments become `{id}` so a Hono path can be compared to a template.
 *
 * A parameter may carry a Hono regex constraint — `:id{.+}` matches a slash so
 * one segment can hold a path-like id. The constraint is Hono's routing detail
 * and has no OpenAPI equivalent, so it comes off: without this, `:idOrSlug{.+}`
 * templated to `{idOrSlug}{.+}` and matched no documented path at all.
 */
export function honoPathToTemplate(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)(\{(?:[^{}]|\{[^{}]*\})*\})?/g, "{$1}");
}

export function joinRoutePath({
  basePath,
  routePath,
}: {
  basePath: string;
  routePath: string;
}): string {
  const joined = `${basePath.replace(/\/$/, "")}/${routePath.replace(/^\//, "")}`;
  return joined.replace(/\/$/, "") || "/";
}

/**
 * What a query read looks like in source. The validator pattern is
 * case-insensitive on its first letter because the repo imports Hono's
 * `validator` under the alias `zValidator`, and matching only one spelling
 * would silently narrow the caller to the routes that also happen to call
 * `c.req.valid("query")` in the same span.
 */
const QUERY_READ_MARKERS = [
  /[Vv]alidator\(\s*"query"/,
  /c\.req\.valid\(\s*"query"\s*\)/,
  /c\.req\.query\(/,
];

/** A route registration carries `describeRoute` when its span mentions one. */
const DESCRIBE_ROUTE_MARKER = /describeRoute\(/;

/**
 * What documents a `@langwatch/api` endpoint. Those services never write
 * `describeRoute` themselves: the framework emits it from the endpoint config,
 * and only when the config gives it something to say. So on that family these
 * two keys are the same precondition, spelled the framework's way.
 */
const ENDPOINT_DOC_MARKERS = [/\boutput:/, /\bdescription:/];

/**
 * Whether a file declares its routes through the `@langwatch/api` framework.
 *
 * Everything below that reads a framework shape asks this first, because the
 * shapes are ordinary words. `output:` appears in code with no service in it at
 * all, and `createService(...)` is a name a test one directory over already
 * uses for its own local helper. The import is what separates the framework's
 * spelling of a route from a coincidence.
 */
export function importsApiFramework(source: string): boolean {
  return /\bfrom\s*["']@langwatch\/api(?:\/[^"']*)?["']/.test(source);
}

export interface RouteRegistration {
  method: string;
  path: string;
  readsQuery: boolean;
  /** Whether the span carries `describeRoute(` — the generator's precondition. */
  described: boolean;
  /** Present when the registration is `v.sse(...)`, which mounts as a GET. */
  sse?: boolean;
  /** Present when the registration is a `v.withdraw(...)` 410 tombstone. */
  withdrawn?: boolean;
}

interface RouteMatch {
  method: string;
  path: string;
  index: number;
  sse: boolean;
  withdrawn: boolean;
}

/**
 * Every registration in a file, in source order.
 *
 * The two shapes are matched by separate patterns and merged by index before
 * anything slices spans out of the source. Appended one list after the other,
 * a withdrawal written above a registration would still sort below it, and the
 * arithmetic that gives each route the source up to its neighbour would run
 * backwards: the registration's span collapses to nothing while the
 * withdrawal's runs to the end of the file, crediting a `c.req.query(` or an
 * `output:` to the wrong route.
 */
function routeMatches(source: string): RouteMatch[] {
  const registrations = new RegExp(
    `\\.(${[...HTTP_METHODS, "sse"].join("|")})\\(\\s*"(/[^"]*)"`,
    "g",
  );
  const withdrawals = new RegExp(
    `\\.withdraw\\(\\s*"(${HTTP_METHODS.join("|")})"\\s*,\\s*"(/[^"]*)"`,
    "g",
  );

  const matches: RouteMatch[] = [];

  for (const match of source.matchAll(registrations)) {
    const [, method, path] = match;
    if (method === undefined || path === undefined) continue;
    matches.push({
      method: method === "sse" ? "get" : method,
      path,
      index: match.index,
      sse: method === "sse",
      withdrawn: false,
    });
  }

  for (const match of source.matchAll(withdrawals)) {
    const [, method, path] = match;
    if (method === undefined || path === undefined) continue;
    matches.push({
      method,
      path,
      index: match.index,
      sse: false,
      withdrawn: true,
    });
  }

  return matches.sort((a, b) => a.index - b.index);
}

/**
 * Every route registration in one source file. A registration owns the source
 * from its own call to the next one, which is what lets the marker scans above
 * attribute a `c.req.query(` or a `describeRoute(` to the right route.
 */
export function collectRouteRegistrations(source: string): RouteRegistration[] {
  const framework = importsApiFramework(source);
  const matches = routeMatches(source);

  return matches.map((match, i) => {
    const end = matches[i + 1]?.index ?? source.length;
    const body = source.slice(match.index, end);
    return {
      method: match.method,
      path: match.path,
      readsQuery: QUERY_READ_MARKERS.some((marker) => marker.test(body)),
      described:
        DESCRIBE_ROUTE_MARKER.test(body) ||
        (framework && ENDPOINT_DOC_MARKERS.some((marker) => marker.test(body))),
      ...(match.sse ? { sse: true } : {}),
      ...(match.withdrawn ? { withdrawn: true } : {}),
    };
  });
}

/** Every `/api...` basePath a source file declares, in declaration order. */
export function apiBasePathsOf(source: string): string[] {
  const declared: string[] = [];
  const patterns = [/basePath:\s*"([^"]+)"/g, /\.basePath\(\s*"([^"]+)"\s*\)/g];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      if (value?.startsWith("/api") && !declared.includes(value)) {
        declared.push(value);
      }
    }
  }

  return declared;
}

/**
 * `createService(` with an inline config, past any type argument. The type
 * argument may not span lines, so a mis-parse cannot run away with the rest of
 * the file looking for a `({` that closes it.
 */
const CREATE_SERVICE_CALL = /\bcreateService\s*(?:<[^()\n]*>)?\s*\(\s*\{/g;

/**
 * Every `/api...` basePath a file declares through `createService`.
 *
 * The framework derives `/api/<name>` from the service name, so a file saying
 * `createService({ name: "roles" })` and nothing else serves `/api/roles/...`
 * without that string appearing anywhere in it. To a parse that reads only
 * declared basePaths such a file has none, so every route in it is invisible to
 * both gates, which is the exact silence the coverage gate exists to break.
 *
 * A config that spells its `basePath` out is skipped: `apiBasePathsOf` already
 * reads that form, and an explicit basePath wins over the derived one in the
 * framework too.
 */
export function serviceBasePathsOf(source: string): string[] {
  if (!importsApiFramework(source)) return [];

  const declared: string[] = [];
  for (const config of createServiceConfigs(source)) {
    if (/\bbasePath:/.test(config)) continue;
    const name = config.match(/\bname:\s*"([^"]+)"/)?.[1];
    if (name === undefined) continue;

    const basePath = `/api/${name}`;
    if (!declared.includes(basePath)) declared.push(basePath);
  }

  return declared;
}

/**
 * The top-level view of every `createService({...})` config in a file: the
 * object literal with its nested objects removed, so a `name` belonging to a
 * `_legacy` block or a middleware option cannot be read as the service's own.
 */
function createServiceConfigs(source: string): string[] {
  const configs: string[] = [];

  for (const match of source.matchAll(CREATE_SERVICE_CALL)) {
    const opening = match.index + match[0].length - 1;
    const closing = closingBraceIndex({ source, opening });
    if (closing === -1) continue;
    configs.push(topLevelOf(source.slice(opening, closing + 1)));
  }

  return configs;
}

/** Index of the `}` closing the `{` at `opening`, or -1 when it is unbalanced. */
function closingBraceIndex({
  source,
  opening,
}: {
  source: string;
  opening: number;
}): number {
  let depth = 0;

  for (let index = opening; index < source.length; index++) {
    const character = source[index];
    if (character === "{") depth++;
    else if (character === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/** An object literal reduced to the text of its own keys. */
function topLevelOf(literal: string): string {
  let depth = 0;
  let kept = "";

  for (const character of literal) {
    if (character === "{") {
      depth++;
      continue;
    }
    if (character === "}") {
      depth--;
      continue;
    }
    if (depth === 1) kept += character;
  }

  return kept;
}

/** A directory that cannot be read holds no route registrations to find. */
function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const isSkippedDirectory = (name: string): boolean =>
  name === "node_modules" || name === "__tests__";

const isSourceFile = (name: string): boolean =>
  name.endsWith(".ts") && !name.endsWith(".d.ts");

/** One directory's children, split into what to descend into and what to read. */
function partitionDirectory(dir: string): {
  directories: string[];
  files: string[];
} {
  const directories: string[] = [];
  const files: string[] = [];

  for (const entry of readEntries(dir)) {
    if (isSkippedDirectory(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) directories.push(full);
    else if (isSourceFile(entry.name)) files.push(full);
  }

  return { directories, files };
}

export function discoverTypeScriptFiles(roots: readonly string[]): string[] {
  const found: string[] = [];
  const pending = [...roots];

  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) break;
    const { directories, files } = partitionDirectory(dir);
    pending.push(...directories);
    found.push(...files);
  }

  return found.sort();
}
