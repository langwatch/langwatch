/**
 * @vitest-environment node
 *
 * @see specs/server/redis-client-ownership.feature
 * @see dev/docs/adr/093-redis-is-an-owned-client.md
 *
 * The ownership half of ADR-093: the App holds the process's one connection,
 * hands it out, and closes it — and no module in the tree keeps one of its own.
 *
 * The two source guards below are the ones that keep the decision true over
 * time. Everything else in this change is a one-off migration; a new
 * `export const connection = new IORedis(...)` would quietly undo it, and only
 * a scan notices.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { App, getApp, globalForApp, resetApp } from "../app";
import { createTestApp } from "../presets";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `platform/app/` — parent of `src/` and of the `ee/` tree. */
const APP_ROOT = path.resolve(HERE, "../../../..");
/** Repo root — where the `packages/*` workspace tree lives (ADR-076). */
const REPO_ROOT = path.resolve(APP_ROOT, "../..");

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
]);

/**
 * Every way an ioredis client gets constructed.
 *
 * The trailing member access is what catches `new IORedis.Cluster(nodes)`,
 * which a default import reaches without ever naming `Cluster` — the one
 * spelling a bare `new (IORedis|Redis|Cluster)(` misses. Kept as a named
 * constant so the test below can check the pattern itself: a gap here does not
 * fail loudly, it just scans and finds nothing.
 */
const IOREDIS_CONSTRUCTION =
  /\bnew\s+(?:IORedis|Redis|Cluster)(?:\s*\.\s*\w+)*\s*\(/;

/**
 * Any reference to the retired singleton module, whatever names it.
 *
 * Anchored on the quoted specifier rather than on a leading `from`, because the
 * reference that outlived the first migration was a `vi.mock("~/server/redis")`
 * in a suite merged from main — which an import-only pattern reads straight
 * past. A mock of a module that no longer resolves fails the suite at load, so
 * this guard is what turns that into one legible failure here.
 */
const RETIRED_REDIS_MODULE =
  /["'][^"']*(?:~\/server\/redis|\.\.\/redis|\.\/redis)["']/;

/**
 * Standalone operational scripts that run their own process and legitimately
 * own their Redis connection. Each entry is relative to the repo root.
 *
 * Adding a path here is an explicit decision — the reviewer sees it in the
 * diff and can ask whether the script really needs a standalone client.
 */
const STANDALONE_SCRIPT_ALLOWLIST = new Set([
  "platform/app/scripts/_dogfood_cli_mint_demo.ts",
  "platform/app/scripts/dogfood/governance/sergey-relogin-as.ts",
]);
/**
 * Directories under `platform/app` that are never source code.
 *
 * This is an ALLOWLIST of exclusions — anything NOT listed here and not
 * dot-prefixed (`.git`, `.next`, etc.) IS scanned. Adding a directory to
 * dodge the guard requires updating the snapshot assertion below, which is
 * the point.
 */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".next",
  ".next-saas",
  "coverage",
  "public",
]);

function shouldDescend(entry: fs.Dirent): boolean {
  return (
    entry.isDirectory() &&
    !entry.name.startsWith(".") &&
    !SKIP_DIRECTORIES.has(entry.name)
  );
}

function isSourceFile(entry: fs.Dirent): boolean {
  return (
    entry.isFile() &&
    !entry.name.startsWith(".") &&
    SOURCE_EXTENSIONS.has(path.extname(entry.name))
  );
}

function* walkSourceFiles(root: string): Generator<string> {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (shouldDescend(entry)) yield* walkSourceFiles(full);
    else if (isSourceFile(entry)) yield full;
  }
}

/** Every source file in the app tree plus the workspace packages. */
function allSourceFiles(): string[] {
  return [
    ...walkSourceFiles(APP_ROOT),
    ...walkSourceFiles(path.join(REPO_ROOT, "packages")),
  ];
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file);
}

function isTestFile(file: string): boolean {
  return (
    file.includes(`${path.sep}__tests__${path.sep}`) ||
    /\.(test|spec)\.[cm]?tsx?$/.test(file) ||
    file.includes(`${path.sep}test-utils${path.sep}`)
  );
}

function fakeConnection() {
  return { disconnect: vi.fn() } as unknown as NonNullable<App["redis"]>;
}

