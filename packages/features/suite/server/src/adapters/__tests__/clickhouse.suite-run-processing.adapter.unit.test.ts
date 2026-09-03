import { describe, expect, it, vi } from "vitest";
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import { ClickHouseSuiteRunProcessingAdapter } from "../clickhouse.suite-run-processing.adapter";
import type { SuiteRunProcessingPipeline } from "../suite-run-processing.adapter";

/**
 * The replication-lag floor `RedisCachedFoldStore` clamps every TTL up to.
 *
 * Restated here rather than imported because the point of the case below is
 * that a process which configures nothing still gets a bounded, correct TTL —
 * an import would assert the constant against itself.
 */
const FOLD_CACHE_FLOOR_SECONDS = 300;

function foldedState(overrides: Partial<SuiteRunStateData> = {}): SuiteRunStateData {
  return {
    SuiteRunId: "run_1",
    BatchRunId: "batch_1",
    ScenarioSetId: "suite:set_1",
    SuiteId: "suite_1",
    Status: "IN_PROGRESS",
    Total: 2,
    StartedCount: 1,
    CompletedCount: 0,
    FailedCount: 0,
    Progress: 1,
    PassRateBps: null,
    PassedCount: 0,
    GradedCount: 0,
    CreatedAt: 100,
    UpdatedAt: 200,
    LastEventOccurredAt: 190,
    StartedAt: 110,
    FinishedAt: null,
    ...overrides,
  } as SuiteRunStateData;
}

function compose(
  options: {
    foldCacheTtlSeconds?: number;
  } = {},
) {
  const insert = vi.fn(
    async (_request: { table: string; values: readonly unknown[] }) => undefined,
  );
  const resolveClient = vi.fn(async () => ({
    insert,
    query: async () => ({ json: async () => [] }),
  }));
  const set = vi.fn(async (..._args: unknown[]) => "OK");
  const redis = { get: vi.fn(async () => null), set };

  const pipeline: SuiteRunProcessingPipeline = ClickHouseSuiteRunProcessingAdapter.create({
    resolveClient,
    defaultRetentionDays: 49,
    redis: redis as never,
    ...(options.foldCacheTtlSeconds === undefined
      ? {}
      : { foldCacheTtlSeconds: options.foldCacheTtlSeconds }),
  }).buildProcessing();

  return { pipeline, insert, resolveClient, redis, set };
}

function runStateStore(
  pipeline: SuiteRunProcessingPipeline,
): FoldProjectionStore<SuiteRunStateData> {
  const fold = pipeline.foldProjections.get("suiteRunState");
  expect(fold, "the pipeline registered no suiteRunState fold").toBeDefined();
  return (fold!.definition as unknown as { store: FoldProjectionStore<SuiteRunStateData> }).store;
}

async function storeThrough(pipeline: SuiteRunProcessingPipeline): Promise<void> {
  await runStateStore(pipeline).store(foldedState(), {
    aggregateId: "batch_1",
    tenantId: createTenantId("project_alpha"),
  });
}

describe("ClickHouseSuiteRunProcessingAdapter", () => {
  describe("given a process holding a tenant-keyed ClickHouse client and its own Redis", () => {
    /** @scenario "Durable processing composes from one tenant-keyed client and one Redis" */
    it("builds the suite-run pipeline from those two alone", () => {
      const { pipeline } = compose();

      expect(pipeline.metadata.name).toBe("suite_run_processing");
      expect(pipeline.commands.map((command) => command.name)).toEqual([
        "startSuiteRun",
        "recordSuiteRunItemStarted",
        "completeSuiteRunItem",
      ]);
      expect([...pipeline.foldProjections.keys()]).toEqual(["suiteRunState"]);
    });

    /** @scenario "Durable processing composes from one tenant-keyed client and one Redis" */
    it("keeps every command deduplicated, because the fold accumulates by addition", () => {
      const { pipeline } = compose();

      expect(pipeline.commands.map((command) => Boolean(command.options?.deduplication))).toEqual([
        true,
        true,
        true,
      ]);
    });
  });

  describe("when a suite run's folded state is stored", () => {
    /** @scenario "Suite-run state is written through the client this graph resolved" */
    it("resolves the client for the tenant the state names", async () => {
      const { pipeline, resolveClient, insert } = compose();

      await storeThrough(pipeline);

      // The client this composition resolved, for the tenant the fold names.
      // A pipeline handed any other client registers the identical routing
      // keys and writes its rows somewhere nothing reads.
      expect(resolveClient).toHaveBeenCalledWith("project_alpha");
      expect(insert.mock.calls.map(([request]) => request.table)).toEqual(["suite_runs"]);
    });

    /** @scenario "Suite-run state is written through the client this graph resolved" */
    it("stamps the row with the retention the substrate already carries", async () => {
      const { pipeline, insert } = compose();

      await storeThrough(pipeline);

      // 49 is the `defaultRetentionDays` this adapter was composed with, not a
      // number configured a second time. Two graphs stamping different
      // retentions on one table expire each other's rows.
      expect(insert.mock.calls[0]![0].values[0]).toMatchObject({
        TenantId: "project_alpha",
        BatchRunId: "batch_1",
        _retention_days: 49,
      });
    });

    /** @scenario "Both graphs cache the run-state fold under one keyspace" */
    it("writes the cache entry under the keyspace the App also reads", async () => {
      const { pipeline, set } = compose();

      await storeThrough(pipeline);

      // Frozen twin: `PipelineRegistry.registerSuiteRunPipeline` caches under
      // `suite_runs` too, and the two graphs share one Redis. A prefix that
      // drifted would leave each side reading a cache the other never writes.
      expect(set.mock.calls[0]![0]).toBe("fold:suite_runs:project_alpha:batch_1");
    });
  });

  describe("given a fold cache TTL named by the process", () => {
    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("writes cache entries with that TTL", async () => {
      const { pipeline, set } = compose({ foldCacheTtlSeconds: 900 });

      await storeThrough(pipeline);

      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", 900]);
    });

    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("falls back to the replication-lag floor when the process names none", async () => {
      const { pipeline, set } = compose();

      await storeThrough(pipeline);

      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", FOLD_CACHE_FLOOR_SECONDS]);
    });
  });
});
