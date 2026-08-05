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
 * Rule 2 has a backlog. Thirty-nine files predated the rule, and rewriting them all at
 * once would be a worse change than the one it fixes. They are named below, and
 * the list is a ratchet: a file not on it fails, and a file on it that no longer
 * needs to be fails too, so the list can only shrink. Nothing new gets in.
 */
import { readdirSync, readFileSync } from "node:fs";
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
const DRIVER_MODULE = /from\s+["']@clickhouse\/client["']/;

/** The functions that hand out a live client. */
const RESOLVES_CLIENT =
  /\b(getClickHouseClientForProject|getClickHouseClientForOrganization|getSharedClickHouseClient|getAllClickHouseInstances)\b/;

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
  "src/server/event-sourcing/replay/replayPreset.ts",
]);

/**
 * Allowed to construct.
 *
 * `managedClient.ts` is the one construction site. The other three are
 * infrastructure rather than the tenant data path, and each needs a client the
 * managed one deliberately is not:
 *
 *  - `goose.ts` runs migrations on a client it opens and closes per call, from
 *    a URL that is not the application's.
 *  - `ttlReconciler.ts` reconciles storage policy the same way, per run.
 *  - `ops/explain-core.ts` connects as `langwatch_ops` under a readonly
 *    profile that rejects every client-side setting, including the
 *    `date_time_input_format` the managed client always sends.
 *
 * None of them read tenant rows, so none of them belong behind a repository.
 */
const MAY_CONSTRUCT = new Set([
  "src/server/clickhouse/managedClient.ts",
  "src/server/clickhouse/goose.ts",
  "src/server/clickhouse/ttlReconciler.ts",
  "src/server/ops/explain-core.ts",
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
const RESOLVES_DIRECTLY_BACKLOG = new Set([
  "ee/billing/services/billableEventsQuery.ts",
  "ee/governance/routers/governance.ts",
  "ee/governance/services/activity-monitor/activityMonitor.service.ts",
  "ee/governance/services/cliBootstrap.service.ts",
  "ee/governance/services/governanceOcsfExport.service.ts",
  "ee/governance/services/personalUsage.service.ts",
  "ee/governance/services/pullers/pullerWorker.ts",
  "ee/governance/services/quarantineFillEvaluator.service.ts",
  "ee/governance/services/setupState.service.ts",
  "ee/governance/services/spendSpikeAnomalyEvaluator.service.ts",
  "src/app/api/gateway-spend/[[...route]]/app.ts",
  "src/app/api/webhooks/[[...route]]/app.ts",
  "src/server/analytics/clickhouse/clickhouse-analytics.service.ts",
  "src/server/api/routers/gatewaySpendEvents.ts",
  "src/server/api/routers/user.ts",
  "src/server/app-layer/analytics/analytics.service.ts",
  "src/server/app-layer/automations/graph-trigger-heartbeat.ts",
  "src/server/app-layer/topic-clustering/clustering.ts",
  "src/server/collectUsageStats.ts",
  "src/server/evaluations/evaluation.service.ts",
  "src/server/experiments-v3/services/experiment-run.service.ts",
  "src/server/routes/gateway-internal.ts",
  "src/server/routes/ingest/ingestionRoutes.ts",
  "src/server/routes/ops.ts",
  "src/server/stored-objects/stored-objects-cross-tenant-lookup.ts",
  "src/server/traces/clickhouse-trace.service.ts",
  "src/server/workers/startWorkers.ts",
]);

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "__tests__",
  "__mocks__",
  ".next",
  "dist",
]);

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

function scan(): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const root of ROOTS) {
    for (const absolute of walk(join(PACKAGE_ROOT, root))) {
      const source = readFileSync(absolute, "utf8");
      const constructs =
        DRIVER_MODULE.test(source) && CONSTRUCTS_CLIENT.test(source);
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
  return files;
}

describe("the ClickHouse client access boundary", () => {
  const scanned = scan();

  it("finds server code to check, so a broken walk cannot pass silently", () => {
    expect(scanned.length).toBeGreaterThan(20);
  });

  describe("when a file builds a ClickHouse client", () => {
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
      const stale = [...MAY_CONSTRUCT].filter(
        (path) => !constructors.has(path),
      );

      expect(
        stale,
        "These are allowed to build a client but no longer do. Remove them from MAY_CONSTRUCT.",
      ).toEqual([]);
    });
  });

  describe("when a file resolves a ClickHouse client", () => {
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
      const resolvers = new Set(
        scanned.filter((file) => file.resolves).map((file) => file.path),
      );
      const stale = [...RESOLVES_DIRECTLY_BACKLOG].filter(
        (path) => !resolvers.has(path),
      );

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
      const users = new Set(
        scanned.filter((file) => file.resolvesViaApp).map((file) => file.path),
      );
      const stale = [...MAY_RESOLVE_VIA_APP].filter((path) => !users.has(path));

      expect(
        stale,
        "These no longer take the resolver from the App. Remove them from MAY_RESOLVE_VIA_APP.",
      ).toEqual([]);
    });
  });
});
