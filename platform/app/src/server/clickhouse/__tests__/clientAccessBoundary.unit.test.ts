/**
 * Keeps ClickHouse behind one client and one door.
 *
 * Two rules, and they exist for the same reason: a policy is only worth adding
 * to the client if no caller can be holding one that missed it.
 *
 *  1. CONSTRUCTION. `createClient` from the driver is called in exactly one
 *     place, `managedClient.ts`, which assembles the pool, the statement limit,
 *     the retries, the logging and the metrics in one order. Build a client
 *     anywhere else and it silently opts out of all of them - which is how a
 *     private-instance client ran on the driver's default pool of 10 with
 *     nothing bounding its statements, for as long as nobody looked.
 *
 *  2. ACCESS. A client is reached through a repository that `getApp()` hands
 *     out. Services, routers, routes and workers ask the repository; they do
 *     not resolve a client and write SQL. That is what makes a repository the
 *     place tenant scoping, windowed reads and query shape can be enforced at
 *     all, instead of a convention forty files are free to ignore.
 *
 * Rule 2 has a backlog: the files that predated the rule, which rewriting all at
 * once would be a worse change than the one it fixes. They are named below, and
 * the list is a ratchet: a file not on it fails, and a file on it that no longer
 * needs to be fails too, so the list can only shrink. Nothing new gets in.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Both trees that ship server code. `ee/` is where a third of the callers live. */
const ROOTS = ["src", "ee"];

/**
 * Only the driver's own construction call is a client. A `import type
 * { ClickHouseClient }` is a type and appears in dozens of files that never
 * build anything, so matching the module alone would flag all of them.
 */
const CONSTRUCTS_CLIENT = /\bcreateClient\s*\(/;
// Any entrypoint of the driver package, not just the root: a
// `@clickhouse/client/web` import constructs exactly the same client.
const DRIVER_MODULE = /from\s+["']@clickhouse\/client(?:\/[^"']+)?["']/;

/** The functions that hand out a live client. */
const RESOLVES_CLIENT =
  /\b(getClickHouseClientForTenant|getClickHouseClientForOrganization|getSharedClickHouseClient|getAllClickHouseInstances)\b/;

/**
 * A shared exported resolver is the same escape hatch again, one import away
 * from anywhere: `clickhouseClient.ts` once exported one, and four files held
 * a client through it without ever naming a function above. The resolver TYPE
 * is exported and a resolver VALUE is not - the one value is built in
 * `presets.ts` and travels by injection.
 *
 * Enforced as an exhaustive list of the module's VALUE exports rather than by
 * matching a type annotation, because the thing being kept out does not need
 * one: `export const resolveClient = async (tenantId: string) => ...` is
 * structurally a resolver with nothing to match on. Anything this module
 * exports that is not named below fails, which makes adding an export a
 * decision somebody takes here, in front of the rule, instead of a line that
 * slips past a pattern. Type exports are not listed - a type cannot hold a
 * client.
 */
const CLIENT_MODULE = "src/server/clickhouse/clickhouseClient.ts";

const CLIENT_MODULE_VALUE_EXPORTS = new Set([
  "getClickHouseClientForTenant",
  "configureClickHouseRuntime",
  "getClickHouseClientForOrganization",
  "getAllClickHouseInstances",
  "isClickHouseEnabled",
  "shutdownClickHouseConnections",
  "shutdownComposedClickHouseRuntime",
  "clearCustomClientCache",
  "getCustomClientCacheSize",
  "clearTenantOrgCache",
  "getPrivateClickHouseUrls",
  "_getSharedClickHouseClient",
  "AppClickHouseRuntime",
]);

/**
 * Every value-export form, named so the allowlist can be compared against it.
 *
 * `export default` and `export * from` cannot carry a name the list could
 * hold, so they are reported as themselves and always fail - which is the
 * right answer for this module either way: both are ways to re-export a
 * resolver that no by-name list can see.
 *
 * Every pattern allows leading whitespace. A top-level export is at column 1
 * today, but a rule that reads "everything this module exports" must not be
 * one reformatting away from missing one.
 */
function valueExportsOf(source: string): string[] {
  return [...unnamedExportsOf(source), ...declarationExportsOf(source), ...braceExportsOf(source)];
}

/** `export default x` and `export * from "..."` - neither carries a name. */
function unnamedExportsOf(source: string): string[] {
  const stars = [
    ...source.matchAll(
      /^[ \t]*export\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*["']([^"']+)["']/gm,
    ),
  ].map((match) => `* from "${match[1]}"`);
  return /^[ \t]*export\s+default\b/m.test(source) ? ["default", ...stars] : stars;
}

/** `export function x`, `export const x`, `export class x`, and friends. */
function declarationExportsOf(source: string): string[] {
  return [
    ...source.matchAll(
      /^[ \t]*export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm,
    ),
  ].map((match) => match[1]!);
}

/** `export { a, b as c }`, with or without a `from`. Skips `type` clauses. */
function braceExportsOf(source: string): string[] {
  return [...source.matchAll(/^[ \t]*export\s*\{([^}]*)\}/gm)]
    .flatMap((block) => block[1]!.split(","))
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && !clause.startsWith("type "))
    .map((clause) => {
      const parts = clause.split(/\s+as\s+/);
      return (parts[1] ?? parts[0] ?? "").trim();
    })
    .filter((name) => name.length > 0);
}

