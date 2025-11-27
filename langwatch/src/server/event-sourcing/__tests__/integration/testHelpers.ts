import { EventSourcing } from "../../runtime/eventSourcing";
import { EventSourcingRuntime } from "../../runtime/eventSourcingRuntime";
import { EventStoreClickHouse } from "../../runtime/stores/eventStoreClickHouse";
import { ProcessorCheckpointStoreClickHouse } from "../../runtime/stores/processorCheckpointStoreClickHouse";
import { EventRepositoryClickHouse } from "../../runtime/stores/repositories/eventRepositoryClickHouse";
import { CheckpointRepositoryClickHouse } from "../../runtime/stores/repositories/checkpointRepositoryClickHouse";
import { BullmqQueueProcessorFactory } from "../../runtime/queue/factory";
import { RedisDistributedLock } from "../../library/utils/distributedLock";
import type {
  RegisteredPipeline,
  PipelineWithCommandHandlers,
} from "../../runtime/pipeline/types";
import type { AggregateType } from "../../library";
import { createTenantId } from "../../library";
import { buildCheckpointKey } from "../../library/utils/checkpointKey";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
  cleanupTestData,
} from "./testContainers";
import {
  TestCommandHandler,
  TestEventHandler,
  TestProjectionHandler,
} from "./testPipelines";
import { createLogger } from "~/utils/logger";

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
    .registerPipeline<any, any>()
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
 * Waits for all queue jobs to complete.
 * Polls queue status until all jobs are processed.
 */
export async function waitForQueueProcessing(
  timeoutMs = 30000,
  pollIntervalMs = 100,
): Promise<void> {
  const redisConnection = getTestRedisConnection();
  if (!redisConnection) {
    return;
  }

  const startTime = Date.now();
  let consecutiveEmptyChecks = 0;
  const requiredEmptyChecks = 3; // Require 3 consecutive empty checks to ensure processing is complete

  while (Date.now() - startTime < timeoutMs) {
    // Check if there are any active jobs in BullMQ queues
    const active = await redisConnection.keys("bull:*:active");
    const waiting = await redisConnection.keys("bull:*:waiting");
    const delayed = await redisConnection.keys("bull:*:delayed");
    const failed = await redisConnection.keys("bull:*:failed");

    // Check for failed jobs - if there are any, something went wrong
    if (failed.length > 0) {
      // Get details of failed jobs for debugging
      const failedJobDetails: string[] = [];
      const errorMessages: string[] = [];

      for (const key of failed.slice(0, 5)) {
        // Extract queue name from key (format: bull:queueName:failed)
        const queueName = key.split(":")[1];
        if (queueName) {
          try {
            const jobIds = await redisConnection.zrange(key, 0, 4);
            if (jobIds.length > 0) {
              failedJobDetails.push(
                `${queueName}: ${jobIds.length} failed job(s)`,
              );

              // Get actual error messages from failed jobs
              for (const jobId of jobIds.slice(0, 3)) {
                try {
                  // BullMQ stores job data in a hash at bull:queueName:jobId
                  const jobDataKey = `bull:${queueName}:${jobId}`;
                  const jobData = await redisConnection.hgetall(jobDataKey);

                  // Extract error information
                  const failedReason =
                    jobData.failedReason ?? jobData.reason ?? "Unknown error";
                  const stacktrace = jobData.stacktrace ?? "";

                  // Get job data/payload for context
                  let jobPayload = "N/A";
                  try {
                    const dataStr = jobData.data;
                    if (dataStr) {
                      const parsed = JSON.parse(dataStr);
                      jobPayload = JSON.stringify(parsed, null, 2).substring(
                        0,
                        200,
                      );
                    }
                  } catch {
                    // Ignore parse errors
                  }

                  errorMessages.push(
                    `\n  ${queueName}:${jobId}\n    Error: ${failedReason}\n    Payload: ${jobPayload}${stacktrace ? `\n    Stack: ${stacktrace.substring(0, 300)}` : ""}`,
                  );
                } catch (jobError) {
                  // If we can't get job details, at least report the job ID
                  errorMessages.push(
                    `\n  ${queueName}:${jobId}\n    Error: Could not retrieve job details`,
                  );
                }
              }
            }
          } catch {
            // Ignore errors when inspecting failed jobs
          }
        }
      }

      if (failedJobDetails.length > 0) {
        const errorSummary =
          errorMessages.length > 0
            ? `\n\nDetailed errors:${errorMessages.join("\n")}`
            : "";
        throw new Error(
          `Queue processing found failed jobs: ${failedJobDetails.join(", ")}.${errorSummary}\n\nCheck logs for more details.`,
        );
      }
    }

    if (active.length === 0 && waiting.length === 0 && delayed.length === 0) {
      consecutiveEmptyChecks++;
      if (consecutiveEmptyChecks >= requiredEmptyChecks) {
        // Give it a bit more time to ensure all async operations complete
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs * 2));
        return;
      }
    } else {
      consecutiveEmptyChecks = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Final check for failed jobs before throwing timeout
  const finalFailed = await redisConnection.keys("bull:*:failed");
  if (finalFailed.length > 0) {
    const errorMessages: string[] = [];

    for (const key of finalFailed.slice(0, 5)) {
      const queueName = key.split(":")[1];
      if (queueName) {
        try {
          const jobIds = await redisConnection.zrange(key, 0, 2);
          for (const jobId of jobIds) {
            try {
              const jobDataKey = `bull:${queueName}:${jobId}`;
              const jobData = await redisConnection.hgetall(jobDataKey);
              const failedReason =
                jobData.failedReason ?? jobData.reason ?? "Unknown error";
              errorMessages.push(`\n  ${queueName}:${jobId} - ${failedReason}`);
            } catch {
              errorMessages.push(
                `\n  ${queueName}:${jobId} - Could not retrieve error`,
              );
            }
          }
        } catch {
          // Ignore errors
        }
      }
    }

    const errorDetails =
      errorMessages.length > 0
        ? `\n\nFailed job errors:${errorMessages.join("")}`
        : "";
    throw new Error(
      `Queue processing timeout after ${timeoutMs}ms. Some jobs may have failed.${errorDetails}\n\nCheck logs for more details.`,
    );
  }

  throw new Error(
    `Queue processing timeout after ${timeoutMs}ms. Active jobs may still be processing.`,
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

  // Query with FINAL to get the latest merged version from ReplacingMergeTree
  // Filter by Status='processed' to only get successfully processed checkpoints
  // Use same table reference format as repository (rely on default database)
  const result = await clickHouseClient.query({
    query: `
      SELECT SequenceNumber, Status, EventId
      FROM processor_checkpoints FINAL
      WHERE CheckpointKey = {checkpointKey:String}
        AND Status = 'processed'
      ORDER BY SequenceNumber DESC
      LIMIT 1
    `,
    query_params: { checkpointKey },
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

  if (
    expectedSequenceNumber !== void 0 &&
    checkpointSequenceNumber !== expectedSequenceNumber
  ) {
    logger.debug(
      {
        checkpointKey,
        expectedSequenceNumber,
        actualSequenceNumber: checkpointSequenceNumber,
      },
      "[verifyCheckpoint] Sequence mismatch",
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
