import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../../";
import { definePipeline } from "../../../";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
} from "../../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "../../../__tests__/integration/testHelpers";
import { EventSourcing } from "../../../eventSourcing";
import type { PipelineWithCommandHandlers } from "../../../pipeline/types";
import { BullmqQueueProcessorFactory } from "../../../queues/factory";
import { EventStoreClickHouse } from "../../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../../stores/repositories/eventRepositoryClickHouse";
import { CompleteExperimentRunCommand } from "../commands/completeExperimentRun.command";
import { RecordEvaluatorResultCommand } from "../commands/recordEvaluatorResult.command";
import { RecordTargetResultCommand } from "../commands/recordTargetResult.command";
import { StartExperimentRunCommand } from "../commands/startExperimentRun.command";
import { createExperimentRunResultStorageMapProjection } from "../projections/experimentRunResultStorage.mapProjection";
import type { ExperimentRunStateData } from "../projections/experimentRunState.foldProjection";
import { createExperimentRunStateFoldProjection } from "../projections/experimentRunState.foldProjection";
import { ExperimentRunStateRepositoryClickHouse } from "../repositories";
import { createExperimentRunStateFoldStore } from "../projections/experimentRunState.store";
import { createExperimentRunItemAppendStore } from "../projections/experimentRunResultStorage.store";
import type { ExperimentRunProcessingEvent } from "../schemas/events";

function generateTestRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function generateTestExperimentId(): string {
  return `exp-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function generateTestPipelineName(): string {
  return `experiment_run_processing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a test pipeline for experiment run processing using real ClickHouse and Redis.
 */
function createExperimentRunTestPipeline(): PipelineWithCommandHandlers<
  any,
  {
    startExperimentRun: any;
    recordTargetResult: any;
    recordEvaluatorResult: any;
    completeExperimentRun: any;
  }
> & {
  eventStore: EventStoreClickHouse;
  pipelineName: string;
  ready: () => Promise<void>;
} {
  const pipelineName = generateTestPipelineName();
  const clickHouseClient = getTestClickHouseClient();
  const redisConnection = getTestRedisConnection();

  if (!clickHouseClient) {
    throw new Error("ClickHouse client not available. Ensure testcontainers are started.");
  }
  if (!redisConnection) {
    throw new Error("Redis connection not available. Ensure testcontainers are started.");
  }

  const eventStore = new EventStoreClickHouse(
    new EventRepositoryClickHouse(clickHouseClient),
  );

  const queueProcessorFactory = new BullmqQueueProcessorFactory(redisConnection);

  const eventSourcing = EventSourcing.createWithStores({
    eventStore,
    queueProcessorFactory,
    clickhouse: clickHouseClient,
    redis: redisConnection,
  });

  const repository = new ExperimentRunStateRepositoryClickHouse(clickHouseClient);
  const experimentRunStateFoldStore = createExperimentRunStateFoldStore(repository);
  const experimentRunItemAppendStore = createExperimentRunItemAppendStore(clickHouseClient);

  const pipelineDefinition = definePipeline<ExperimentRunProcessingEvent>()
    .withName(pipelineName)
    .withAggregateType("experiment_run" as AggregateType)
    .withFoldProjection("experimentRunState", createExperimentRunStateFoldProjection({
      store: experimentRunStateFoldStore,
    }) as any)
    .withMapProjection("experimentRunResultStorage", createExperimentRunResultStorageMapProjection({
      store: experimentRunItemAppendStore,
    }) as any)
    .withCommand("startExperimentRun", StartExperimentRunCommand as any)
    .withCommand("recordTargetResult", RecordTargetResultCommand as any)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand as any)
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand as any)
    .build();

  const pipeline = eventSourcing.register(pipelineDefinition);

  return {
    ...pipeline,
    eventStore,
    pipelineName,
    ready: () => pipeline.service.waitUntilReady(),
  } as any;
}

/**
 * Waits for the experiment run fold projection to have a matching RunId.
 */
