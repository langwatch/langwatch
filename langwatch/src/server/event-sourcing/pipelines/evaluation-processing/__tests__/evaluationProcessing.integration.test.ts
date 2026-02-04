import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "~/utils/logger/server";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
} from "../../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "../../../__tests__/integration/testHelpers";
import type { AggregateType } from "../../../library";
import { createTenantId } from "../../../library";
import { RedisDistributedLock } from "../../../library/utils/distributedLock";
import { EventSourcing } from "../../../runtime/eventSourcing";
import { EventSourcingRuntime } from "../../../runtime/eventSourcingRuntime";
import type { PipelineWithCommandHandlers } from "../../../runtime/pipeline/types";
import { BullmqQueueProcessorFactory } from "../../../runtime/queue/factory";
import { CheckpointCacheRedis } from "../../../runtime/stores/checkpointCacheRedis";
import { EventStoreClickHouse } from "../../../runtime/stores/eventStoreClickHouse";
import { ProcessorCheckpointStoreClickHouse } from "../../../runtime/stores/processorCheckpointStoreClickHouse";
import { CheckpointRepositoryClickHouse } from "../../../runtime/stores/repositories/checkpointRepositoryClickHouse";
import { EventRepositoryClickHouse } from "../../../runtime/stores/repositories/eventRepositoryClickHouse";
import type {
  CompleteEvaluationCommandData,
  ScheduleEvaluationCommandData,
  StartEvaluationCommandData,
} from "../";
import { CompleteEvaluationCommand } from "../commands/completeEvaluation.command";
import { ScheduleEvaluationCommand } from "../commands/scheduleEvaluation.command";
import { StartEvaluationCommand } from "../commands/startEvaluation.command";
import type { EvaluationState } from "../projections";
import { EvaluationStateProjectionHandler } from "../projections";

const logger = createLogger(
  "langwatch:event-sourcing:tests:evaluation-processing:integration",
);

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Generates a unique evaluation ID for test isolation.
 */
