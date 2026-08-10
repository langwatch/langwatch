/**
 * @vitest-environment node
 *
 * @see specs/server/redis-client-ownership.feature
 * @see dev/docs/adr/090-redis-is-an-owned-client.md
 *
 * The ownership half of ADR-090: the App holds the process's one connection,
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

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".next",
  ".next-saas",
  "coverage",
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
    ...walkSourceFiles(path.join(APP_ROOT, "src")),
    ...walkSourceFiles(path.join(APP_ROOT, "ee")),
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

      const importers = allSourceFiles().filter((file) =>
        /from\s+["'][^"']*(?:~\/server\/redis|\.\.\/redis|\.\/redis)["']/.test(
          fs.readFileSync(file, "utf8"),
        ),
      );

      expect(importers.map(relative)).toEqual([]);
    });

    /** @scenario Nothing constructs a Redis client outside the client package */
    it("constructs ioredis clients only inside the client package or a test", () => {
      const clientPackage = path.join(REPO_ROOT, "packages/redis-client");

      const offenders = allSourceFiles()
        .filter((file) => !file.startsWith(clientPackage))
        .filter((file) => !isTestFile(file))
        .filter((file) =>
          /\bnew\s+(?:IORedis|Redis|Cluster)\s*\(/.test(
            fs.readFileSync(file, "utf8"),
          ),
        );

      expect(offenders.map(relative)).toEqual([]);
    });
  });
});
