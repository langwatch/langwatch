import { createApiFixture } from "@langwatch/api-fixture";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import { buildExperimentRunProcessingPipeline } from "../../eventing/experiment-run-processing.pipeline.ts";
import type { ClickHouseExperimentRunResultRecord } from "../../eventing/experiment-run-result-storage.projection.ts";
import type { ExperimentRunStateData } from "../../eventing/experiment-run-state.projection.ts";
import type { WorkflowEvaluationRunner } from "../../eventing/experiment-workflow-evaluation.subscriber.ts";
import { RedisExperimentRunProcessingRepository } from "../redis/redis.experiment-run-processing.repository.ts";

/**
 * The replication-lag floor `RedisCachedFoldStore` clamps every TTL up to.
 * Restated here, not imported: the case below proves an unconfigured process
 * still gets a bounded TTL — importing would assert the constant against itself.
 */
const FOLD_CACHE_FLOOR_SECONDS = 300;

function foldedState(overrides: Partial<ExperimentRunStateData> = {}): ExperimentRunStateData {
  return {
    RunId: "run_1",
    ExperimentId: "experiment_1",
    WorkflowVersionId: null,
    Total: 2,
    Progress: 1,
    CompletedCount: 1,
    FailedCount: 0,
    TotalCost: 0.25,
    TotalDurationMs: 1200,
    AvgScoreBps: 7500,
    PassRateBps: 5000,
    Targets: "[]",
    CreatedAt: 100,
    UpdatedAt: 200,
    LastEventOccurredAt: 190,
    StartedAt: 110,
    FinishedAt: null,
    StoppedAt: null,
    TotalScoreSum: 0.75,
    ScoreCount: 1,
    PassedCount: 1,
    GradedCount: 2,
    TraceMetrics: {},
    ...overrides,
  };
}

function runItem(): ClickHouseExperimentRunResultRecord {
  return {
    ProjectionId: "item_1",
    TenantId: "project_alpha",
    RunId: "run_1",
    ExperimentId: "experiment_1",
    RowIndex: 0,
    TargetId: "target_1",
    ResultType: "target",
    DatasetEntry: "{}",
    Predicted: null,
    TargetCost: null,
    TargetDurationMs: null,
    TargetError: null,
    TargetDomainError: null,
    TraceId: null,
    EvaluatorId: null,
    EvaluatorName: null,
    EvaluationStatus: "",
    Score: null,
    Label: null,
    Passed: null,
    EvaluationDetails: null,
    EvaluationCost: null,
    EvaluationInputs: null,
    EvaluationDurationMs: null,
  } as ClickHouseExperimentRunResultRecord;
}

function compose(options: { foldCacheTtlSeconds?: number } = {}) {
  const insert = vi.fn(
    async (_request: { table: string; values: readonly unknown[] }) => undefined,
  );
  const resolveClient = vi.fn(async () => ({
    insert,
    query: async () => ({ json: async () => [] }),
  }));
  const set = vi.fn(async (..._args: unknown[]) => "OK");
  const redis = { get: vi.fn(async () => null), set };

  const repository = RedisExperimentRunProcessingRepository.create({
    resolveClient: resolveClient as never,
    defaultRetentionDays: () => 49,
    redis: redis as never,
    ...(options.foldCacheTtlSeconds === undefined
      ? {}
      : { foldCacheTtlSeconds: options.foldCacheTtlSeconds }),
  });
  const pipeline = buildExperimentRunProcessingPipeline({
    workflowEvaluations: createApiFixture<WorkflowEvaluationRunner>({}, "workflowEvaluations"),
    experimentRunStateFoldStore: repository.stateFoldStore(),
    experimentRunItemAppendStore: repository.itemStore(),
  });

  return { pipeline, repository, insert, resolveClient, redis, set };
}

async function storeThrough(repository: RedisExperimentRunProcessingRepository): Promise<void> {
  await repository.stateFoldStore().store(foldedState(), {
    aggregateId: "experiment_1:run_1",
    tenantId: createTenantId("project_alpha"),
  });
}

