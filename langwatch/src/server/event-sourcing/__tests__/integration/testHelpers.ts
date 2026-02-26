import type { AggregateType } from "../../";
import { createTenantId, definePipeline } from "../../";
import { EventSourcing } from "../../eventSourcing";
import type {
	PipelineWithCommandHandlers,
	RegisteredPipeline,
} from "../../pipeline/types";
import { EventStoreClickHouse } from "../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../stores/repositories/eventRepositoryClickHouse";
import {
	cleanupTestData,
	getTestClickHouseClient,
	getTestRedisConnection,
} from "./testContainers";
import type { TestProjection } from "./testPipelines";
import {
	TestCommandHandler,
	testFoldProjection,
	testMapProjection,
} from "./testPipelines";

/**
 * Gracefully closes a pipeline and waits for cleanup to complete.
 * This ensures all BullMQ workers finish processing before the next test starts.
 */
export async function closePipelineGracefully(pipeline: {
  service: { close: () => Promise<void> };
}): Promise<void> {
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

  const eventSourcing = EventSourcing.createWithStores({
    eventStore,
    clickhouse: clickHouseClient,
    redis: redisConnection,
  });

  // Build pipeline using static definition
  // Using test aggregate type (now included in production schemas)
  const pipelineDefinition = definePipeline<any>()
    .withName(pipelineName)
    .withAggregateType("test_aggregate" as AggregateType)
    .withCommand("testCommand", TestCommandHandler as any)
    .withMapProjection("testHandler", testMapProjection as any)
    .withFoldProjection("testProjection", testFoldProjection as any)
    .build();

  const pipeline = eventSourcing.register(pipelineDefinition);

  return {
    ...pipeline,
    eventStore,
    pipelineName,
    // Wait for BullMQ workers to be ready before sending commands
    ready: () => pipeline.service.waitUntilReady(),
  } as PipelineWithCommandHandlers<
    RegisteredPipeline<any, any>,
    { testCommand: any }
  > & {
    eventStore: EventStoreClickHouse;
    pipelineName: string;
    ready: () => Promise<void>;
  };
}

/**
 * Waits for a fold projection to reach the expected event count.
 * Replaces checkpoint-based waiting — the fold state IS the checkpoint.
 */
export async function waitForProjection(
  pipeline: { service: { getProjectionByName: (name: string, aggregateId: string, context: any) => Promise<any> } },
  projectionName: string,
  aggregateId: string,
  tenantId: ReturnType<typeof createTenantId>,
  expectedEventCount: number,
  timeoutMs = 5000,
  pollIntervalMs = 100,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const projection = (await pipeline.service.getProjectionByName(
        projectionName,
        aggregateId,
        { tenantId },
      )) as TestProjection | null;

      if (projection && projection.data.eventCount >= expectedEventCount) {
        return;
      }
    } catch {
      // Projection not ready yet, keep polling
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
      projectionName,
      aggregateId,
      { tenantId },
    )) as TestProjection | null;

    if (projection && projection.data.eventCount >= expectedEventCount) {
      return;
    }

    throw new Error(
      `Timeout waiting for projection "${projectionName}". ` +
      `Expected eventCount >= ${expectedEventCount}, ` +
      `got ${projection?.data.eventCount ?? "null"}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Timeout waiting")) {
      throw error;
    }
    throw new Error(
      `Timeout waiting for projection "${projectionName}". ` +
      `Expected eventCount >= ${expectedEventCount}, got error: ${error}`,
    );
  }
}

/**
 * Waits for an event handler (map projection) to process an event.
 * Polls the test_event_handler_log table in ClickHouse.
 */
export async function waitForEventHandler(
  aggregateId: string,
  tenantId: string,
  expectedCount: number,
  timeoutMs = 5000,
  pollIntervalMs = 100,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const count = await getEventHandlerCount(aggregateId, tenantId);
    if (count >= expectedCount) {
      return;
    }

    const elapsed = Date.now() - startTime;
    const currentInterval =
      elapsed < 500
        ? pollIntervalMs
        : elapsed < 1500
          ? pollIntervalMs * 2
          : Math.min(pollIntervalMs * 3, 300);
    await new Promise((resolve) => setTimeout(resolve, currentInterval));
  }

  const finalCount = await getEventHandlerCount(aggregateId, tenantId);
  if (finalCount >= expectedCount) {
    return;
  }

  throw new Error(
    `Timeout waiting for event handler. Expected ${expectedCount} processed events for aggregate ${aggregateId}, got ${finalCount}`,
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
 * Gets the count of processed events for an aggregate from the handler log.
 */
async function getEventHandlerCount(
  aggregateId: string,
  tenantId: string,
): Promise<number> {
  const clickHouseClient = getTestClickHouseClient();
  if (!clickHouseClient) {
    throw new Error(
      "ClickHouse client not available. Integration tests require ClickHouse.",
    );
  }

  try {
    const result = await clickHouseClient.query({
      query: `
        SELECT COUNT(*) as count
        FROM "test_langwatch".test_event_handler_log
        WHERE AggregateId = {aggregateId:String}
          AND TenantId = {tenantId:String}
      `,
      query_params: { aggregateId, tenantId },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ count: number | string }>();
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}
