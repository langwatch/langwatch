/**
 * @vitest-environment node
 *
 * @see specs/server/redis-client-ownership.feature
 * @see dev/docs/adr/093-redis-is-an-owned-client.md
 * @see packages/redis-client/README.md — "Guardrails"
 *
 * The ownership half of ADR-093: `packages/redis-client` is the only place an
 * ioredis client gets constructed; every other package or app takes a
 * connection as a dependency instead of building its own.
 *
 * This is the rebuild of
 * `platform/app/src/server/app-layer/__tests__/redis-ownership.unit.test.ts`,
 * which went with the platform application (commit `faaa9ec333`). The
 * App-specific behavioural scenarios in that file (App hands back its
 * connection, closes it, degrades without one) belonged to the deleted `App`
 * class and are not reinstated here; the two SOURCE GUARDS are, because they
 * are what keeps the ownership decision true over time — everything else was
 * a one-off migration check.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { walkFiles } from "../src/files";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PACKAGES_ROOT = join(REPO_ROOT, "packages");
/** The one package allowed to construct an ioredis client. */
const CLIENT_PACKAGE = join(PACKAGES_ROOT, "redis-client") + sep;

/**
 * Every tree the repository writes modules into, not the two the first version
 * of this guard named.
 *
 * Naming trees to walk fails OPEN: fewer files scanned, nothing found, green.
 * That is how two scripts came to construct ioredis directly with CI passing.
 * The end-to-end specs, the build tooling and the development scripts run in
 * the same processes and against the same Redis as everything else, so a
 * connection opened in one of them is the very thing ADR-093 retired.
 */
const SCANNED_ROOTS = ["apps", "packages", "dev", "tools", "mcp", "sdks", "plugins"] as const;

/**
 * Every extension a module can be written in, not just the TypeScript ones.
 *
 * Reading only the TypeScript spellings made the guard's answer depend on a
 * file's extension rather than on what it does: `dev/scripts` holds `.mjs` and
 * `.cjs` modules today, and a `new IORedis(...)` in any of them scanned clean.
 */
const isSourceFile = (file: string): boolean =>
  /\.(?:mts|cts|tsx?|jsx?|mjs|cjs)$/.test(file) && !/\.d\.(?:mts|cts|ts)$/.test(file);

const isTestFile = (file: string): boolean =>
  file.includes(`${sep}__tests__${sep}`) ||
  /\.(test|spec)\.[cm]?tsx?$/.test(file) ||
  file.includes(`${sep}test-utils${sep}`);

/**
 * Every way an ioredis client gets constructed.
 *
 * The trailing member access is what catches `new IORedis.Cluster(nodes)`,
 * which a default import reaches without ever naming `Cluster` — the one
 * spelling a bare `new (IORedis|Redis|Cluster)(` misses. Kept as a named
 * constant so the self-test below can check the pattern itself: a gap here
 * does not fail loudly, it just scans and finds nothing.
 */
