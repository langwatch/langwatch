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
import { CheckpointCacheRedis } from "../../runtime/stores/checkpointCacheRedis";
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
 * Gracefully closes a pipeline and waits for cleanup to complete.
 * This ensures all BullMQ workers finish processing before the next test starts.
 */
export async function closePipelineGracefully(
  pipeline: { service: { close: () => Promise<void> } },
): Promise<void> {
  await pipeline.service.close();
  // Wait for BullMQ workers to fully shut down and release Redis connections
  // Using 2000ms to ensure all async operations complete before next test
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

/**
 * Generates a unique aggregate ID to avoid collisions in parallel tests.
 */
export function generateTestAggregateId(
  prefix: string = "test-aggregate",
): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a test pipeline using real ClickHouse and Redis (BullMQ).
 * This is the main helper for integration tests.
 * Each call generates a unique pipeline name to avoid conflicts in parallel tests.
 * Returns a promise that includes a ready() function to await worker initialization.
 */
export function createTestPipeline(): PipelineWithCommandHandlers<
  RegisteredPipeline<any, any>,
  { testCommand: any }
> & {
  eventStore: EventStoreClickHouse;
  processorCheckpointStore: ProcessorCheckpointStoreClickHouse;
  pipelineName: string;
  /** Wait for BullMQ workers to be ready before sending commands */
  ready: () => Promise<void>;
} {
  // Generate unique pipeline name to avoid conflicts when tests run in parallel
  const pipelineName = `test_pipeline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  // Build pipeline
  // Note: TestProjectionHandler has a static store property, so we don't need to pass it
  // Using test aggregate type (now included in production schemas)
  // Use event-based deduplication for tests to ensure each event gets its own job.
  // In production, aggregate-based deduplication is used for debouncing, but the batch
  // processor handles fetching all events. For tests, we want each event processed
  // independently to verify the pipeline behavior.
  const eventBasedDeduplication = {
    makeId: (event: { id: string }) => event.id,
    ttlMs: 100,
  };

  const pipeline = eventSourcing
    .registerPipeline<any>()
    .withName(pipelineName)
    .withAggregateType("test_aggregate" as AggregateType)
    .withCommand("testCommand", TestCommandHandler as any)
    .withEventHandler("testHandler", TestEventHandler as any, {
      deduplication: eventBasedDeduplication,
    })
    .withProjection("testProjection", TestProjectionHandler as any, {
      deduplication: eventBasedDeduplication,
    })
    .build();

  return {
    ...pipeline,
    eventStore,
    processorCheckpointStore,
    pipelineName,
    // Wait for BullMQ workers to be ready before sending commands
    ready: () => pipeline.service.waitUntilReady(),
  } as PipelineWithCommandHandlers<
    RegisteredPipeline<any, any>,
    { testCommand: any }
  > & {
    eventStore: EventStoreClickHouse;
    processorCheckpointStore: ProcessorCheckpointStoreClickHouse;
    pipelineName: string;
    ready: () => Promise<void>;
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
  processorCheckpointStore?: ProcessorCheckpointStoreClickHouse,
): Promise<void> {
  const startTime = Date.now();

  // Check immediately first - handlers might already be done
  let checkpoint = await verifyCheckpoint(
    pipelineName,
    processorName,
    aggregateId,
    tenantId,
    expectedSequenceNumber,
    processorCheckpointStore,
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
      processorCheckpointStore,
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
    processorCheckpointStore,
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
 * Uses the ProcessorCheckpointStore which checks Redis cache first, then ClickHouse.
 * This matches production behavior and avoids ClickHouse eventual consistency issues.
 */
export async function verifyCheckpoint(
  pipelineName: string,
  processorName: string,
  aggregateId: string,
  tenantId: string,
  expectedSequenceNumber?: number,
  processorCheckpointStore?: ProcessorCheckpointStoreClickHouse,
): Promise<boolean> {
  const tenantIdObj = createTenantId(tenantId);

  // If checkpoint store is provided, use it (preferred - checks Redis cache first)
  if (processorCheckpointStore && expectedSequenceNumber !== void 0) {
    try {
      // Infer processor type from processor name
      // Convention: handlers end with "Handler", projections end with "Projection"
      const processorType = processorName.endsWith("Handler")
        ? ("handler" as const)
        : ("projection" as const);

      const checkpoint =
        await processorCheckpointStore.getCheckpointBySequenceNumber(
          pipelineName,
          processorName,
          processorType,
          tenantIdObj,
          "test_aggregate" as AggregateType,
          aggregateId,
          expectedSequenceNumber,
        );

      logger.debug(
        {
          pipelineName,
          processorName,
          aggregateId,
          tenantId,
          expectedSequenceNumber,
          checkpoint: checkpoint
            ? {
                sequenceNumber: checkpoint.sequenceNumber,
                status: checkpoint.status,
              }
            : null,
        },
        "[verifyCheckpoint] Result from checkpoint store",
      );

      return checkpoint !== null && checkpoint.status === "processed";
    } catch (error) {
      logger.error(
        {
          pipelineName,
          processorName,
          aggregateId,
          tenantId,
          expectedSequenceNumber,
          error: error instanceof Error ? error.message : String(error),
        },
        "[verifyCheckpoint] Error checking checkpoint store",
      );
      return false;
    }
  }

  // Fallback to direct ClickHouse query if checkpoint store not provided
  const clickHouseClient = getTestClickHouseClient();
  if (!clickHouseClient) {
    logger.debug(
      {
        pipelineName,
        processorName,
        aggregateId,
        tenantId,
        expectedSequenceNumber,
      },
      "[verifyCheckpoint] ClickHouse client unavailable for checkpoint check",
    );
    return false;
  }

  const checkpointKey = buildCheckpointKey(
    tenantIdObj,
    pipelineName,
    processorName,
    "test_aggregate",
    aggregateId,
  );

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
    },
    "[verifyCheckpoint] Result from ClickHouse",
  );

  if (rows.length === 0) {
    return false;
  }

  const checkpoint = rows[0];
  if (!checkpoint) {
    return false;
  }

  const checkpointSequenceNumber = Number(checkpoint.SequenceNumber);
  if (Number.isNaN(checkpointSequenceNumber)) {
    return false;
  }

  if (
    expectedSequenceNumber !== void 0 &&
    checkpointSequenceNumber < expectedSequenceNumber
  ) {
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
