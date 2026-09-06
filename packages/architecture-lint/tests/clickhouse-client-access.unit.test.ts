import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Keeps ClickHouse behind one client and one door. Two rules, for the same
 * reason: a policy is only worth adding to the client if no caller can be
 * holding one that missed it.
 */

// 1. CONSTRUCTION. `createClient` is called only where a process builds its
//    own infrastructure, or where a task needs a second identity. A client
//    built elsewhere opts out of the pool, the statement limit, the retries,
//    the logging and the metrics.

// 2. ACCESS. A client is reached through a repository the composition root
//    handed the process's resolver to. Services, transports, processes and
//    projections take the repository; they do not resolve a client and write
//    SQL. That is what makes a repository the place tenant scoping, windowed
//    reads and query shape can be enforced at all.

// Main enforced a third rule — an allowlist over the exports of the one module
// that handed out a resolver — and this layout has no subject for it: a
// resolver is a typed parameter, so rule 2 already sees every holder.

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Both trees that ship application code. */
const ROOTS = ["packages", "apps"];

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".next",
  "__tests__",
  "__mocks__",
  // A package's own test seam, which stands up throwaway endpoints and never
  // reads tenant rows as the application.
  "testing",
  "test-utils",
]);

/**
 * Only the driver's own construction call is a client. `import type
 * { ClickHouseClient }` is a type and appears in dozens of files that build
 * nothing, so matching the module alone would flag all of them.
 */
const CONSTRUCTS_CLIENT = /\bcreateClient\s*\(/;
/** Any entrypoint of the driver package: `/web` constructs the same client. */
const DRIVER_MODULE = /from\s+["']@clickhouse\/client(?:\/[^"']+)?["']/;

/** Calling a resolver is holding a live client, whatever the resolver is named. */
const RESOLVES_CLIENT =
  /\b(?:resolveClient|resolveOrganizationClient|resolveTenantClient)\s*\(|\bgetClickHouseClientForTenant\b|\bgetSharedClickHouseClient\b/;

/**
 * Allowed to construct. Each opens a client the managed one deliberately is
 * not, and none reads tenant rows as the application.
 */

// - the two process infrastructures build the managed client itself, and the
//   task host builds the one its one-shot programs run on.
// - `goose.migration-runner` and `ttl.reconciler` run per call against a URL
//   that is not the application's.

// - the LangWatchQL executor and its provisioning task authenticate as the
//   restricted LangWatchQL identity, whose limits are server-side.
// - the ops EXPLAIN adapter connects as `langwatch_ops` under a readonly
//   profile that rejects the client-side settings the managed client sends.
const MAY_CONSTRUCT = new Set([
  "apps/api/src/platform/infrastructure/api-clickhouse.infrastructure.ts",
  "apps/worker/src/platform/infrastructure/worker-clickhouse.infrastructure.ts",
  "apps/tasks/src/platform/tasks-host.composition.ts",
  "packages/clickhouse-client/src/tasks/goose.migration-runner.ts",
  "packages/clickhouse-client/src/tasks/ttl.reconciler.ts",
  "packages/features/analytics/server/src/adapters/clickhouse.langwatch-ql-executor.adapter.ts",
  "packages/features/analytics/server/src/tasks/lwql-provision.task.ts",
  "packages/features/ops/server/src/adapters/ops-clickhouse-explain.adapter.ts",
  "packages/test-harness/src/clickhouse-test-endpoints.ts",
]);

/**
 * Allowed to hold a resolved client, by shape rather than by name: the
 * ClickHouse client package, repositories, adapters, the port modules that
 * only DECLARE a resolver's type, event stores, and composition roots.
 */
function mayResolveByLocation(path: string): boolean {
  return (
    path.startsWith("packages/clickhouse-client/") ||
    path.includes("/repositories/") ||
    path.includes("/adapters/") ||
    path.includes("/stores/") ||
    path.endsWith(".repository.ts") ||
    path.endsWith(".adapter.ts") ||
    path.endsWith(".port.ts") ||
    path.endsWith(".composition.ts") ||
    path.endsWith(".mount.ts")
  );
}

/**
 * The backlog: files that hold a client and predate the rule. Each wants the
 * query moved into a repository the caller takes from the composition root.
 */

// A ratchet: a file not on it fails, and a file on it that no longer needs to
// be fails too, so it can only shrink. Nothing new gets in.
const RESOLVES_DIRECTLY_BACKLOG = new Set<string>([]);

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
}

/** One pass over both trees, reading each file once. */

// Regular expressions over source rather than a type-aware walk, deliberately:
// both questions are answered by the text of an import and a call, and a
// compiler session over eight thousand files would cost minutes to answer what
// this scan answers in a second (ADR-099).
function scan(): { files: ScannedFile[]; walked: number } {
  const files: ScannedFile[] = [];
  let walked = 0;
  for (const root of ROOTS) {
    for (const absolute of walk(join(ROOT, root))) {
      walked += 1;
      const source = readFileSync(absolute, "utf8");
      const constructs = DRIVER_MODULE.test(source) && CONSTRUCTS_CLIENT.test(source);
      const resolves = RESOLVES_CLIENT.test(source);
      if (!constructs && !resolves) continue;
      files.push({
        // POSIX separators so the sets read the same on every platform.
        path: relative(ROOT, absolute).split(/[\\/]/).join("/"),
        constructs,
        resolves,
      });
    }
  }
  return { files, walked };
}

describe("the ClickHouse client access boundary", () => {
  const { files: scanned, walked } = scan();

  // Counts the files READ, not the files matched: the matched count is the
  // backlog, and asserting on that would turn finishing the work into a
  // failing test. Without this canary a walk that silently reads nothing —
  // a moved directory, a renamed root — passes every rule below.
  it("reads both application trees, so a broken walk cannot pass silently", () => {
    expect(walked).toBeGreaterThan(5000);
    expect(scanned.length).toBeGreaterThan(20);
  });

  describe("when a file builds a ClickHouse client", () => {
    it("is one of the named construction sites", () => {
      const offenders = scanned
        .filter((file) => file.constructs && !MAY_CONSTRUCT.has(file.path))
        .map((file) => file.path);

      expect(
        offenders,
        "Build ClickHouse clients only where a process composes its infrastructure. " +
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

  describe("when a file holds a resolved ClickHouse client", () => {
    /** @scenario "ClickHouse is reached through a repository, from the application object" */
    it("is a repository, an adapter, or the composition root that wires one", () => {
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
        "Reach ClickHouse through a repository the composition root handed the resolver to, " +
          "not by resolving a client here. A service that holds a client is a service that " +
          "writes SQL, and tenant scoping and windowed reads then have nowhere to live.",
      ).toEqual([]);
    });

    it("keeps the backlog shrinking, never growing", () => {
      const resolvers = new Set(scanned.filter((file) => file.resolves).map((file) => file.path));
      const stale = [...RESOLVES_DIRECTLY_BACKLOG].filter((path) => !resolvers.has(path));

      expect(
        stale,
        "These files no longer hold a resolved client. Delete them from RESOLVES_DIRECTLY_BACKLOG.",
      ).toEqual([]);
    });
  });
});
