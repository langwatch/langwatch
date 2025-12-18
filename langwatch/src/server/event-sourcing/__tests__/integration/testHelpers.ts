import { createLogger } from "~/utils/logger";
import type { AggregateType } from "../../library";
import { createTenantId } from "../../library";
import { buildCheckpointKey } from "../../library/utils/checkpointKey";
import { RedisDistributedLock } from "../../library/utils/distributedLock";
import { EventSourcing } from "../../runtime/eventSourcing";
import { EventSourcingRuntime } from "../../runtime/eventSourcingRuntime";
import type {
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "../../runtime/pipeline/types";
import { BullmqQueueProcessorFactory } from "../../runtime/queue/factory";
import { EventStoreClickHouse } from "../../runtime/stores/eventStoreClickHouse";
import { ProcessorCheckpointStoreClickHouse } from "../../runtime/stores/processorCheckpointStoreClickHouse";
import { CheckpointRepositoryClickHouse } from "../../runtime/stores/repositories/checkpointRepositoryClickHouse";
import { EventRepositoryClickHouse } from "../../runtime/stores/repositories/eventRepositoryClickHouse";
import {
  cleanupTestData,
  getTestClickHouseClient,
  getTestRedisConnection,
} from "./testContainers";
import {
  TestCommandHandler,
  TestEventHandler,
  TestProjectionHandler,
} from "./testPipelines";

const logger = createLogger(
  "langwatch:event-sourcing:tests:integration:test-helpers",
);

/**
 * Creates a test pipeline using real ClickHouse and Redis (BullMQ).
 * This is the main helper for integration tests.
 */
export function createTestPipeline(): PipelineWithCommandHandlers<
  RegisteredPipeline<any, any>,
  { testCommand: any }
> & {
  eventStore: EventStoreClickHouse;
} {
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

  const processorCheckpointStore = new ProcessorCheckpointStoreClickHouse(
    new CheckpointRepositoryClickHouse(clickHouseClient),
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

  // Build pipeline
  // Note: TestProjectionHandler has a static store property, so we don't need to pass it
  // Using test aggregate type (now included in production schemas)
  const pipeline = eventSourcing
    .registerPipeline<any>()
    .withName("test_pipeline")
    .withAggregateType("test_aggregate" as AggregateType)
    .withCommand("testCommand", TestCommandHandler as any)
    .withEventHandler("testHandler", TestEventHandler as any)
    .withProjection("testProjection", TestProjectionHandler as any)
    .build();

  return {
    ...pipeline,
    eventStore,
  } as PipelineWithCommandHandlers<
    RegisteredPipeline<any, any>,
    { testCommand: any }
  > & {
    eventStore: EventStoreClickHouse;
  };
}

/**
 * Waits for a checkpoint to reach the expected sequence number.
 * This is the most reliable way to ensure handlers have processed events.
 */
export async function waitForCheckpoint(
  pipelineName: string,
  processorName: string,
  aggregateId: string,
  tenantId: string,
  expectedSequenceNumber: number,
  timeoutMs = 5000,
  pollIntervalMs = 100,
): Promise<void> {
  const startTime = Date.now();

  // Check immediately first - handlers might already be done
  let checkpoint = await verifyCheckpoint(
    pipelineName,
    processorName,
    aggregateId,
    tenantId,
    expectedSequenceNumber,
  );

  if (checkpoint) {
    return;
  }

  // If not found, wait briefly then poll aggressively
  // Give handlers a moment to start processing (but not too long)
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Poll with increasing intervals - start fast, slow down over time
  while (Date.now() - startTime < timeoutMs) {
    checkpoint = await verifyCheckpoint(
      pipelineName,
      processorName,
      aggregateId,
      tenantId,
      expectedSequenceNumber,
    );

    if (checkpoint) {
      return;
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

  const finalCheckpoint = await verifyCheckpoint(
    pipelineName,
    processorName,
    aggregateId,
    tenantId,
    expectedSequenceNumber,
  );

  // If checkpoint exists in final check, return successfully
  // This handles ClickHouse eventual consistency where data might not be immediately visible
  if (finalCheckpoint) {
    return;
  }

  throw new Error(
    `Timeout waiting for checkpoint. Expected sequence ${expectedSequenceNumber}, checkpoint exists: ${finalCheckpoint}`,
  );
}

/**
 * Cleans up test data for a specific tenant.
 */
export async function cleanupTestDataForTenant(
  tenantId: string,
): Promise<void> {
  await cleanupTestData(tenantId);
}

/**
 * Generates a unique tenant ID string for tests.
 */
export function generateTestTenantId(): string {
  return `test-tenant-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Creates a test tenant ID object.
 */
export function createTestTenantId(): ReturnType<typeof createTenantId> {
  return createTenantId(generateTestTenantId());
}

/**
 * Gets the tenant ID string from a TenantId object.
 */
export function getTenantIdString(
  tenantId: ReturnType<typeof createTenantId>,
): string {
  return String(tenantId);
}

/**
 * Helper to verify checkpoint state.
 */
export async function verifyCheckpoint(
  pipelineName: string,
  processorName: string,
  aggregateId: string,
  tenantId: string,
  expectedSequenceNumber?: number,
): Promise<boolean> {
  const clickHouseClient = getTestClickHouseClient();
  if (!clickHouseClient) {
    logger.debug(
      {
        pipelineName,
        processorName,
        aggregateId,
        tenantId,
        expectedSequenceNumber,
        testForceClickHouse:
          process.env.TEST_FORCE_CLICKHOUSE_CHECKPOINTS === "true",
      },
      "[verifyCheckpoint] ClickHouse client unavailable for checkpoint check",
    );
    return false;
  }

  // Use buildCheckpointKey to ensure consistency with actual code
  const tenantIdObj = createTenantId(tenantId);
  const checkpointKey = buildCheckpointKey(
    tenantIdObj,
    pipelineName,
    processorName,
    "test_aggregate",
    aggregateId,
  );

  // Fast query without FINAL - optimized for speed
  // Use >= to find checkpoint at or above expected sequence (more lenient for timing)
  const result = await clickHouseClient.query({
    query: `
      SELECT SequenceNumber, Status, EventId
      FROM processor_checkpoints
      WHERE CheckpointKey = {checkpointKey:String}
        AND Status = 'processed'
        AND SequenceNumber >= {expectedSequence:UInt32}
      ORDER BY SequenceNumber DESC
      LIMIT 1
    `,
    query_params: {
      checkpointKey,
      expectedSequence: expectedSequenceNumber ?? 0,
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    SequenceNumber: number | string;
    Status: string;
    EventId: string;
  }>();

  logger.debug(
    {
      checkpointKey,
      rows,
      expectedSequenceNumber,
      hasClickHouseClient: true,
    },
    "[verifyCheckpoint] Result",
  );

  if (rows.length === 0) {
    logger.debug(
      {
        checkpointKey,
        expectedSequenceNumber,
        tenantId,
        processorName,
        aggregateId,
      },
      "[verifyCheckpoint] No processed checkpoint rows",
    );
    return false;
  }

  const checkpoint = rows[0];
  if (!checkpoint) {
    logger.debug(
      {
        checkpointKey,
        rowsLength: rows.length,
      },
      "[verifyCheckpoint] First checkpoint row missing",
    );
    return false;
  }

  const checkpointSequenceNumber = Number(checkpoint.SequenceNumber);
  if (Number.isNaN(checkpointSequenceNumber)) {
    logger.debug(
      {
        checkpointKey,
        rawSequenceNumber: checkpoint.SequenceNumber,
      },
      "[verifyCheckpoint] Invalid sequence number",
    );
    return false;
  }

  // If expected sequence is provided, check that we've reached at least that sequence
  // (>= is fine - it means processing has progressed beyond what we're waiting for)
  if (
    expectedSequenceNumber !== void 0 &&
    checkpointSequenceNumber < expectedSequenceNumber
  ) {
    logger.debug(
      {
        checkpointKey,
        expectedSequenceNumber,
        actualSequenceNumber: checkpointSequenceNumber,
      },
      "[verifyCheckpoint] Sequence not yet reached",
    );
    return false;
  }

  return checkpoint.Status === "processed";
}

/**
 * Helper to verify event handler processed an event.
 */
export async function verifyEventHandlerProcessed(
  eventId: string,
  tenantId: string,
): Promise<boolean> {
  const clickHouseClient = getTestClickHouseClient();
  if (!clickHouseClient) {
    return false;
  }

  const result = await clickHouseClient.query({
    query: `
      SELECT COUNT(*) as count
      FROM "test_langwatch".test_event_handler_log
      WHERE EventId = {eventId:String}
        AND TenantId = {tenantId:String}
    `,
    query_params: { eventId, tenantId },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ count: number | string }>();
  const processedCount = Number(rows[0]?.count ?? 0);
  const processed = processedCount > 0;
  if (!processed) {
    logger.debug(
      {
        eventId,
        tenantId,
        processedCount,
      },
      "[verifyEventHandlerProcessed] Missing event handler record",
    );
  }
  return processed;
}
