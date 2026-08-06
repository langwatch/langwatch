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

export interface RouteRegistration {
  method: string;
  path: string;
  readsQuery: boolean;
  /** Whether the span carries `describeRoute(` — the generator's precondition. */
  described: boolean;
}

/**
 * Every route registration in one source file. A registration owns the source
 * from its own call to the next one, which is what lets the marker scans above
 * attribute a `c.req.query(` or a `describeRoute(` to the right route.
 */
export function collectRouteRegistrations(source: string): RouteRegistration[] {
  const pattern = new RegExp(
    `\\.(${HTTP_METHODS.join("|")})\\(\\s*"(/[^"]*)"`,
    "g",
  );

  const starts: { method: string; path: string; index: number }[] = [];
  for (const match of source.matchAll(pattern)) {
    const [, method, path] = match;
    if (method === undefined || path === undefined) continue;
    starts.push({ method, path, index: match.index });
  }

  return starts.map((start, i) => {
    const end = starts[i + 1]?.index ?? source.length;
    const body = source.slice(start.index, end);
    return {
      method: start.method,
      path: start.path,
      readsQuery: QUERY_READ_MARKERS.some((marker) => marker.test(body)),
      described: DESCRIBE_ROUTE_MARKER.test(body),
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
