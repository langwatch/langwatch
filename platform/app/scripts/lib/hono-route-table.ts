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
 * Services built on `@langwatch/api` spell their registrations differently
 * (ADR 101): `.registerRoute("get", "/x", version, ...)`,
 * `.register("things.create", version, ...)` (an RPC, mounted as a POST at
 * `/things.create`), `.registerSse("things.watch", version, ...)` (mounted as
 * a GET) and `.withdraw("/x" | "things.get", version)` (a 410 tombstone). The
 * version argument is a `YYYY-MM-DD` literal, `"preview"`, or an identifier —
 * a shared constant the coverage gate resolves; this library only records
 * which form it took. Those shapes are only read when the file imports the
 * framework: `register` is an ordinary word, and the import is what separates
 * the framework's spelling of a route from a coincidence.
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
  // The framework's spelling: validated query arrives as a context variable.
  /c\.get\(\s*"query"\s*\)/,
];

/** A route registration carries `describeRoute` when its span mentions one. */
const DESCRIBE_ROUTE_MARKER = /describeRoute\(/;

/**
 * What documents a `@langwatch/api` endpoint. Those services never write
 * `describeRoute` themselves: the framework emits it from the definition
 * chain, and only when the chain gives it something to say — a `withOutput`
 * or a `withDocs`. Either one is the framework's spelling of the same
 * precondition.
 */
const ENDPOINT_DOC_MARKERS = [/\bwithOutput\(/, /\bwithDocs\(/];

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
  /** Present when the registration is `registerSse(...)`, which mounts as a GET. */
  sse?: boolean;
  /** Present when the registration is a `withdraw(...)` 410 tombstone. */
  withdrawn?: boolean;
  /**
   * The registration's version namespace as a literal (`"2026-08-07"` or
   * `"preview"`), when the source spells it out.
   */
  version?: string;
  /**
   * The registration's version argument when it is an identifier (a shared
   * constant such as `MANAGEMENT_API_VERSION`), for the caller to resolve.
   */
  versionRef?: string;
}

interface RouteMatch {
  method: string;
  path: string;
  index: number;
  sse: boolean;
  withdrawn: boolean;
  version?: string;
  versionRef?: string;
}

/** The version argument of a framework registration: a literal or an identifier. */
const VERSION_ARGUMENT = String.raw`(?:"(20\d{2}-\d{2}-\d{2}|preview)"|([A-Za-z_][A-Za-z0-9_]*))`;

/**
 * Every registration in a file, in source order.
 *
 * The shapes are matched by separate patterns and merged by index before
 * anything slices spans out of the source. Appended one list after the other,
 * a withdrawal written above a registration would still sort below it, and the
 * arithmetic that gives each route the source up to its neighbour would run
 * backwards: the registration's span collapses to nothing while the
 * withdrawal's runs to the end of the file, crediting a `c.req.query(` or a
 * `withOutput(` to the wrong route.
 *
 * The framework shapes are only matched when the file imports `@langwatch/api`
 * — `register` is an ordinary word, and a framework pattern matched against a
 * plain file would invent routes out of unrelated calls.
 */
function routeMatches(source: string, framework: boolean): RouteMatch[] {
  const registrations = new RegExp(
    `\\.(${HTTP_METHODS.join("|")})\\(\\s*"(/[^"]*)"`,
    "g",
  );

  const matches: RouteMatch[] = [];

  for (const match of source.matchAll(registrations)) {
    const [, method, path] = match;
    if (method === undefined || path === undefined) continue;
    matches.push({
      method,
      path,
      index: match.index,
      sse: false,
      withdrawn: false,
    });
  }

  if (framework) {
    const restRoutes = new RegExp(
      String.raw`\.registerRoute\(\s*"(${HTTP_METHODS.join("|")})"\s*,\s*"(\/[^"]*)"\s*,\s*${VERSION_ARGUMENT}`,
      "g",
    );
    const rpcRoutes = new RegExp(
      String.raw`\.register\(\s*"([^"]+)"\s*,\s*${VERSION_ARGUMENT}`,
      "g",
    );
    const sseRoutes = new RegExp(
      String.raw`\.registerSse\(\s*"([^"]+)"\s*,\s*${VERSION_ARGUMENT}`,
      "g",
    );
    const withdrawals = new RegExp(
      String.raw`\.withdraw\(\s*"([^"]+)"\s*,\s*${VERSION_ARGUMENT}`,
      "g",
    );

    const versionOf = (
      literal: string | undefined,
      reference: string | undefined,
    ): Pick<RouteMatch, "version" | "versionRef"> =>
      literal !== undefined ? { version: literal } : { versionRef: reference };

    const frameworkMatches: RouteMatch[] = [];

    for (const match of source.matchAll(restRoutes)) {
      const [, method, path, literal, reference] = match;
      if (method === undefined || path === undefined) continue;
      frameworkMatches.push({
        method,
        path,
        index: match.index,
        sse: false,
        withdrawn: false,
        ...versionOf(literal, reference),
      });
    }

    for (const match of source.matchAll(rpcRoutes)) {
      const [, name, literal, reference] = match;
      if (name === undefined) continue;
      frameworkMatches.push({
        method: "post",
        path: `/${name}`,
        index: match.index,
        sse: false,
        withdrawn: false,
        ...versionOf(literal, reference),
      });
    }

    for (const match of source.matchAll(sseRoutes)) {
      const [, name, literal, reference] = match;
      if (name === undefined) continue;
      frameworkMatches.push({
        method: "get",
        path: `/${name}`,
        index: match.index,
        sse: true,
        withdrawn: false,
        ...versionOf(literal, reference),
      });
    }

    for (const match of source.matchAll(withdrawals)) {
      const [, target, literal, reference] = match;
      if (target === undefined) continue;
      frameworkMatches.push({
        // A withdrawal names the endpoint, not the method: every method
        // registered at the path is tombstoned. The coverage gate expands the
        // marker against the registrations it has seen for the path.
        method: "all",
        path: target.startsWith("/") ? target : `/${target}`,
        index: match.index,
        sse: false,
        withdrawn: true,
        ...versionOf(literal, reference),
      });
    }

    // A framework call the patterns above cannot read — a computed path, a
    // version expression — would take its routes out of both gates unseen.
    // Count every call site and refuse to guess. `register` is tried after
    // `registerRoute`/`registerSse` so each site counts exactly once.
    const frameworkCalls = [
      ...source.matchAll(
        /\.(registerRoute|registerSse|register|withdraw)\(\s*"/g,
      ),
    ].length;
    if (frameworkMatches.length !== frameworkCalls) {
      throw new Error(
        `${frameworkCalls - frameworkMatches.length} @langwatch/api registration call(s) ` +
          `have a shape this parser cannot read (a computed path or version ` +
          `expression?). Use a string literal path and a YYYY-MM-DD literal or ` +
          `a module constant, or teach scripts/lib/hono-route-table.ts the new ` +
          `form — unread registrations serve routes no gate can see.`,
      );
    }

    // A group prefixes every dotted name registered through it, and the prefix
    // lives in a variable this parse never sees — so a grouped registration
    // would be counted under the wrong path, which is worse than none.
    if (/\.group\(\s*"/.test(source)) {
      throw new Error(
        `This file registers endpoints through a @langwatch/api group, whose ` +
          `name prefixing this textual parse cannot reproduce. Register without ` +
          `a group, or teach scripts/lib/hono-route-table.ts to apply the prefix.`,
      );
    }

    matches.push(...frameworkMatches);
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
  const matches = routeMatches(source, framework);

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
      ...(match.version !== undefined ? { version: match.version } : {}),
      ...(match.versionRef !== undefined ? { versionRef: match.versionRef } : {}),
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
 * Any `createService(` call, whatever it is passed. Counted against the
 * inline-config matches so a form this parser cannot read fails loudly instead
 * of taking the file's whole route surface out of the gate with it.
 */
const ANY_CREATE_SERVICE_CALL = /\bcreateService\s*(?:<[^()\n]*>)?\s*\(/g;

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
  const isCode = codePositions(source);
  const configs: string[] = [];

  for (const match of source.matchAll(CREATE_SERVICE_CALL)) {
    const opening = match.index + match[0].length - 1;
    const closing = closingBraceIndex({ source, isCode, opening });
    if (closing === -1) {
      throw new Error(
        `A createService config at offset ${opening} has no balanced closing brace, ` +
          `so no base path can be derived from it and every route of that service ` +
          `would drop out of the coverage gate unseen.`,
      );
    }
    configs.push(
      topLevelOf({
        literal: source.slice(opening, closing + 1),
        isCode: isCode.slice(opening, closing + 1),
      }),
    );
  }

  const calls = [...source.matchAll(ANY_CREATE_SERVICE_CALL)].length;
  if (calls !== configs.length) {
    throw new Error(
      `${calls - configs.length} createService call(s) pass something other than an ` +
        `inline config object, which this parser cannot read. Inline the config, or ` +
        `teach scripts/lib/hono-route-table.ts the new form, or those services serve ` +
        `routes no gate can see.`,
    );
  }

  return configs;
}

/**
 * Which characters of `text` are code rather than the inside of a string
 * literal or a comment.
 *
 * Brace counting has to consult this. A `}` in a description or in a comment
 * closes nothing, but read as the end of a `createService` config it truncates
 * the config before its `name:`, and `serviceBasePathsOf` then derives no base
 * path and every route of that service leaves the coverage gate unseen. An
 * unpaired `{` is the same failure wearing the loud costume: the scan runs off
 * the end of the file and reports an imbalance that is not there.
 *
 * A template literal counts as one opaque string, `${...}` included. Its braces
 * pair up inside it either way, so skipping the lot keeps the count right
 * without parsing an expression.
 */
function codePositions(text: string): boolean[] {
  const isCode = new Array<boolean>(text.length).fill(true);
  let index = 0;

  while (index < text.length) {
    const end = endOfNonCodeSpan({ text, start: index });
    if (end === index) {
      index++;
      continue;
    }
    for (let at = index; at < end; at++) isCode[at] = false;
    index = end;
  }

  return isCode;
}

/**
 * Index just past the comment or string literal starting at `start`, or `start`
 * itself when the character there is code.
 */
function endOfNonCodeSpan({
  text,
  start,
}: {
  text: string;
  start: number;
}): number {
  const character = text[start];
  const next = text[start + 1];

  if (character === "/" && next === "/") {
    const newline = text.indexOf("\n", start);
    return newline === -1 ? text.length : newline;
  }
  if (character === "/" && next === "*") {
    const close = text.indexOf("*/", start + 2);
    return close === -1 ? text.length : close + 2;
  }
  if (character === '"' || character === "'" || character === "`") {
    return endOfStringLiteral({ text, start });
  }

  return start;
}

/** Index just past the string or template literal opening at `start`. */
function endOfStringLiteral({
  text,
  start,
}: {
  text: string;
  start: number;
}): number {
  const quote = text[start];

  for (let index = start + 1; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === quote) return index + 1;
  }

  return text.length;
}

/** What a character does to the brace depth: +1, -1, or nothing. */
function braceDepthChange(character: string | undefined): number {
  if (character === "{") return 1;
  if (character === "}") return -1;
  return 0;
}

/** Index of the `}` closing the `{` at `opening`, or -1 when it is unbalanced. */
function closingBraceIndex({
  source,
  isCode,
  opening,
}: {
  source: string;
  isCode: boolean[];
  opening: number;
}): number {
  let depth = 0;

  for (let index = opening; index < source.length; index++) {
    if (!isCode[index]) continue;
    const change = braceDepthChange(source[index]);
    if (change === 0) continue;
    depth += change;
    if (depth === 0) return index;
  }

  return -1;
}

/** An object literal reduced to the text of its own keys. */
function topLevelOf({
  literal,
  isCode,
}: {
  literal: string;
  isCode: boolean[];
}): string {
  let depth = 0;
  let kept = "";

  for (let index = 0; index < literal.length; index++) {
    const change = isCode[index] ? braceDepthChange(literal[index]) : 0;
    if (change !== 0) {
      depth += change;
      continue;
    }
    if (depth === 1) kept += literal[index];
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