/**
 * `getApp().clickhouse.resolveClient` is the same escape hatch wearing the
 * App's clothes: it hands back a live client, and the names above cannot see
 * it. Without this it would satisfy the rule while defeating it.
 *
 * It exists because two call sites legitimately build repositories outside the
 * composition root, and sharing one resolution policy beats each re-deriving
 * its own closure. That is a narrow allowance, not a general one, so the files
 * permitted to use it are named - it is exactly as bounded as the backlog, and
 * shrinks the same way.
 */
const RESOLVES_VIA_APP = /getApp\(\)\s*\.\s*clickhouse\s*\.\s*resolveClient/;

const MAY_RESOLVE_VIA_APP = new Set([
  "src/server/traces/trace-blob-resolution.deps.ts",
  "src/runtime/app/replay-runtime.adapter.ts",
]);

/**
 * Allowed to construct.
 *
 * `managedClient.ts` is the one construction site. The other three are
 * infrastructure rather than the tenant data path, and each needs a client the
 * managed one deliberately is not (`test-utils` makes five: it stands up and
 * tears down throwaway endpoints, and never touches tenant data at all):
 *
 *  - `goose.ts` runs migrations on a client it opens and closes per call, from
 *    a URL that is not the application's.
 *  - `ttlReconciler.ts` reconciles storage policy the same way, per run.
 *  - `ops/explain-core.ts` connects as `langwatch_ops` under a readonly
 *    profile that rejects every client-side setting, including the
 *    `date_time_input_format` the managed client always sends.
 *  - `analytics/lwql/executor.ts` authenticates as the restricted
 *    LangWatchQL identity, whose server-side profile carries the limits the
 *    managed client applies client-side; the managed constructor cannot carry
 *    a second identity's credentials, and must not, or the two pools' policies
 *    would be decided in one another's terms.
 *  - `tasks/provisionLwql.ts` provisions the LangWatchQL objects at deploy
 *    time, before the app (and its shared client) exists, on an admin client
 *    it opens and closes per run — the same shape as `goose.ts`, whose
 *    migrations run immediately before it in `start:prepare:db`.
 *
 * None of them read tenant rows as the application, so none of them belong
 * behind a repository.
 */
const MAY_CONSTRUCT = new Set([
  "src/server/clickhouse/managedClient.ts",
  "src/server/clickhouse/goose.ts",
  "src/server/clickhouse/ttlReconciler.ts",
  "src/server/ops/explain-core.ts",
  "src/server/analytics/lwql/executor.ts",
  "src/tasks/provisionLwql.ts",
  "src/test-utils/clickhouseTestEndpoints.ts",
]);

/**
 * Allowed to resolve a client, by shape rather than by name: the ClickHouse
 * infrastructure itself, any repository, and the app-layer wiring that
 * constructs repositories and hands them to the App.
 */