describe("Redis ownership", () => {
  describe("given an application configured with Redis", () => {
    /** @scenario The composition root exposes the connection it created */
    it("hands back the very connection it was built with", () => {
      const connection = fakeConnection();

      const app = createTestApp({ redis: connection });

      expect(app.redis).toBe(connection);
    });

    /** @scenario Closing the application closes the connection */
    it("disconnects it on close", async () => {
      const connection = fakeConnection();
      // The composition root registers the connection as a graceful closeable;
      // this asserts the App honours that registration, which is what stops a
      // process from leaking a socket per boot.
      const app = new App({
        ...(createTestApp({
          redis: connection,
        }) as unknown as ConstructorParameters<typeof App>[0]),
        redis: connection,
        _gracefulCloseables: [
          {
            name: "redis",
            close: async () => {
              connection.disconnect();
            },
          },
        ],
      });

      await app.close();

      expect(connection.disconnect).toHaveBeenCalledOnce();
    });
  });

  describe("given an application configured without Redis", () => {
    /** @scenario An application without Redis exposes no client */
    it("exposes no client", () => {
      expect(createTestApp().redis).toBeNull();
    });

    /** @scenario A consumer degrades when the application has no Redis */
    it("lets a consumer take its documented fallback rather than throwing", async () => {
      const previous = globalForApp.__langwatch_app;
      globalForApp.__langwatch_app = createTestApp();
      try {
        const { consumeEmailCapSlot } = await import(
          "../automations/dispatch/emailCaps"
        );

        // The hourly cap's fallback is a per-worker in-memory counter: the
        // dispatch is still decided, it is just no longer decided fleet-wide.
        const decision = await consumeEmailCapSlot({
          projectId: `proj-${Math.random().toString(36).slice(2)}`,
          triggerId: "trigger-1",
          now: new Date("2026-08-10T12:00:00.000Z"),
          cap: 5,
          dedupKey: `dedup-${Math.random().toString(36).slice(2)}`,
        });

        expect(decision).toMatchObject({ allowed: true, count: 1 });
      } finally {
        globalForApp.__langwatch_app = previous;
      }
    });
  });

  describe("given a service that needs Redis", () => {
    /** @scenario A service receives its connection as a dependency */
    it("uses the connection its caller supplied, with no App in play", async () => {
      await resetApp();
      const smembers = vi.fn().mockResolvedValue([]);
      const { CliTokenRevocationService } = await import(
        "@ee/governance/services/cliTokenRevocation.service"
      );

      const service = CliTokenRevocationService.create({
        smembers,
      } as never);
      const result = await service.revokeForUser({ userId: "user-1" });

      expect(smembers).toHaveBeenCalledOnce();
      expect(result).toEqual({ revokedCount: 0 });
      // Proves the connection came from the caller: `getApp()` would have
      // thrown, because nothing initialized an App.
      expect(() => getApp()).toThrow(/App not initialized/);
    });
  });

  describe("given a request handler that needs Redis", () => {
    /** @scenario A request handler resolves the connection when it runs */
    it("resolves nothing at import and the App's connection when called", async () => {
      await resetApp();

      // Importing must not need an App — that is the whole point of retiring
      // the module-level singleton.
      const { checkLangyMessageRateLimit } = await import(
        "../../middleware/rate-limit-langy"
      );

      const incr = vi.fn().mockResolvedValue(1);
      const expire = vi.fn().mockResolvedValue(1);
      const previous = globalForApp.__langwatch_app;
      globalForApp.__langwatch_app = createTestApp({
        redis: { incr, expire } as never,
      });
      try {
        await checkLangyMessageRateLimit({
          userId: "user-1",
          projectId: "project-1",
        });
      } finally {
        globalForApp.__langwatch_app = previous;
      }

      expect(incr).toHaveBeenCalledOnce();
    });
  });

  describe("given the platform source tree", () => {
    /** @scenario The retired singleton module is gone */
    it("has no module exporting a ready-made Redis connection", () => {
      expect(fs.existsSync(path.join(APP_ROOT, "src/server/redis.ts"))).toBe(
        false,
      );

      const referrers = allSourceFiles()
        // This file is the one legitimate exception: the fixtures below have to
        // spell the retired specifier out to prove the pattern still catches it.
        .filter((file) => file !== fileURLToPath(import.meta.url))
        .filter((file) =>
          RETIRED_REDIS_MODULE.test(fs.readFileSync(file, "utf8")),
        );

      expect(referrers.map(relative)).toEqual([]);
    });

    /** @scenario Nothing constructs a Redis client outside the client package */
    it("constructs ioredis clients only inside the client package or a test", () => {
      const clientPackage = path.join(REPO_ROOT, "packages/redis-client");

      const offenders = allSourceFiles()
        .filter((file) => !file.startsWith(clientPackage))
        .filter((file) => !isTestFile(file))
        .filter((file) => !STANDALONE_SCRIPT_ALLOWLIST.has(relative(file)))
        .filter((file) =>
          IOREDIS_CONSTRUCTION.test(fs.readFileSync(file, "utf8")),
        );

      expect(offenders.map(relative)).toEqual([]);
    });

    it("recognises every spelling of an ioredis construction", () => {
      // The guard above can only be as good as this pattern, and a miss here is
      // silent: the scan finds nothing and reports success. `new IORedis.Cluster()`
      // is the spelling that slipped — reachable from a default import alone,
      // with no `Cluster` in the import list to notice.
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
        // The client package's services are the sanctioned way to reach Redis,
        // and every converted consumer spells one `new Redis…` — one character
        // of slack in the pattern above would flag the whole platform.
        "new RedisConnectionService({ logger }).connect(env)",
        "new RedisConfigService().isConfigured(env)",
        "new RedisReadinessService({ logger })",
      ]) {
        expect(IOREDIS_CONSTRUCTION.test(innocent)).toBe(false);
      }
    });

    /** @scenario The source guard scans every directory under platform/app */
    it("walks all of platform/app, not just src and ee", () => {
      const files = allSourceFiles();
      const relFiles = files.map(relative);

      // Directories that the old walker missed and that contain source files
      // must now appear. (vendor/ and specs/ are also walked but contain no
      // files matching SOURCE_EXTENSIONS, so they produce no results.)
      for (const directory of ["scripts", "e2e"]) {
        expect(
          relFiles.some((f) => f.startsWith(`platform/app/${directory}/`)),
          `expected files from platform/app/${directory}/`,
        ).toBe(true);
      }

      // vendor/ and specs/ are NOT in SKIP_DIRECTORIES — the walker enters
      // them — but they contain no source files today.
      expect(SKIP_DIRECTORIES.has("vendor")).toBe(false);
      expect(SKIP_DIRECTORIES.has("specs")).toBe(false);
    });

    /** Part of @scenario The source guard scans every directory under platform/app */
    it("excludes only the pinned allowlist of directories", () => {
      expect([...SKIP_DIRECTORIES].sort()).toEqual([
        ".next",
        ".next-saas",
        "coverage",
        "dist",
        "node_modules",
        "public",
      ]);
    });

    /** @scenario The source guard scans JavaScript files alongside TypeScript */
    it("includes .js, .mjs, and .cjs files in the scan", () => {
      const files = allSourceFiles().map(relative);

      // These three files exist under src/ and were previously invisible.
      expect(files).toContain("platform/app/src/env.mjs");
      expect(files).toContain("platform/app/src/env-create.mjs");
      expect(files).toContain("platform/app/src/noop-css.cjs");
    });

    /** @scenario Standalone operational scripts that own their process are allowlisted */
    it("allowlists standalone scripts that all exist on disk", () => {
      for (const rel of STANDALONE_SCRIPT_ALLOWLIST) {
        expect(
          fs.existsSync(path.join(REPO_ROOT, rel)),
          `allowlisted script missing: ${rel}`,
        ).toBe(true);
      }
    });

    it("recognises every spelling of a reference to the retired module", () => {
      // The same silent-miss risk as above, and it has already bitten once: an
      // import-anchored pattern let a `vi.mock` of the deleted module through.
      for (const spelling of [
        'import { connection } from "~/server/redis";',
        'vi.mock("~/server/redis", () => ({ connection: undefined }));',
        'from "../redis"',
        "from './redis'",
        'await import("~/server/redis")',
      ]) {
        expect(RETIRED_REDIS_MODULE.test(spelling)).toBe(true);
      }

      for (const innocent of [
        'from "@langwatch/redis-client"',
        'from "./redis-client"',
        // How this suite names the deleted file when asserting it is gone.
        'path.join(APP_ROOT, "src/server/redis.ts")',
      ]) {
        expect(RETIRED_REDIS_MODULE.test(innocent)).toBe(false);
      }
    });
  });
});