function generateTestEvaluationId(): string {
  return `eval-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generates a unique evaluator ID for test isolation.
 */
function generateTestEvaluatorId(): string {
  return `evaluator-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generates a unique pipeline name to avoid conflicts in parallel tests.
 */
function generateTestPipelineName(): string {
  return `evaluation_processing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates test payload for schedule evaluation command.
 */
function createTestSchedulePayload(
  tenantId: string,
  overrides?: Partial<ScheduleEvaluationCommandData>,
): ScheduleEvaluationCommandData {
  return {
    tenantId,
    evaluationId: generateTestEvaluationId(),
    evaluatorId: generateTestEvaluatorId(),
    evaluatorType: "test/evaluator",
    evaluatorName: "Test Evaluator",
    traceId: `trace-${Date.now()}`,
    isGuardrail: false,
    ...overrides,
  };
}

/**
 * Creates test payload for start evaluation command.
 */
function createTestStartPayload(
  tenantId: string,
  overrides?: Partial<StartEvaluationCommandData>,
): StartEvaluationCommandData {
  return {
    tenantId,
    evaluationId: generateTestEvaluationId(),
    evaluatorId: generateTestEvaluatorId(),
    evaluatorType: "test/evaluator",
    evaluatorName: "Test Evaluator",
    traceId: `trace-${Date.now()}`,
    isGuardrail: false,
    ...overrides,
  };
}

/**
 * Creates test payload for complete evaluation command.
 */
function createTestCompletePayload(
  tenantId: string,
  status: "processed" | "error" | "skipped",
  overrides?: Partial<CompleteEvaluationCommandData>,
): CompleteEvaluationCommandData {
  const basePayload: CompleteEvaluationCommandData = {
    tenantId,
    evaluationId: generateTestEvaluationId(),
    status,
  };

  if (status === "processed") {
    return {
      ...basePayload,
      score: 0.85,
      passed: true,
      label: "good",
      details: "Evaluation passed successfully",
      ...overrides,
    };
  } else if (status === "error") {
    return {
      ...basePayload,
      error: "Evaluator cannot be reached",
      details: "Connection timeout after 30s",
      ...overrides,
    };
  } else {
    return {
      ...basePayload,
      details: "Evaluation skipped due to missing data",
      ...overrides,
    };
  }
}

/**
 * Creates a test pipeline for evaluation processing using real ClickHouse and Redis.
 */
function createEvaluationTestPipeline(): PipelineWithCommandHandlers<
  any,
  {
    scheduleEvaluation: any;
    startEvaluation: any;
    completeEvaluation: any;
  }
> & {
  eventStore: EventStoreClickHouse;
  processorCheckpointStore: ProcessorCheckpointStoreClickHouse;
  pipelineName: string;
  /** Wait for BullMQ workers to be ready before sending commands */
  ready: () => Promise<void>;
} {
  const pipelineName = generateTestPipelineName();
  const clickHouseClient = getTestClickHouseClient();
  const redisConnection = getTestRedisConnection();

  if (!clickHouseClient) {
    throw new Error(
      "ClickHouse client not available. Ensure testcontainers are started.",
    );
  }

  if (!redisConnection) {
    throw new Error(
      "Redis connection not available. Ensure testcontainers are started.",
    );
  }

  // Create stores
  const eventStore = new EventStoreClickHouse(
    new EventRepositoryClickHouse(clickHouseClient),
  );

  const checkpointCache = new CheckpointCacheRedis(redisConnection);

  const processorCheckpointStore = new ProcessorCheckpointStoreClickHouse(
    new CheckpointRepositoryClickHouse(clickHouseClient),
    checkpointCache,
  );

  // Create queue factory that uses BullMQ with test Redis connection
  const queueProcessorFactory = new BullmqQueueProcessorFactory(
    redisConnection,
  );

  // Create distributed lock
  const distributedLock = new RedisDistributedLock(redisConnection);

  // Create EventSourcingRuntime with test stores
  const runtime = EventSourcingRuntime.createWithStores(
    {
      enabled: true,
      clickHouseEnabled: true,
      forceClickHouseInTests: true,
      isTestEnvironment: true,
      isBuildTime: false,
      clickHouseClient,
      redisConnection,
    },
    {
      eventStore,
      checkpointStore: processorCheckpointStore,
      queueProcessorFactory,
      distributedLock,
    },
  );

  // Create EventSourcing instance with the runtime
  const eventSourcing = new EventSourcing(runtime);

  // Use event-based deduplication for tests.
  // Each event gets its own unique job ID, avoiding deduplication conflicts.
  const eventBasedDeduplication = {
    makeId: (event: { id: string }) => event.id,
    ttlMs: 100,
  };

  // Build pipeline using the existing pipeline definition's handlers
  const pipeline = eventSourcing
    .registerPipeline<any>()
    .withName(pipelineName)
    .withAggregateType("evaluation" as AggregateType)
    .withCommand("scheduleEvaluation", ScheduleEvaluationCommand as any)
    .withCommand("startEvaluation", StartEvaluationCommand as any)
    .withCommand("completeEvaluation", CompleteEvaluationCommand as any)
    .withProjection(
      "evaluationState",
      EvaluationStateProjectionHandler as any,
      {
        deduplication: eventBasedDeduplication,
      },
    )
    .build();

  return {
    ...pipeline,
    eventStore,
    processorCheckpointStore,
    pipelineName,
    // Wait for BullMQ workers to be ready before sending commands
    ready: () => new Promise((resolve) => setTimeout(resolve, 200)),
  } as PipelineWithCommandHandlers<
    any,
    {
      scheduleEvaluation: any;
      startEvaluation: any;
      completeEvaluation: any;
    }
  > & {
    eventStore: EventStoreClickHouse;
    processorCheckpointStore: ProcessorCheckpointStoreClickHouse;
    pipelineName: string;
    ready: () => Promise<void>;
  };
}

/**
 * Small delay to allow ClickHouse to persist data (eventual consistency).
 * Increased to 200ms for more reliable test stability.
 */
const CLICKHOUSE_CONSISTENCY_DELAY_MS = 200;

/**
 * Waits a short time for ClickHouse eventual consistency.
 */
async function waitForClickHouseConsistency(): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, CLICKHOUSE_CONSISTENCY_DELAY_MS),
  );
}

/**
 * Waits for evaluation state projection checkpoint.
 */
async function waitForEvaluationCheckpoint(
  pipelineName: string,
  aggregateId: string,
  tenantIdString: string,
  expectedSequenceNumber: number,
  processorCheckpointStore: ProcessorCheckpointStoreClickHouse,
  timeoutMs = 15000,
): Promise<void> {
  // Note: The checkpoint verification uses "test_aggregate" in the testHelpers.
  // We need to pass the correct aggregateType for evaluation pipeline.
  // For now, we use a custom wait implementation.
  const startTime = Date.now();
  const pollIntervalMs = 100;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const tenantId = createTenantId(tenantIdString);
      const checkpoint =
        await processorCheckpointStore.getCheckpointBySequenceNumber(
          pipelineName,
          "evaluationState",
          "projection",
          tenantId,
          "evaluation" as AggregateType,
          aggregateId,
          expectedSequenceNumber,
        );

      if (checkpoint && checkpoint.status === "processed") {
        // Add a delay for ClickHouse eventual consistency
        // The projection data might not be visible immediately after checkpoint
        await new Promise((resolve) => setTimeout(resolve, 500));
        return;
      }
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        "Error checking checkpoint, retrying...",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timeout waiting for evaluation checkpoint. Expected sequence ${expectedSequenceNumber}`,
  );
}