function mayResolveByLocation(path: string): boolean {
  return (
    path.startsWith("src/server/clickhouse/") ||
    path.startsWith("src/test-utils/") ||
    path.includes("/repositories/") ||
    path.endsWith(".repository.ts") ||
    path === "src/server/app-layer/presets.ts"
  );
}

/**
 * The backlog: files that resolve a client directly and predate the rule.
 *
 * Each one wants the same treatment - the query it runs moves to a repository,
 * the caller takes that repository from `getApp()`. Delete a line when its file
 * is done. Do not add one.
 */
const RESOLVES_DIRECTLY_BACKLOG = new Set<string>([]);

const SKIPPED_DIRECTORIES = new Set(["node_modules", "__tests__", "__mocks__", ".next", "dist"]);

function isScanned(fileName: string): boolean {
  if (!/\.tsx?$/.test(fileName)) return false;
  return !/\.(test|spec)\.tsx?$/.test(fileName);
}

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      yield* walk(join(directory, entry.name));
      continue;
    }
    if (isScanned(entry.name)) yield join(directory, entry.name);
  }
}

interface ScannedFile {
  path: string;
  constructs: boolean;
  resolves: boolean;
  resolvesViaApp: boolean;
}

interface ScanResult {
  files: ScannedFile[];
  /** Every file the walk read, matched or not. The broken-walk canary. */
  walked: number;
}

function scan(): ScanResult {
  const files: ScannedFile[] = [];
  let walked = 0;
  for (const root of ROOTS) {
    if (!existsSync(join(PACKAGE_ROOT, root))) continue;
    for (const absolute of walk(join(PACKAGE_ROOT, root))) {
      walked += 1;
      const source = readFileSync(absolute, "utf8");
      const constructs = DRIVER_MODULE.test(source) && CONSTRUCTS_CLIENT.test(source);
      const resolves = RESOLVES_CLIENT.test(source);
      const resolvesViaApp = RESOLVES_VIA_APP.test(source);
      if (!constructs && !resolves && !resolvesViaApp) continue;
      files.push({
        // POSIX separators so the sets read the same on every platform.
        path: relative(PACKAGE_ROOT, absolute).split(/[\\/]/).join("/"),
        constructs,
        resolves,
        resolvesViaApp,
      });
    }
  }
  return { files, walked };
}

/**
 * The module the export rule above is written against, in every form it has
 * to see. The rule is only worth having if the reader cannot slip an export
 * past it, so the reader is exercised rather than assumed.
 */
const EVERY_EXPORT_FORM = [
  "  export default resolveClient;",
  '  export * from "./more-resolvers";',
  '\texport * as clients from "./clients";',
  "  export const inferredResolver = async (tenantId: string) => tenantId;",
  "export async function getClickHouseClientForTenant(id: string) {}",
  'export { _shared as getSharedClickHouseClient } from "./client";',
  "export type ClickHouseClientResolver = (id: string) => Promise<Client>;",
  "export interface Unrelated { a: string }",
].join("\n");