describe("ClickHouseExperimentRunProcessingAdapter", () => {
  describe("given a process holding a tenant-keyed ClickHouse client and its own Redis", () => {
    /** @scenario "Durable processing composes from one tenant-keyed client and one Redis" */
    it("builds the experiment-run pipeline from those two alone", () => {
      const { pipeline } = compose();

      expect(pipeline.metadata.name).toBe("experiment_run_processing");
      expect(pipeline.commands.map((command) => command.definition.name)).toEqual([
        "startExperimentRun",
        "recordTargetResult",
        "recordEvaluatorResult",
        "computeExperimentRunMetrics",
        "completeExperimentRun",
        "requestWorkflowEvaluation",
        "failExperimentCell",
        "abortExperimentRun",
      ]);
    });

    /** @scenario "Durable processing composes from one tenant-keyed client and one Redis" */
    it("registers the run-state fold and the run-item append", () => {
      const { pipeline } = compose();

      expect([...pipeline.foldProjections.keys()]).toEqual(["experimentRunState"]);
      expect([...pipeline.mapProjections.keys()]).toEqual(["experimentRunResultStorage"]);
    });
  });

  describe("when a run's folded state is stored", () => {
    /** @scenario "Run state is written through the client this graph resolved" */
    it("resolves the client for the tenant the state names", async () => {
      const { repository, resolveClient, insert } = compose();

      await storeThrough(repository);

      // The client this composition resolved, for the tenant the fold names.
      // A pipeline handed any other client registers the identical routing
      // keys and writes its rows somewhere nothing reads.
      expect(resolveClient).toHaveBeenCalledWith("project_alpha");
      expect(insert.mock.calls.map(([request]) => request.table)).toEqual(["experiment_runs"]);
    });

    /** @scenario "Run state is written through the client this graph resolved" */
    it("stamps the row with the retention the substrate already carries", async () => {
      const { repository, insert } = compose();

      await storeThrough(repository);

      // 49 is the `defaultRetentionDays` this adapter was composed with, not a
      // number configured a second time. Two graphs stamping different
      // retentions on one table expire each other's rows.
      expect(insert.mock.calls[0]![0].values[0]).toMatchObject({
        TenantId: "project_alpha",
        RunId: "run_1",
        ExperimentId: "experiment_1",
        _retention_days: 49,
      });
    });

    /** @scenario "Both graphs cache the run-state fold under one keyspace" */
    it("writes the cache entry under the keyspace the App also reads", async () => {
      const { repository, set } = compose();

      await storeThrough(repository);

      // Frozen twin: `PipelineRegistry.registerExperimentRunPipeline` caches
      // under `experiment_runs` too, and the two graphs share one Redis. A
      // prefix that drifted would leave each side reading a cache the other
      // never writes.
      expect(set.mock.calls[0]![0]).toBe("fold:experiment_runs:project_alpha:experiment_1:run_1");
    });
  });

  describe("when one run result is appended", () => {
    /** @scenario "Run items are written through the same client and retention" */
    it("writes it to the run-item table through the client this graph resolved", async () => {
      const { repository, resolveClient, insert } = compose();

      await repository.itemStore().append(runItem(), {
        aggregateId: "experiment_1:run_1",
        tenantId: createTenantId("project_alpha"),
      });

      expect(resolveClient).toHaveBeenCalledWith("project_alpha");
      expect(insert.mock.calls.map(([request]) => request.table)).toEqual(["experiment_run_items"]);
      expect(insert.mock.calls[0]![0].values[0]).toMatchObject({
        ProjectionId: "item_1",
        _retention_days: 49,
      });
    });
  });

  describe("given a fold cache TTL named by the process", () => {
    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("writes cache entries with that TTL", async () => {
      const { repository, set } = compose({ foldCacheTtlSeconds: 900 });

      await storeThrough(repository);

      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", 900]);
    });

    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("falls back to the replication-lag floor when the process names none", async () => {
      const { repository, set } = compose();

      await storeThrough(repository);

      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", FOLD_CACHE_FLOOR_SECONDS]);
    });
  });
});
