import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "~/utils/logger/server";
import { createTenantId } from "../../../";
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
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { EventStoreClickHouse } from "../../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../../stores/repositories/eventRepositoryClickHouse";
import {
  type SuiteRunState,
  type SuiteRunStateData,
} from "../projections/suiteRunState.foldProjection";
import { createSuiteRunProcessingPipeline } from "../pipeline";

const logger = createLogger(
  "langwatch:event-sourcing:tests:suite-run-processing:integration",
);

/**
 * Generates a unique batch run ID for test isolation.
 */
function generateTestBatchRunId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generates a unique suite ID for test isolation.
 */
function generateTestSuiteId(): string {
  return `suite-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generates a unique scenario run ID for test isolation.
 */
function generateTestScenarioRunId(): string {
  return `scenrun-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generates a unique pipeline name to avoid conflicts in parallel tests.
 */
function generateTestPipelineName(): string {
  return `suite_run_processing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * In-memory fold projection store for suite run state.
 * Used in integration tests to avoid needing a ClickHouse suite_runs table.
 */
class InMemorySuiteRunStateStore
  implements FoldProjectionStore<SuiteRunStateData>
{
  private data = new Map<string, SuiteRunStateData>();

  async get(
    _aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<SuiteRunStateData | null> {
    const key = `${String(context.tenantId)}:${context.aggregateId}`;
    return this.data.get(key) ?? null;
  }

  async store(
    state: SuiteRunStateData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const key = `${String(context.tenantId)}:${context.aggregateId}`;
    this.data.set(key, state);
  }
}

/**
 * Creates a test pipeline for suite run processing using real ClickHouse and Redis,
 * with an in-memory fold projection store.
 */
function createSuiteRunTestPipeline(): PipelineWithCommandHandlers<
  any,
  {
    startSuiteRun: any;
    recordSuiteRunItemStarted: any;
    completeSuiteRunItem: any;
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

  const eventSourcing = EventSourcing.createWithStores({
    eventStore,
    clickhouse: async () => clickHouseClient,
    redis: redisConnection,
  });

  // Use the production pipeline factory to validate real wiring
  const suiteRunStateStore = new InMemorySuiteRunStateStore();

  const pipeline = eventSourcing.register(
    createSuiteRunProcessingPipeline({
      suiteRunStateFoldStore: suiteRunStateStore,
    }),
  );

  return {
    ...pipeline,
    eventStore,
    pipelineName,
    // Wait for BullMQ workers to be ready before sending commands
    ready: () => pipeline.service.waitUntilReady(),
  } as PipelineWithCommandHandlers<
    any,
    {
      startSuiteRun: any;
      recordSuiteRunItemStarted: any;
      completeSuiteRunItem: any;
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
 * Waits for the suite run fold projection to reach the expected status.
 * The fold projection state IS the checkpoint — no separate checkpoint store needed.
 */
async function waitForSuiteRunState(
  pipeline: ReturnType<typeof createSuiteRunTestPipeline>,
  batchRunId: string,
  tenantId: ReturnType<typeof createTenantId>,
  expectedStatus: string,
  timeoutMs = 15000,
): Promise<void> {
  const startTime = Date.now();
  const pollIntervalMs = 100;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const projection = (await pipeline.service.getProjectionByName(
        "suiteRunState",
        batchRunId,
        { tenantId },
      )) as SuiteRunState | null;

      if (projection && projection.data.Status === expectedStatus) {
        // Add a delay for ClickHouse eventual consistency
        // The projection data might not be fully visible immediately
        await new Promise((resolve) => setTimeout(resolve, 500));
        return;
      }
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        "Error checking suite run state, retrying...",
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
      "suiteRunState",
      batchRunId,
      { tenantId },
    )) as SuiteRunState | null;

    if (projection && projection.data.Status === expectedStatus) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return;
    }
  } catch {
    /* ignore */
  }

  throw new Error(
    `Timeout waiting for suite run state. Expected status "${expectedStatus}" for batch run ${batchRunId}`,
  );
}

// Skip when running without testcontainers (Prisma-only integration tests)
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

describe.skipIf(!hasTestcontainers)(
  "Suite Run Processing Pipeline - Integration Tests",
  () => {
    let pipeline: ReturnType<typeof createSuiteRunTestPipeline>;
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;

    beforeEach(async () => {
      pipeline = createSuiteRunTestPipeline();
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
      it("processes complete suite run lifecycle: start -> items -> complete", async () => {
        const batchRunId = generateTestBatchRunId();
        const suiteId = generateTestSuiteId();
        const scenarioRunId1 = generateTestScenarioRunId();
        const scenarioRunId2 = generateTestScenarioRunId();

        // Start suite run with total=2
        await pipeline.commands.startSuiteRun.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioSetId: "scenario-set-1",
          suiteId,
          total: 2,
          scenarioIds: ["scenario-1", "scenario-2"],
          targetIds: ["target-1"],
          idempotencyKey: `idem-${batchRunId}`,
          occurredAt: Date.now(),
        });
        await waitForClickHouseConsistency();

        // Verify IN_PROGRESS after start
        await waitForSuiteRunState(
          pipeline,
          batchRunId,
          tenantId,
          "IN_PROGRESS",
        );

        // Record item 1 started
        await pipeline.commands.recordSuiteRunItemStarted.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioRunId: scenarioRunId1,
          scenarioId: "scenario-1",
          occurredAt: Date.now(),
        });
        await waitForClickHouseConsistency();

        // Complete item 1 as SUCCESS with verdict
        await pipeline.commands.completeSuiteRunItem.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioRunId: scenarioRunId1,
          scenarioId: "scenario-1",
          status: "SUCCESS",
          verdict: "success",
          durationMs: 1500,
          occurredAt: Date.now(),
        });
        await waitForClickHouseConsistency();

        // Record item 2 started
        await pipeline.commands.recordSuiteRunItemStarted.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioRunId: scenarioRunId2,
          scenarioId: "scenario-2",
          occurredAt: Date.now(),
        });
        await waitForClickHouseConsistency();

        // Complete item 2 as SUCCESS with verdict
        await pipeline.commands.completeSuiteRunItem.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioRunId: scenarioRunId2,
          scenarioId: "scenario-2",
          status: "SUCCESS",
          verdict: "success",
          durationMs: 2000,
          occurredAt: Date.now(),
        });

        // Wait for fold projection to reach final status
        await waitForSuiteRunState(
          pipeline,
          batchRunId,
          tenantId,
          "SUCCESS",
        );

        // Verify final projection state
        const projection = (await pipeline.service.getProjectionByName(
          "suiteRunState",
          batchRunId,
          { tenantId },
        )) as SuiteRunState | null;

        expect(projection).toBeDefined();
        expect(projection?.data.Status).toBe("SUCCESS");
        expect(projection?.data.SuiteId).toBe(suiteId);
        expect(projection?.data.Total).toBe(2);
        expect(projection?.data.CompletedCount).toBe(2);
        expect(projection?.data.FailedCount).toBe(0);
        expect(projection?.data.StartedCount).toBe(2);
        expect(projection?.data.Progress).toBe(2);
        expect(projection?.data.PassRateBps).toBe(10000);
        expect(projection?.data.StartedAt).not.toBeNull();
        expect(projection?.data.FinishedAt).not.toBeNull();
      });

      it("derives FAILURE status when any item fails", async () => {
        const batchRunId = generateTestBatchRunId();
        const suiteId = generateTestSuiteId();
        const scenarioRunId1 = generateTestScenarioRunId();
        const scenarioRunId2 = generateTestScenarioRunId();

        // Start suite run with total=2
        await pipeline.commands.startSuiteRun.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioSetId: "scenario-set-1",
          suiteId,
          total: 2,
          scenarioIds: ["scenario-1", "scenario-2"],
          targetIds: ["target-1"],
          idempotencyKey: `idem-${batchRunId}`,
          occurredAt: Date.now(),
        });
        await waitForClickHouseConsistency();

        // Record and complete item 1 as SUCCESS
        await pipeline.commands.recordSuiteRunItemStarted.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioRunId: scenarioRunId1,
          scenarioId: "scenario-1",
          occurredAt: Date.now(),
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.completeSuiteRunItem.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioRunId: scenarioRunId1,
          scenarioId: "scenario-1",
          status: "SUCCESS",
          verdict: "success",
          durationMs: 1200,
          occurredAt: Date.now(),
        });
        await waitForClickHouseConsistency();

        // Record and complete item 2 as FAILURE
        await pipeline.commands.recordSuiteRunItemStarted.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioRunId: scenarioRunId2,
          scenarioId: "scenario-2",
          occurredAt: Date.now(),
        });
        await waitForClickHouseConsistency();

        await pipeline.commands.completeSuiteRunItem.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioRunId: scenarioRunId2,
          scenarioId: "scenario-2",
          status: "FAILURE",
          verdict: "failure",
          error: "Assertion failed",
          durationMs: 800,
          occurredAt: Date.now(),
        });

        // Wait for fold projection to reach final status
        await waitForSuiteRunState(
          pipeline,
          batchRunId,
          tenantId,
          "FAILURE",
        );

        // Verify final state
        const projection = (await pipeline.service.getProjectionByName(
          "suiteRunState",
          batchRunId,
          { tenantId },
        )) as SuiteRunState | null;

        expect(projection?.data.Status).toBe("FAILURE");
        expect(projection?.data.CompletedCount).toBe(1);
        expect(projection?.data.FailedCount).toBe(1);
        expect(projection?.data.Progress).toBe(2);
        expect(projection?.data.FinishedAt).not.toBeNull();
      });
    });

    describe("Concurrent Suite Runs Tests", () => {
      it("processes multiple suite runs concurrently without interference", async () => {
        const batchRunId1 = generateTestBatchRunId();
        const batchRunId2 = generateTestBatchRunId();
        const suiteId1 = generateTestSuiteId();
        const suiteId2 = generateTestSuiteId();
        const scenarioRunId1 = generateTestScenarioRunId();
        const scenarioRunId2 = generateTestScenarioRunId();

        // Start both suite runs concurrently
        await Promise.all([
          pipeline.commands.startSuiteRun.send({
            tenantId: tenantIdString,
            batchRunId: batchRunId1,
            scenarioSetId: "scenario-set-1",
            suiteId: suiteId1,
            total: 1,
            scenarioIds: ["scenario-1"],
            targetIds: ["target-1"],
            idempotencyKey: `idem-${batchRunId1}`,
            occurredAt: Date.now(),
          }),
          pipeline.commands.startSuiteRun.send({
            tenantId: tenantIdString,
            batchRunId: batchRunId2,
            scenarioSetId: "scenario-set-2",
            suiteId: suiteId2,
            total: 1,
            scenarioIds: ["scenario-2"],
            targetIds: ["target-2"],
            idempotencyKey: `idem-${batchRunId2}`,
            occurredAt: Date.now(),
          }),
        ]);

        // Wait for both to reach IN_PROGRESS
        await Promise.all([
          waitForSuiteRunState(pipeline, batchRunId1, tenantId, "IN_PROGRESS"),
          waitForSuiteRunState(pipeline, batchRunId2, tenantId, "IN_PROGRESS"),
        ]);

        // Record and complete items for both runs
        await Promise.all([
          pipeline.commands.recordSuiteRunItemStarted.send({
            tenantId: tenantIdString,
            batchRunId: batchRunId1,
            scenarioRunId: scenarioRunId1,
            scenarioId: "scenario-1",
            occurredAt: Date.now(),
          }),
          pipeline.commands.recordSuiteRunItemStarted.send({
            tenantId: tenantIdString,
            batchRunId: batchRunId2,
            scenarioRunId: scenarioRunId2,
            scenarioId: "scenario-2",
            occurredAt: Date.now(),
          }),
        ]);
        await waitForClickHouseConsistency();

        await Promise.all([
          pipeline.commands.completeSuiteRunItem.send({
            tenantId: tenantIdString,
            batchRunId: batchRunId1,
            scenarioRunId: scenarioRunId1,
            scenarioId: "scenario-1",
            status: "SUCCESS",
            verdict: "success",
            occurredAt: Date.now(),
          }),
          pipeline.commands.completeSuiteRunItem.send({
            tenantId: tenantIdString,
            batchRunId: batchRunId2,
            scenarioRunId: scenarioRunId2,
            scenarioId: "scenario-2",
            status: "SUCCESS",
            verdict: "success",
            occurredAt: Date.now(),
          }),
        ]);

        // Wait for both to complete
        await Promise.all([
          waitForSuiteRunState(pipeline, batchRunId1, tenantId, "SUCCESS"),
          waitForSuiteRunState(pipeline, batchRunId2, tenantId, "SUCCESS"),
        ]);

        // Verify each has its own projection state
        const [projection1, projection2] = (await Promise.all([
          pipeline.service.getProjectionByName("suiteRunState", batchRunId1, {
            tenantId,
          }),
          pipeline.service.getProjectionByName("suiteRunState", batchRunId2, {
            tenantId,
          }),
        ])) as [SuiteRunState | null, SuiteRunState | null];

        expect(projection1?.data.SuiteId).toBe(suiteId1);
        expect(projection2?.data.SuiteId).toBe(suiteId2);
        expect(projection1?.data.Status).toBe("SUCCESS");
        expect(projection2?.data.Status).toBe("SUCCESS");
        expect(projection1?.data.BatchRunId).toBe(batchRunId1);
        expect(projection2?.data.BatchRunId).toBe(batchRunId2);
      });
    });

    describe("State Transitions Tests", () => {
      it("reaches IN_PROGRESS status after start event", async () => {
        const batchRunId = generateTestBatchRunId();
        const suiteId = generateTestSuiteId();

        await pipeline.commands.startSuiteRun.send({
          tenantId: tenantIdString,
          batchRunId,
          scenarioSetId: "scenario-set-1",
          suiteId,
          total: 3,
          scenarioIds: ["scenario-1", "scenario-2", "scenario-3"],
          targetIds: ["target-1"],
          idempotencyKey: `idem-${batchRunId}`,
          occurredAt: Date.now(),
        });

        await waitForSuiteRunState(
          pipeline,
          batchRunId,
          tenantId,
          "IN_PROGRESS",
        );

        // Verify projection populated from start event
        const projection = (await pipeline.service.getProjectionByName(
          "suiteRunState",
          batchRunId,
          { tenantId },
        )) as SuiteRunState | null;

        expect(projection?.data.Status).toBe("IN_PROGRESS");
        expect(projection?.data.SuiteId).toBe(suiteId);
        expect(projection?.data.Total).toBe(3);
        expect(projection?.data.ScenarioSetId).toBe("scenario-set-1");
        expect(projection?.data.BatchRunId).toBe(batchRunId);
        expect(projection?.data.StartedAt).not.toBeNull();
        expect(projection?.data.CompletedCount).toBe(0);
        expect(projection?.data.FailedCount).toBe(0);
        expect(projection?.data.Progress).toBe(0);
        expect(projection?.data.FinishedAt).toBeNull();
      });
    });
  },
  60000,
); // 60 second timeout for integration tests