describe("the ClickHouse client access boundary", () => {
  const { files: scanned, walked } = scan();

  describe("when a module's exports are read", () => {
    it("finds every value-export form, indented or not", () => {
      expect(valueExportsOf(EVERY_EXPORT_FORM)).toEqual([
        "default",
        '* from "./more-resolvers"',
        '* from "./clients"',
        "inferredResolver",
        "getClickHouseClientForTenant",
        "getSharedClickHouseClient",
      ]);
    });

    it("does not mistake a type export for a value", () => {
      expect(valueExportsOf("export type Resolver = () => void;")).toEqual([]);
      expect(valueExportsOf('export { type Foo } from "./t";')).toEqual([]);
    });
  });

  describe("when the client module is read", () => {
    it("exports only the values named here, so no resolver can be added quietly", () => {
      const source = readFileSync(join(PACKAGE_ROOT, CLIENT_MODULE), "utf8");
      const unexpected = valueExportsOf(source).filter(
        (name) => !CLIENT_MODULE_VALUE_EXPORTS.has(name),
      );

      expect(
        unexpected,
        `${CLIENT_MODULE} exports a value this rule has not seen. If it hands back ` +
          "a client, it does not belong here at all: build the one resolver in " +
          "src/server/app-layer/presets.ts and inject it. If it does not, add it to " +
          "CLIENT_MODULE_VALUE_EXPORTS.",
      ).toEqual([]);
    });

    it("keeps that list honest, so a deleted export cannot sit here forever", () => {
      const source = readFileSync(join(PACKAGE_ROOT, CLIENT_MODULE), "utf8");
      const actual = new Set(valueExportsOf(source));
      const stale = [...CLIENT_MODULE_VALUE_EXPORTS].filter((name) => !actual.has(name));

      expect(
        stale,
        "These are listed as exports of the client module but no longer exist. " +
          "Remove them from CLIENT_MODULE_VALUE_EXPORTS.",
      ).toEqual([]);
    });
  });

  // Counts the files READ, not the files matched. The matched count is the
  // backlog, and the backlog is meant to reach zero - asserting on it would
  // turn finishing this work into a failing test.
  it("reads the server tree, so a broken walk cannot pass silently", () => {
    expect(walked).toBeGreaterThan(1000);
  });

  describe("when a file builds a ClickHouse client", () => {
    /** @scenario a new bypass cannot be introduced unnoticed */
    it("is one of the named construction sites", () => {
      const offenders = scanned
        .filter((file) => file.constructs && !MAY_CONSTRUCT.has(file.path))
        .map((file) => file.path);

      expect(
        offenders,
        "Build ClickHouse clients only in src/server/clickhouse/managedClient.ts. " +
          "A client built elsewhere has no statement limit, no retry policy and no metrics.",
      ).toEqual([]);
    });

    it("keeps every named construction site real", () => {
      const constructors = new Set(
        scanned.filter((file) => file.constructs).map((file) => file.path),
      );
      const stale = [...MAY_CONSTRUCT].filter((path) => !constructors.has(path));

      expect(
        stale,
        "These are allowed to build a client but no longer do. Remove them from MAY_CONSTRUCT.",
      ).toEqual([]);
    });
  });

  describe("when a file resolves a ClickHouse client", () => {
    /** @scenario ClickHouse is reached through a repository, from the application object */
    it("is a repository, the app-layer wiring, or a known backlog entry", () => {
      const offenders = scanned
        .filter(
          (file) =>
            file.resolves &&
            !mayResolveByLocation(file.path) &&
            !RESOLVES_DIRECTLY_BACKLOG.has(file.path),
        )
        .map((file) => file.path);

      expect(
        offenders,
        "Reach ClickHouse through a repository obtained from getApp(), not by resolving a client. " +
          "Move the query into a repository under app-layer and take that repository from the App.",
      ).toEqual([]);
    });

    it("keeps the backlog shrinking, never growing", () => {
      const resolvers = new Set(scanned.filter((file) => file.resolves).map((file) => file.path));
      const stale = [...RESOLVES_DIRECTLY_BACKLOG].filter((path) => !resolvers.has(path));

      expect(
        stale,
        "These files no longer resolve a client directly. Delete them from RESOLVES_DIRECTLY_BACKLOG.",
      ).toEqual([]);
    });
  });

  describe("when a file takes the resolver from the App", () => {
    it("is one of the two call sites allowed to", () => {
      const offenders = scanned
        .filter(
          (file) =>
            file.resolvesViaApp &&
            !MAY_RESOLVE_VIA_APP.has(file.path) &&
            !mayResolveByLocation(file.path),
        )
        .map((file) => file.path);

      expect(
        offenders,
        "getApp().clickhouse.resolveClient hands back a live client, so it is the same " +
          "bypass as resolving one directly. Take a repository from the App instead.",
      ).toEqual([]);
    });

    it("keeps that allowance shrinking too", () => {
      const users = new Set(scanned.filter((file) => file.resolvesViaApp).map((file) => file.path));
      const stale = [...MAY_RESOLVE_VIA_APP].filter((path) => !users.has(path));

      expect(
        stale,
        "These no longer take the resolver from the App. Remove them from MAY_RESOLVE_VIA_APP.",
      ).toEqual([]);
    });
  });
});