const IOREDIS_CONSTRUCTION = /\bnew\s+(?:IORedis|Redis|Cluster)(?:\s*\.\s*\w+)*\s*\(/;

/**
 * Any reference to a retired module-scope singleton, by whatever relative
 * name it was imported under.
 *
 * Anchored on the quoted specifier rather than on a leading `from`, because
 * the reference that outlived the original singleton's removal was a
 * `vi.mock("~/server/redis")` merged from a stale branch — an import-only
 * pattern reads straight past a bare mock call.
 */
const RETIRED_REDIS_MODULE = /["'][^"']*(?:~\/server\/redis|\.\.\/redis|\.\/redis)["']/;

type SourceEntry = { file: string; text: string };

let sourceEntries: SourceEntry[] | undefined;

function allSources(): SourceEntry[] {
  sourceEntries ??= SCANNED_ROOTS.flatMap((root) =>
    walkFiles(join(REPO_ROOT, root), isSourceFile),
  ).map((file) => ({ file, text: readFileSync(file, "utf8") }));
  return sourceEntries;
}

function show(file: string): string {
  return relative(REPO_ROOT, file);
}

describe("Redis ownership", () => {
  describe("given the repository's source trees", () => {
    /** @scenario Nothing constructs a Redis client outside the client package */
    it("constructs ioredis clients only inside the client package or a test", () => {
      const offenders = allSources()
        .filter(({ file }) => !file.startsWith(CLIENT_PACKAGE))
        .filter(({ file }) => !isTestFile(file))
        .filter(({ text }) => IOREDIS_CONSTRUCTION.test(text));

      expect(offenders.map(({ file }) => show(file))).toEqual([]);
    }, 60_000);

    /** @scenario The retired singleton module is gone */
    it("has no reference to a retired ~/server/redis-shaped singleton", () => {
      const referrers = allSources()
        // This file is the one legitimate exception: the fixtures below have
        // to spell the retired specifier out to prove the pattern still
        // catches it.
        .filter(({ file }) => file !== fileURLToPath(import.meta.url))
        .filter(({ text }) => RETIRED_REDIS_MODULE.test(text));

      expect(referrers.map(({ file }) => show(file))).toEqual([]);
    }, 60_000);

    /** @scenario The scan covers every tree and every module extension */
    it("reaches every tree and every extension the repository is written in", () => {
      // The two scans above are only as good as the file list they run over,
      // and a shortfall there is silent in exactly the same way a gap in the
      // patterns is: fewer files, nothing found, green.
      const scanned = new Set(allSources().map(({ file }) => show(file)));
      const reached = (directory: string) =>
        [...scanned].some((file) => file.startsWith(directory));

      for (const directory of [
        "apps/api/",
        "apps/worker/",
        "apps/ui/e2e/",
        "apps/ui/vite/",
        "dev/scripts/",
        "packages/",
      ]) {
        expect(reached(directory), `nothing scanned under ${directory}`).toBe(true);
      }

      // Concrete non-TypeScript modules, so the extension set cannot quietly
      // shrink back to the TypeScript spellings. Asserting the constant against
      // a copy of itself would check nothing.
      expect(scanned.has("dev/scripts/check-queue.mjs")).toBe(true);
      expect(scanned.has("dev/scripts/die-with-parent.cjs")).toBe(true);

      // And the exclusions still hold, or the scan is reading dependencies.
      for (const file of scanned) {
        expect(file).not.toContain(`${sep}node_modules${sep}`);
      }
    }, 60_000);

    it("recognises every spelling of an ioredis construction", () => {
      // The guard above can only be as good as this pattern, and a miss here
      // is silent: the scan finds nothing and reports success. `new
      // IORedis.Cluster()` is the spelling that slipped in the original guard
      // — reachable from a default import alone, with no `Cluster` in the
      // import list to notice.
      for (const spelling of [
        "new IORedis(url)",
        "new Redis(url)",
        "new Cluster(nodes)",
        "new IORedis.Cluster(nodes)",
        "new Redis.Cluster(nodes)",
        "new  IORedis\n  .Cluster(nodes)",
      ]) {
        expect(IOREDIS_CONSTRUCTION.test(spelling)).toBe(true);
      }

      for (const innocent of [
        "new RedisLikeThing(url)",
        "renew Redis(url)",
        "createRedisConnection({ env })",
      ]) {
        expect(IOREDIS_CONSTRUCTION.test(innocent)).toBe(false);
      }
    });

    it("recognises every spelling of a reference to the retired module", () => {
      // The same silent-miss risk as above.
      for (const spelling of [
        'import { connection } from "~/server/redis";',
        'vi.mock("~/server/redis", () => ({ connection: undefined }));',
        'from "../redis"',
        "from './redis'",
        'await import("~/server/redis")',
      ]) {
        expect(RETIRED_REDIS_MODULE.test(spelling)).toBe(true);
      }

      for (const innocent of ['from "@langwatch/redis-client"', 'from "./redis-client"']) {
        expect(RETIRED_REDIS_MODULE.test(innocent)).toBe(false);
      }
    });
  });
});