async function waitForExperimentRunState(
  pipeline: ReturnType<typeof createExperimentRunTestPipeline>,
  runId: string,
  tenantId: ReturnType<typeof createTestTenantId>,
  predicate: (data: ExperimentRunStateData) => boolean,
  timeoutMs = 15000,
): Promise<void> {
  const startTime = Date.now();
  const pollIntervalMs = 100;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const projection = await pipeline.service.getProjectionByName(
        "experimentRunState",
        runId,
        { tenantId },
      );
      const data = projection?.data as ExperimentRunStateData | undefined;
      if (data && predicate(data)) {
        return;
      }
    } catch {
      // Not ready yet
    }

    const elapsed = Date.now() - startTime;
    const currentInterval = elapsed < 500 ? pollIntervalMs : elapsed < 1500 ? pollIntervalMs * 2 : 300;
    await new Promise((resolve) => setTimeout(resolve, currentInterval));
  }

  // Final attempt with diagnostic info
  const projection = await pipeline.service.getProjectionByName(
    "experimentRunState",
    runId,
    { tenantId },
  ).catch(() => null);
  const data = projection?.data as ExperimentRunStateData | undefined;

  throw new Error(
    `Timeout waiting for experiment run state for run ${runId}. ` +
    `Current state: ${data ? JSON.stringify({ RunId: data.RunId, Progress: data.Progress, Total: data.Total, FinishedAt: data.FinishedAt }) : "null"}`,
  );
}

/**
 * Waits for experiment run items to appear in ClickHouse.
 */
