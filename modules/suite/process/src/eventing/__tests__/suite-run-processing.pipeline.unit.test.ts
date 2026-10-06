import { createTenantId } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import { describe, expect, it, vi } from "vitest";

import { RedisSuiteRunProcessingRepository } from "../../repositories/redis/redis.suite-run-processing.repository.ts";
import {
  buildSuiteRunProcessingPipeline,
  type SuiteRunProcessingPipeline,
} from "../suite-run-processing.pipeline.ts";

/**
 * The replication-lag floor `RedisCachedFoldStore` clamps every TTL up to.
 * Restated, not imported: the case below proves an unconfigured process
 * still gets a bounded TTL — importing would assert the constant against itself.
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
    async (_request: { tenantId: string; table: string; rows: readonly unknown[] }) => undefined,
  );
  const clickhouse = { insert, query: async () => ({ rows: [] }) };
  const set = vi.fn(async (..._args: unknown[]) => "OK");
  const redis = { get: vi.fn(async () => null), set };

  const suiteRunStateFoldStore = RedisSuiteRunProcessingRepository.create({
    clickhouse: clickhouse as never,
    redis: redis as never,
    ...(options.foldCacheTtlSeconds === undefined
      ? {}
      : { foldCacheTtlSeconds: options.foldCacheTtlSeconds }),
  }).openRunStateFoldStore({ defaultRetentionDays: () => 49 });
  const pipeline: SuiteRunProcessingPipeline = buildSuiteRunProcessingPipeline({
    suiteRunStateFoldStore,
  });

  return { pipeline, suiteRunStateFoldStore, insert, clickhouse, redis, set };
}

/** Stores a folded state through the store the pipeline registered for its suiteRunState fold. */
async function storeThrough({
  pipeline,
  suiteRunStateFoldStore,
}: ReturnType<typeof compose>): Promise<void> {
  const fold = pipeline.foldProjections.get("suiteRunState");
  expect(fold, "the pipeline registered no suiteRunState fold").toBeDefined();
  fold!.open((definition) => expect(definition.store).toBe(suiteRunStateFoldStore));
  await suiteRunStateFoldStore.store(foldedState(), {
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
      expect(pipeline.commands.map((command) => command.definition.name)).toEqual([
        "startSuiteRun",
        "recordSuiteRunItemStarted",
        "completeSuiteRunItem",
        "regradeSuiteRunItem",
      ]);
      expect([...pipeline.foldProjections.keys()]).toEqual(["suiteRunState"]);
    });

    /** @scenario "Durable processing composes from one tenant-keyed client and one Redis" */
    it("keeps every command deduplicated, because the fold accumulates by addition", () => {
      const { pipeline } = compose();

      expect(
        pipeline.commands.map((command) => Boolean(command.definition.options?.deduplication)),
      ).toEqual([true, true, true, true]);
    });
  });

  describe("when a suite run's folded state is stored", () => {
    /** @scenario "Suite-run state is written through the client this graph resolved" */
    it("names the tenant the state names, and the table it belongs in", async () => {
      const composed = compose();
      const { insert } = composed;

      await storeThrough(composed);

      // The batch names its tenant, and the process's one client routes it
      // there. A pipeline that wrote without naming one registers the
      // identical routing keys and puts its rows where nothing reads them.
      expect(insert.mock.calls.map(([request]) => request.tenantId)).toEqual(["project_alpha"]);
      expect(insert.mock.calls.map(([request]) => request.table)).toEqual(["suite_runs"]);
    });

    /** @scenario "Suite-run state is written through the client this graph resolved" */
    it("stamps the row with the retention the substrate already carries", async () => {
      const composed = compose();
      const { insert } = composed;

      await storeThrough(composed);

      // 49 is the `defaultRetentionDays` this adapter was composed with, not a
      // number configured a second time. Two graphs stamping different
      // retentions on one table expire each other's rows.
      expect(insert.mock.calls[0]![0].rows[0]).toMatchObject({
        TenantId: "project_alpha",
        BatchRunId: "batch_1",
        _retention_days: 49,
      });
    });

    /** @scenario "Both graphs cache the run-state fold under one keyspace" */
    it("writes the cache entry under the keyspace the App also reads", async () => {
      const composed = compose();
      const { set } = composed;

      await storeThrough(composed);

      // Frozen twin: `PipelineRegistry.registerSuiteRunPipeline` caches under
      // `suite_runs` too, and the two graphs share one Redis. A prefix that
      // drifted would leave each side reading a cache the other never writes.
      expect(set.mock.calls[0]![0]).toBe("fold:suite_runs:project_alpha:batch_1");
    });
  });

  describe("given a fold cache TTL named by the process", () => {
    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("writes cache entries with that TTL", async () => {
      const composed = compose({ foldCacheTtlSeconds: 900 });
      const { set } = composed;

      await storeThrough(composed);

      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", 900]);
    });

    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("falls back to the replication-lag floor when the process names none", async () => {
      const composed = compose();
      const { set } = composed;

      await storeThrough(composed);

      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", FOLD_CACHE_FLOOR_SECONDS]);
    });
  });
});