// ============================================================================
// Integration Tests
// ============================================================================

// Skip when running without testcontainers (Prisma-only integration tests)
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

describe.skipIf(!hasTestcontainers)(
  "Evaluation Processing Pipeline - Integration Tests",
  () => {
    let pipeline: ReturnType<typeof createEvaluationTestPipeline>;
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;

    beforeEach(async () => {
      pipeline = createEvaluationTestPipeline();
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      // Wait for BullMQ workers to initialize before running tests
      await pipeline.ready();
    });

    afterEach(async () => {
      // Gracefully close pipeline to ensure all BullMQ workers finish
      await pipeline.service.close();
      // Wait for BullMQ workers to fully shut down and release Redis connections
      // Using 1000ms to ensure all async operations complete
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // Clean up test data
      await cleanupTestDataForTenant(tenantIdString);
    });

    // ========================================================================
    // Suite 1: Full Lifecycle Tests
    // ========================================================================
    describe("Full Lifecycle Tests", () => {
      it("processes complete evaluation lifecycle: schedule -> start -> complete (processed)", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Send events with consistency delays to ensure ClickHouse can persist each event
        await pipeline.commands.scheduleEvaluation.send(
          createTestSchedulePayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "processed", {
            evaluationId,
            score: 0.92,
            passed: true,
            label: "excellent",
          }),
        );

        // Wait for final checkpoint only
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          3,
          pipeline.processorCheckpointStore,
        );

        // Verify final projection state
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection).toBeDefined();
        expect(projection?.data.Status).toBe("processed");
        expect(projection?.data.EvaluatorId).toBe(evaluatorId);
        expect(projection?.data.Score).toBe(0.92);
        expect(projection?.data.Passed).toBe(true);
        expect(projection?.data.Label).toBe("excellent");
        expect(projection?.data.ScheduledAt).not.toBeNull();
        expect(projection?.data.StartedAt).not.toBeNull();
        expect(projection?.data.CompletedAt).not.toBeNull();
        expect(projection?.data.Error).toBeNull();
      });

      it("processes evaluation lifecycle with error status", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const errorMessage = "Evaluator cannot be reached";

        // Send events with consistency delays to ensure ClickHouse can persist each event
        await pipeline.commands.scheduleEvaluation.send(
          createTestSchedulePayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "error", {
            evaluationId,
            error: errorMessage,
            details: "Connection timeout",
          }),
        );

        // Wait for final checkpoint
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          3,
          pipeline.processorCheckpointStore,
        );

        // Verify final error state
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.Status).toBe("error");
        expect(projection?.data.Error).toBe(errorMessage);
        expect(projection?.data.Details).toBe("Connection timeout");
        expect(projection?.data.Score).toBeNull();
        expect(projection?.data.Passed).toBeNull();
        expect(projection?.data.CompletedAt).not.toBeNull();
      });

      it("processes evaluation lifecycle with skipped status", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Send events with small delays for ClickHouse consistency
        await pipeline.commands.scheduleEvaluation.send(
          createTestSchedulePayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "skipped", {
            evaluationId,
            details: "Missing required field: output",
          }),
        );

        // Wait for final checkpoint only
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          3,
          pipeline.processorCheckpointStore,
        );

        // Verify skipped state
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.Status).toBe("skipped");
        expect(projection?.data.Details).toBe("Missing required field: output");
        expect(projection?.data.Score).toBeNull();
        expect(projection?.data.CompletedAt).not.toBeNull();
      });
    });

    // ========================================================================
    // Suite 2: Direct API Flow Tests (No Schedule)
    // ========================================================================
    describe("Direct API Flow Tests (No Schedule)", () => {
      it("reaches in_progress without schedule event", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const evaluatorName = "Direct API Evaluator";
        const traceId = `direct-trace-${Date.now()}`;

        // Start directly without scheduling (only send start event)
        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
            evaluatorName,
            traceId,
            isGuardrail: true,
          }),
        );
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          1,
          pipeline.processorCheckpointStore,
        );

        // Verify projection populated evaluator info from start event
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.Status).toBe("in_progress");
        expect(projection?.data.EvaluatorId).toBe(evaluatorId);
        expect(projection?.data.EvaluatorName).toBe(evaluatorName);
        expect(projection?.data.TraceId).toBe(traceId);
        expect(projection?.data.IsGuardrail).toBe(true);
        expect(projection?.data.ScheduledAt).toBeNull(); // No schedule event
        expect(projection?.data.StartedAt).not.toBeNull();
      });

      it("processes start -> complete without schedule", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const evaluatorName = "Direct API Evaluator";
        const traceId = `direct-trace-${Date.now()}`;

        // Send events with consistency delays to ensure ClickHouse can persist each event
        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
            evaluatorName,
            traceId,
            isGuardrail: true,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "processed", {
            evaluationId,
            score: 0.75,
            passed: true,
          }),
        );

        // Wait for final checkpoint only
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          2,
          pipeline.processorCheckpointStore,
        );

        // Verify final state (preserving evaluator info from start)
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.Status).toBe("processed");
        expect(projection?.data.Score).toBe(0.75);
        expect(projection?.data.EvaluatorId).toBe(evaluatorId);
        expect(projection?.data.EvaluatorName).toBe(evaluatorName);
        expect(projection?.data.TraceId).toBe(traceId);
        expect(projection?.data.IsGuardrail).toBe(true);
        expect(projection?.data.ScheduledAt).toBeNull(); // No schedule event
        expect(projection?.data.StartedAt).not.toBeNull();
        expect(projection?.data.CompletedAt).not.toBeNull();
      });

      it("handles direct API flow with error completion", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Send events with small delays for ClickHouse consistency
        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "error", {
            evaluationId,
            error: "API timeout",
          }),
        );

        // Wait for final checkpoint only
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          2,
          pipeline.processorCheckpointStore,
        );

        // Verify error state
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.Status).toBe("error");
        expect(projection?.data.Error).toBe("API timeout");
        expect(projection?.data.ScheduledAt).toBeNull();
        expect(projection?.data.StartedAt).not.toBeNull();
        expect(projection?.data.CompletedAt).not.toBeNull();
      });
    });

    // ========================================================================
    // Suite 3: State Transitions Tests
    // ========================================================================
    describe("State Transitions Tests", () => {
      it("reaches scheduled state after schedule event", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Only send schedule event
        await pipeline.commands.scheduleEvaluation.send(
          createTestSchedulePayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          1,
          pipeline.processorCheckpointStore,
        );

        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;
        expect(projection?.data.Status).toBe("scheduled");
      });

      it("reaches in_progress state after start event", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Send schedule and start events with delays for ClickHouse consistency
        await pipeline.commands.scheduleEvaluation.send(
          createTestSchedulePayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          2,
          pipeline.processorCheckpointStore,
        );

        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;
        expect(projection?.data.Status).toBe("in_progress");
      });

      it("reaches processed state after complete event", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Send events with consistency delays
        await pipeline.commands.scheduleEvaluation.send(
          createTestSchedulePayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "processed", {
            evaluationId,
          }),
        );
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          3,
          pipeline.processorCheckpointStore,
        );

        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;
        expect(projection?.data.Status).toBe("processed");
      });

      it("preserves evaluator info through entire lifecycle", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const evaluatorName = "Preserved Evaluator";
        const evaluatorType = "custom/preserved";
        const traceId = `trace-preserved-${Date.now()}`;

        // Send events with consistency delays
        await pipeline.commands.scheduleEvaluation.send({
          tenantId: tenantIdString,
          evaluationId,
          evaluatorId,
          evaluatorType,
          evaluatorName,
          traceId,
          isGuardrail: true,
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.startEvaluation.send({
          tenantId: tenantIdString,
          evaluationId,
          evaluatorId,
          evaluatorType,
          evaluatorName,
          traceId,
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "processed", {
            evaluationId,
          }),
        );

        // Wait for final checkpoint only
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          3,
          pipeline.processorCheckpointStore,
        );

        // Verify evaluator info preserved
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.EvaluatorId).toBe(evaluatorId);
        expect(projection?.data.EvaluatorType).toBe(evaluatorType);
        expect(projection?.data.EvaluatorName).toBe(evaluatorName);
        expect(projection?.data.TraceId).toBe(traceId);
        expect(projection?.data.IsGuardrail).toBe(true);
      });

      it("correctly stores timestamps in order", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Send events with consistency delays to ensure proper ordering
        await pipeline.commands.scheduleEvaluation.send(
          createTestSchedulePayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "processed", {
            evaluationId,
          }),
        );

        // Wait for final checkpoint only
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          3,
          pipeline.processorCheckpointStore,
        );

        // Verify timestamps are in correct order
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.ScheduledAt).not.toBeNull();
        expect(projection?.data.StartedAt).not.toBeNull();
        expect(projection?.data.CompletedAt).not.toBeNull();

        // Verify order: ScheduledAt <= StartedAt <= CompletedAt
        const scheduledAt = projection?.data.ScheduledAt ?? 0;
        const startedAt = projection?.data.StartedAt ?? 0;
        const completedAt = projection?.data.CompletedAt ?? 0;
        expect(scheduledAt).toBeLessThanOrEqual(startedAt);
        expect(startedAt).toBeLessThanOrEqual(completedAt);
      });
    });

    // ========================================================================
    // Suite 4: Error Scenarios Tests
    // ========================================================================
    describe("Error Scenarios Tests", () => {
      it("stores error message when evaluation completes with error status", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const errorMessage = "Custom error: Model rate limited";
        const errorDetails = "Retry after 60 seconds";

        // Send events with consistency delays to ensure ClickHouse can persist each event
        await pipeline.commands.scheduleEvaluation.send(
          createTestSchedulePayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send({
          tenantId: tenantIdString,
          evaluationId,
          status: "error",
          error: errorMessage,
          details: errorDetails,
        });

        // Wait for final checkpoint only
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          3,
          pipeline.processorCheckpointStore,
        );

        // Verify error fields
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.Status).toBe("error");
        expect(projection?.data.Error).toBe(errorMessage);
        expect(projection?.data.Details).toBe(errorDetails);
        expect(projection?.data.Score).toBeNull();
        expect(projection?.data.Passed).toBeNull();
        expect(projection?.data.Label).toBeNull();
      });

      it("handles completion without start event", async () => {
        const evaluationId = generateTestEvaluationId();

        // Only complete (no schedule or start)
        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "processed", {
            evaluationId,
            score: 0.5,
          }),
        );
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          1,
          pipeline.processorCheckpointStore,
        );

        // Verify projection still works
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.Status).toBe("processed");
        expect(projection?.data.Score).toBe(0.5);
        expect(projection?.data.ScheduledAt).toBeNull();
        expect(projection?.data.StartedAt).toBeNull();
        expect(projection?.data.CompletedAt).not.toBeNull();
        // EvaluatorId will be empty since no schedule/start event provided it
        expect(projection?.data.EvaluatorId).toBe("");
      });
    });

    // ========================================================================
    // Suite 5: Multi-Evaluation Tests
    // ========================================================================
    describe("Multi-Evaluation Tests", () => {
      it("processes multiple evaluations concurrently without interference", async () => {
        const evaluation1Id = generateTestEvaluationId();
        const evaluation2Id = generateTestEvaluationId();
        const evaluation3Id = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Schedule all three concurrently
        await Promise.all([
          pipeline.commands.scheduleEvaluation.send(
            createTestSchedulePayload(tenantIdString, {
              evaluationId: evaluation1Id,
              evaluatorId,
              evaluatorName: "Evaluator 1",
            }),
          ),
          pipeline.commands.scheduleEvaluation.send(
            createTestSchedulePayload(tenantIdString, {
              evaluationId: evaluation2Id,
              evaluatorId,
              evaluatorName: "Evaluator 2",
            }),
          ),
          pipeline.commands.scheduleEvaluation.send(
            createTestSchedulePayload(tenantIdString, {
              evaluationId: evaluation3Id,
              evaluatorId,
              evaluatorName: "Evaluator 3",
            }),
          ),
        ]);

        // Wait for all to be processed
        await Promise.all([
          waitForEvaluationCheckpoint(
            pipeline.pipelineName,
            evaluation1Id,
            tenantIdString,
            1,
            pipeline.processorCheckpointStore,
          ),
          waitForEvaluationCheckpoint(
            pipeline.pipelineName,
            evaluation2Id,
            tenantIdString,
            1,
            pipeline.processorCheckpointStore,
          ),
          waitForEvaluationCheckpoint(
            pipeline.pipelineName,
            evaluation3Id,
            tenantIdString,
            1,
            pipeline.processorCheckpointStore,
          ),
        ]);

        // Verify each evaluation has its own projection
        const [projection1, projection2, projection3] = (await Promise.all([
          pipeline.service.getProjectionByName(
            "evaluationState",
            evaluation1Id,
            {
              tenantId,
            },
          ),
          pipeline.service.getProjectionByName(
            "evaluationState",
            evaluation2Id,
            {
              tenantId,
            },
          ),
          pipeline.service.getProjectionByName(
            "evaluationState",
            evaluation3Id,
            {
              tenantId,
            },
          ),
        ])) as [
          EvaluationState | null,
          EvaluationState | null,
          EvaluationState | null,
        ];

        expect(projection1?.data.EvaluatorName).toBe("Evaluator 1");
        expect(projection2?.data.EvaluatorName).toBe("Evaluator 2");
        expect(projection3?.data.EvaluatorName).toBe("Evaluator 3");

        // All should be scheduled
        expect(projection1?.data.Status).toBe("scheduled");
        expect(projection2?.data.Status).toBe("scheduled");
        expect(projection3?.data.Status).toBe("scheduled");
      });

      it("correctly stores isGuardrail flag in projection", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Schedule as guardrail
        await pipeline.commands.scheduleEvaluation.send(
          createTestSchedulePayload(tenantIdString, {
            evaluationId,
            evaluatorId,
            isGuardrail: true,
          }),
        );
        await waitForEvaluationCheckpoint(
          pipeline.pipelineName,
          evaluationId,
          tenantIdString,
          1,
          pipeline.processorCheckpointStore,
        );

        // Verify isGuardrail is true
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationState",
          evaluationId,
          { tenantId },
        )) as EvaluationState | null;

        expect(projection?.data.IsGuardrail).toBe(true);
      });
    });
  },
  60000,
); // 60 second timeout for integration tests
