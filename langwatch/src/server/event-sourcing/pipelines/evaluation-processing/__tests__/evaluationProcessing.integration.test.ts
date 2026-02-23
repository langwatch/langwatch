import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import { createLogger } from "~/utils/logger/server";
import type {
  CompleteEvaluationCommandData,
  StartEvaluationCommandData,
} from "../";
import type { AggregateType } from "../../../";
import { createTenantId, definePipeline } from "../../../";
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
import { CompleteEvaluationCommand } from "../commands/completeEvaluation.command";
import { StartEvaluationCommand } from "../commands/startEvaluation.command";
import type { EvaluationRun } from "../projections";
import { createEvaluationRunFoldProjection } from "../projections";
import type { EvaluationProcessingEvent } from "../schemas/events";
import { EvaluationRunStore } from "../projections/evaluationRun.store";

const logger = createLogger(
  "langwatch:event-sourcing:tests:evaluation-processing:integration",
);

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
    occurredAt: Date.now(),
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
    occurredAt: Date.now(),
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
    startEvaluation: any;
    completeEvaluation: any;
  }
> & {
  eventStore: EventStoreClickHouse;
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

  // Create queue factory that uses BullMQ with test Redis connection
  const queueProcessorFactory = new BullmqQueueProcessorFactory(
    redisConnection,
  );

  const eventSourcing = EventSourcing.createWithStores({
    eventStore,
    queueProcessorFactory,
    clickhouse: clickHouseClient,
    redis: redisConnection,
  });

  // Build pipeline using static definition with definePipeline + register
  const evalRunStore = new EvaluationRunStore(
    EvaluationRunService.create(clickHouseClient).repository,
  );

  const pipelineDefinition = definePipeline<EvaluationProcessingEvent>()
    .withName(pipelineName)
    .withAggregateType("evaluation" as AggregateType)
    .withCommand("startEvaluation", StartEvaluationCommand as any)
    .withCommand("completeEvaluation", CompleteEvaluationCommand as any)
    .withFoldProjection(
      "evaluationRun",
      createEvaluationRunFoldProjection({ store: evalRunStore }) as any,
    )
    .build();

  const pipeline = eventSourcing.register(pipelineDefinition);

  return {
    ...pipeline,
    eventStore,
    pipelineName,
    // Wait for BullMQ workers to be ready before sending commands
    ready: () => pipeline.service.waitUntilReady(),
  } as PipelineWithCommandHandlers<
    any,
    {
      startEvaluation: any;
      completeEvaluation: any;
    }
  > & {
    eventStore: EventStoreClickHouse;
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
 * Waits for the evaluation fold projection to reach the expected status.
 * The fold projection state IS the checkpoint — no separate checkpoint store needed.
 */
async function waitForEvaluationRun(
  pipeline: ReturnType<typeof createEvaluationTestPipeline>,
  evaluationId: string,
  tenantId: ReturnType<typeof createTenantId>,
  expectedStatus: string,
  timeoutMs = 15000,
): Promise<void> {
  const startTime = Date.now();
  const pollIntervalMs = 100;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const projection = (await pipeline.service.getProjectionByName(
        "evaluationRun",
        evaluationId,
        { tenantId },
      )) as EvaluationRun | null;

      if (projection && projection.data.status === expectedStatus) {
        // Add a delay for ClickHouse eventual consistency
        // The projection data might not be fully visible immediately
        await new Promise((resolve) => setTimeout(resolve, 500));
        return;
      }
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        "Error checking evaluation run, retrying...",
      );
    }

    // Adaptive polling: start fast, increase interval as time passes
    const elapsed = Date.now() - startTime;
    const currentInterval =
      elapsed < 500
        ? pollIntervalMs
        : elapsed < 1500
          ? pollIntervalMs * 2
          : Math.min(pollIntervalMs * 3, 300);
    await new Promise((resolve) => setTimeout(resolve, currentInterval));
  }

  // Final attempt
  try {
    const projection = (await pipeline.service.getProjectionByName(
      "evaluationRun",
      evaluationId,
      { tenantId },
    )) as EvaluationRun | null;

    if (projection && projection.data.status === expectedStatus) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return;
    }
  } catch {
    /* ignore */
  }

  throw new Error(
    `Timeout waiting for evaluation run. Expected status "${expectedStatus}" for evaluation ${evaluationId}`,
  );
}

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

    describe("Full Lifecycle Tests", () => {
      it("processes complete evaluation lifecycle: start -> complete (processed)", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

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

        // Wait for fold projection to reach final status
        await waitForEvaluationRun(
          pipeline,
          evaluationId,
          tenantId,
          "processed",
        );

        // Verify final projection state
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection).toBeDefined();
        expect(projection?.data.status).toBe("processed");
        expect(projection?.data.evaluatorId).toBe(evaluatorId);
        expect(projection?.data.score).toBe(0.92);
        expect(projection?.data.passed).toBe(true);
        expect(projection?.data.label).toBe("excellent");
        expect(projection?.data.startedAt).not.toBeNull();
        expect(projection?.data.completedAt).not.toBeNull();
        expect(projection?.data.error).toBeNull();
      });

      it("processes evaluation lifecycle with error status", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const errorMessage = "Evaluator cannot be reached";

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

        // Wait for fold projection to reach final status
        await waitForEvaluationRun(pipeline, evaluationId, tenantId, "error");

        // Verify final error state
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.status).toBe("error");
        expect(projection?.data.error).toBe(errorMessage);
        expect(projection?.data.details).toBe("Connection timeout");
        expect(projection?.data.score).toBeNull();
        expect(projection?.data.passed).toBeNull();
        expect(projection?.data.completedAt).not.toBeNull();
      });

      it("processes evaluation lifecycle with skipped status", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

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

        // Wait for fold projection to reach final status
        await waitForEvaluationRun(pipeline, evaluationId, tenantId, "skipped");

        // Verify skipped state
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.status).toBe("skipped");
        expect(projection?.data.details).toBe("Missing required field: output");
        expect(projection?.data.score).toBeNull();
        expect(projection?.data.completedAt).not.toBeNull();
      });
    });

    describe("Direct API Flow Tests (Start as first event)", () => {
      it("reaches in_progress with start as first event", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const evaluatorName = "Direct API Evaluator";
        const traceId = `direct-trace-${Date.now()}`;

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
            evaluatorName,
            traceId,
            isGuardrail: true,
          }),
        );
        await waitForEvaluationRun(
          pipeline,
          evaluationId,
          tenantId,
          "in_progress",
        );

        // Verify projection populated evaluator info from start event
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.status).toBe("in_progress");
        expect(projection?.data.evaluationId).toBe(evaluationId);
        expect(projection?.data.evaluatorId).toBe(evaluatorId);
        expect(projection?.data.evaluatorName).toBe(evaluatorName);
        expect(projection?.data.traceId).toBe(traceId);
        expect(projection?.data.isGuardrail).toBe(true);
        expect(projection?.data.startedAt).not.toBeNull();
      });

      it("processes start -> complete", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const evaluatorName = "Direct API Evaluator";
        const traceId = `direct-trace-${Date.now()}`;

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

        // Wait for fold projection to reach final status
        await waitForEvaluationRun(
          pipeline,
          evaluationId,
          tenantId,
          "processed",
        );

        // Verify final state (preserving evaluator info from start)
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.status).toBe("processed");
        expect(projection?.data.score).toBe(0.75);
        expect(projection?.data.evaluatorId).toBe(evaluatorId);
        expect(projection?.data.evaluatorName).toBe(evaluatorName);
        expect(projection?.data.traceId).toBe(traceId);
        expect(projection?.data.isGuardrail).toBe(true);
        expect(projection?.data.startedAt).not.toBeNull();
        expect(projection?.data.completedAt).not.toBeNull();
      });

      it("handles direct API flow with error completion", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

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

        // Wait for fold projection to reach final status
        await waitForEvaluationRun(pipeline, evaluationId, tenantId, "error");

        // Verify error state
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.status).toBe("error");
        expect(projection?.data.error).toBe("API timeout");
        expect(projection?.data.startedAt).not.toBeNull();
        expect(projection?.data.completedAt).not.toBeNull();
      });
    });

    describe("State Transitions Tests", () => {
      it("reaches in_progress state after start event", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForEvaluationRun(
          pipeline,
          evaluationId,
          tenantId,
          "in_progress",
        );

        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;
        expect(projection?.data.status).toBe("in_progress");
      });

      it("reaches processed state after complete event", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

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
        await waitForEvaluationRun(
          pipeline,
          evaluationId,
          tenantId,
          "processed",
        );

        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;
        expect(projection?.data.status).toBe("processed");
      });

      it("preserves evaluator info through entire lifecycle", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const evaluatorName = "Preserved Evaluator";
        const evaluatorType = "custom/preserved";
        const traceId = `trace-preserved-${Date.now()}`;

        await pipeline.commands.startEvaluation.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          evaluationId,
          evaluatorId,
          evaluatorType,
          evaluatorName,
          traceId,
          isGuardrail: true,
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "processed", {
            evaluationId,
          }),
        );

        // Wait for fold projection to reach final status
        await waitForEvaluationRun(
          pipeline,
          evaluationId,
          tenantId,
          "processed",
        );

        // Verify evaluator info preserved
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.evaluatorId).toBe(evaluatorId);
        expect(projection?.data.evaluatorType).toBe(evaluatorType);
        expect(projection?.data.evaluatorName).toBe(evaluatorName);
        expect(projection?.data.traceId).toBe(traceId);
        expect(projection?.data.isGuardrail).toBe(true);
      });

      it("correctly stores timestamps in order", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

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

        // Wait for fold projection to reach final status
        await waitForEvaluationRun(
          pipeline,
          evaluationId,
          tenantId,
          "processed",
        );

        // Verify timestamps are in correct order
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.startedAt).not.toBeNull();
        expect(projection?.data.completedAt).not.toBeNull();

        // Verify order: StartedAt <= CompletedAt
        const startedAt = projection?.data.startedAt ?? 0;
        const completedAt = projection?.data.completedAt ?? 0;
        expect(startedAt).toBeLessThanOrEqual(completedAt);
      });
    });

    describe("Error Scenarios Tests", () => {
      it("stores error message when evaluation completes with error status", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();
        const errorMessage = "Custom error: Model rate limited";
        const errorDetails = "Retry after 60 seconds";

        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
          }),
        );
        await waitForClickHouseConsistency();

        await pipeline.commands.completeEvaluation.send({
          tenantId: tenantIdString,
          occurredAt: Date.now(),
          evaluationId,
          status: "error",
          error: errorMessage,
          details: errorDetails,
        });

        // Wait for fold projection to reach final status
        await waitForEvaluationRun(pipeline, evaluationId, tenantId, "error");

        // Verify error fields
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.status).toBe("error");
        expect(projection?.data.error).toBe(errorMessage);
        expect(projection?.data.details).toBe(errorDetails);
        expect(projection?.data.score).toBeNull();
        expect(projection?.data.passed).toBeNull();
        expect(projection?.data.label).toBeNull();
      });

      it("handles completion without start event", async () => {
        const evaluationId = generateTestEvaluationId();

        // Only complete (no start)
        await pipeline.commands.completeEvaluation.send(
          createTestCompletePayload(tenantIdString, "processed", {
            evaluationId,
            score: 0.5,
          }),
        );
        await waitForEvaluationRun(
          pipeline,
          evaluationId,
          tenantId,
          "processed",
        );

        // Verify projection still works
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.status).toBe("processed");
        expect(projection?.data.score).toBe(0.5);
        expect(projection?.data.startedAt).toBeNull();
        expect(projection?.data.completedAt).not.toBeNull();
        // EvaluatorId will be empty since no start event provided it
        expect(projection?.data.evaluatorId).toBe("");
      });
    });

    describe("Multi-Evaluation Tests", () => {
      it("processes multiple evaluations concurrently without interference", async () => {
        const evaluation1Id = generateTestEvaluationId();
        const evaluation2Id = generateTestEvaluationId();
        const evaluation3Id = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Start all three concurrently
        await Promise.all([
          pipeline.commands.startEvaluation.send(
            createTestStartPayload(tenantIdString, {
              evaluationId: evaluation1Id,
              evaluatorId,
              evaluatorName: "Evaluator 1",
            }),
          ),
          pipeline.commands.startEvaluation.send(
            createTestStartPayload(tenantIdString, {
              evaluationId: evaluation2Id,
              evaluatorId,
              evaluatorName: "Evaluator 2",
            }),
          ),
          pipeline.commands.startEvaluation.send(
            createTestStartPayload(tenantIdString, {
              evaluationId: evaluation3Id,
              evaluatorId,
              evaluatorName: "Evaluator 3",
            }),
          ),
        ]);

        // Wait for all to be processed
        await Promise.all([
          waitForEvaluationRun(
            pipeline,
            evaluation1Id,
            tenantId,
            "in_progress",
          ),
          waitForEvaluationRun(
            pipeline,
            evaluation2Id,
            tenantId,
            "in_progress",
          ),
          waitForEvaluationRun(
            pipeline,
            evaluation3Id,
            tenantId,
            "in_progress",
          ),
        ]);

        // Verify each evaluation has its own projection
        const [projection1, projection2, projection3] = (await Promise.all([
          pipeline.service.getProjectionByName("evaluationRun", evaluation1Id, {
            tenantId,
          }),
          pipeline.service.getProjectionByName("evaluationRun", evaluation2Id, {
            tenantId,
          }),
          pipeline.service.getProjectionByName("evaluationRun", evaluation3Id, {
            tenantId,
          }),
        ])) as [
          EvaluationRun | null,
          EvaluationRun | null,
          EvaluationRun | null,
        ];

        expect(projection1?.data.evaluatorName).toBe("Evaluator 1");
        expect(projection2?.data.evaluatorName).toBe("Evaluator 2");
        expect(projection3?.data.evaluatorName).toBe("Evaluator 3");

        // All should be in_progress
        expect(projection1?.data.status).toBe("in_progress");
        expect(projection2?.data.status).toBe("in_progress");
        expect(projection3?.data.status).toBe("in_progress");
      });

      it("correctly stores isGuardrail flag in projection", async () => {
        const evaluationId = generateTestEvaluationId();
        const evaluatorId = generateTestEvaluatorId();

        // Start as guardrail
        await pipeline.commands.startEvaluation.send(
          createTestStartPayload(tenantIdString, {
            evaluationId,
            evaluatorId,
            isGuardrail: true,
          }),
        );
        await waitForEvaluationRun(
          pipeline,
          evaluationId,
          tenantId,
          "in_progress",
        );

        // Verify isGuardrail is true
        const projection = (await pipeline.service.getProjectionByName(
          "evaluationRun",
          evaluationId,
          { tenantId },
        )) as EvaluationRun | null;

        expect(projection?.data.isGuardrail).toBe(true);
      });
    });
  },
  60000,
); // 60 second timeout for integration tests