async function waitForExperimentRunItems(
  runId: string,
  tenantId: string,
  expectedCount: number,
  timeoutMs = 15000,
): Promise<number> {
  const startTime = Date.now();
  const clickHouseClient = getTestClickHouseClient();
  if (!clickHouseClient) return 0;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await clickHouseClient.query({
        query: `
          SELECT COUNT(*) as count
          FROM experiment_run_items
          WHERE RunId = {runId:String}
            AND TenantId = {tenantId:String}
        `,
        query_params: { runId, tenantId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ count: number | string }>();
      const count = Number(rows[0]?.count ?? 0);
      if (count >= expectedCount) return count;
    } catch {
      // Table or data not ready
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timeout waiting for experiment run items. Expected ${expectedCount} for run ${runId}`,
  );
}

const CLICKHOUSE_CONSISTENCY_DELAY_MS = 200;

async function waitForClickHouseConsistency(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, CLICKHOUSE_CONSISTENCY_DELAY_MS));
}

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

describe.skipIf(!hasTestcontainers)(
  "Experiment Run Processing Pipeline",
  () => {
    let pipeline: ReturnType<typeof createExperimentRunTestPipeline>;
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;

    beforeEach(async () => {
      pipeline = createExperimentRunTestPipeline();
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      await pipeline.ready();
    });

    afterEach(async () => {
      await pipeline.service.close();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await cleanupTestDataForTenant(tenantIdString);
    });

    describe("given a full experiment run lifecycle", () => {
      it("processes start → target results → evaluator results → complete", async () => {
        const runId = generateTestRunId();
        const experimentId = generateTestExperimentId();
        const targetId = "target-1";

        // Start
        await pipeline.commands.startExperimentRun.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          total: 2,
          targets: [{ id: targetId, name: "GPT-4o", type: "llm" }],
        });
        await waitForClickHouseConsistency();

        // Target results
        await pipeline.commands.recordTargetResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 0,
          targetId,
          entry: { input: "What is 2+2?" },
          predicted: { output: "4" },
          cost: 0.002,
          duration: 150,
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.recordTargetResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 1,
          targetId,
          entry: { input: "What is 3+3?" },
          predicted: { output: "6" },
          cost: 0.003,
          duration: 200,
        });
        await waitForClickHouseConsistency();

        // Evaluator results
        await pipeline.commands.recordEvaluatorResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 0,
          targetId,
          evaluatorId: "correctness",
          evaluatorName: "Correctness Check",
          status: "processed",
          score: 1.0,
          passed: true,
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.recordEvaluatorResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 1,
          targetId,
          evaluatorId: "correctness",
          evaluatorName: "Correctness Check",
          status: "processed",
          score: 1.0,
          passed: true,
        });
        await waitForClickHouseConsistency();

        // Complete
        const finishedAt = Date.now();
        await pipeline.commands.completeExperimentRun.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          finishedAt,
        });

        await waitForExperimentRunState(
          pipeline,
          runId,
          tenantId,
          (data) => data.FinishedAt !== null,
        );

        const projection = await pipeline.service.getProjectionByName(
          "experimentRunState",
          runId,
          { tenantId },
        );
        const data = projection?.data as ExperimentRunStateData;

        expect(data.RunId).toBe(runId);
        expect(data.ExperimentId).toBe(experimentId);
        expect(data.Total).toBe(2);
        expect(data.CompletedCount).toBe(2);
        expect(data.FailedCount).toBe(0);
        expect(data.Progress).toBe(2);
        expect(data.TotalCost).toBeCloseTo(0.005, 4);
        expect(data.AvgScore).toBe(1.0);
        expect(data.PassRate).toBe(1.0);
        expect(data.FinishedAt).not.toBeNull();
      });
    });

    describe("given target results with mixed success and failure", () => {
      it("tracks completed and failed counts separately", async () => {
        const runId = generateTestRunId();
        const experimentId = generateTestExperimentId();
        const targetId = "target-1";

        await pipeline.commands.startExperimentRun.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          total: 3,
          targets: [{ id: targetId, name: "GPT-4o", type: "llm" }],
        });
        await waitForClickHouseConsistency();

        // Two successes
        await pipeline.commands.recordTargetResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 0,
          targetId,
          entry: { input: "test-0" },
          predicted: { output: "result-0" },
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.recordTargetResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 1,
          targetId,
          entry: { input: "test-1" },
          predicted: { output: "result-1" },
        });
        await waitForClickHouseConsistency();

        // One failure
        await pipeline.commands.recordTargetResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 2,
          targetId,
          entry: { input: "test-2" },
          error: "Model timeout",
        });

        await waitForExperimentRunState(
          pipeline,
          runId,
          tenantId,
          (data) => data.Progress >= 3,
        );

        const projection = await pipeline.service.getProjectionByName(
          "experimentRunState",
          runId,
          { tenantId },
        );
        const data = projection?.data as ExperimentRunStateData;

        expect(data.CompletedCount).toBe(2);
        expect(data.FailedCount).toBe(1);
        expect(data.Progress).toBe(3);
      });
    });

    describe("given evaluator results with mixed scores", () => {
      it("computes average score and pass rate", async () => {
        const runId = generateTestRunId();
        const experimentId = generateTestExperimentId();
        const targetId = "target-1";

        await pipeline.commands.startExperimentRun.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          total: 2,
          targets: [{ id: targetId, name: "GPT-4o", type: "llm" }],
        });
        await waitForClickHouseConsistency();

        // Evaluator: score=0.8, passed
        await pipeline.commands.recordEvaluatorResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 0,
          targetId,
          evaluatorId: "quality",
          status: "processed",
          score: 0.8,
          passed: true,
        });
        await waitForClickHouseConsistency();

        // Evaluator: score=0.4, failed
        await pipeline.commands.recordEvaluatorResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 1,
          targetId,
          evaluatorId: "quality",
          status: "processed",
          score: 0.4,
          passed: false,
        });

        await waitForExperimentRunState(
          pipeline,
          runId,
          tenantId,
          (data) => data.ScoreCount >= 2,
        );

        const projection = await pipeline.service.getProjectionByName(
          "experimentRunState",
          runId,
          { tenantId },
        );
        const data = projection?.data as ExperimentRunStateData;

        expect(data.AvgScore).toBeCloseTo(0.6, 4); // (0.8 + 0.4) / 2
        expect(data.PassRate).toBeCloseTo(0.5, 4); // 1 passed / 2 total
      });
    });

    describe("given target and evaluator results are sent", () => {
      it("writes result records to experiment_run_items via map projection", async () => {
        const runId = generateTestRunId();
        const experimentId = generateTestExperimentId();
        const targetId = "target-1";

        await pipeline.commands.startExperimentRun.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          total: 1,
          targets: [{ id: targetId, name: "GPT-4o", type: "llm" }],
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.recordTargetResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 0,
          targetId,
          entry: { input: "Hello" },
          predicted: { output: "Hi there" },
          cost: 0.001,
          duration: 100,
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.recordEvaluatorResult.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          index: 0,
          targetId,
          evaluatorId: "tone",
          evaluatorName: "Tone Check",
          status: "processed",
          score: 0.95,
          passed: true,
          label: "friendly",
        });

        // 1 target result + 1 evaluator result = 2 items
        const count = await waitForExperimentRunItems(runId, tenantIdString, 2);
        expect(count).toBeGreaterThanOrEqual(2);
      });
    });

    describe("given a run is stopped before completing", () => {
      it("records stoppedAt in the fold state", async () => {
        const runId = generateTestRunId();
        const experimentId = generateTestExperimentId();

        await pipeline.commands.startExperimentRun.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          experimentId,
          total: 10,
          targets: [{ id: "target-1", name: "GPT-4o", type: "llm" }],
        });
        await waitForClickHouseConsistency();

        const stoppedAt = Date.now();
        await pipeline.commands.completeExperimentRun.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          runId,
          stoppedAt,
        });

        await waitForExperimentRunState(
          pipeline,
          runId,
          tenantId,
          (data) => data.StoppedAt !== null,
        );

        const projection = await pipeline.service.getProjectionByName(
          "experimentRunState",
          runId,
          { tenantId },
        );
        const data = projection?.data as ExperimentRunStateData;

        expect(data.StoppedAt).not.toBeNull();
        expect(data.FinishedAt).toBeNull();
        expect(data.Progress).toBe(0);
      });
    });
  },
  60000,
);
