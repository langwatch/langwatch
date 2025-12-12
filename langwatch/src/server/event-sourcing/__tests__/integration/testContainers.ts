import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";
import {
  RedisContainer,
  type StartedRedisContainer,
} from "@testcontainers/redis";
import IORedis, { type Redis } from "ioredis";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:event-sourcing:test-containers");

let clickHouseContainer: StartedClickHouseContainer | null = null;
let redisContainer: StartedRedisContainer | null = null;
let clickHouseClient: ClickHouseClient | null = null;
let redisConnection: Redis | null = null;

/**
 * Common labels for testcontainers to help with cleanup.
 * Ryuk (testcontainers' cleanup daemon) uses these labels.
 */
const CONTAINER_LABELS = {
  "langwatch.test": "true",
  "langwatch.test.type": "integration",
};

/**
 * Checks if we're running in CI with service containers (GitHub Actions).
 * In CI, we use service containers instead of testcontainers.
 */
function isUsingServiceContainers(): boolean {
  return !!(
    process.env.CLICKHOUSE_URL &&
    process.env.REDIS_URL &&
    process.env.CI
  );
}

/**
 * Starts testcontainers for ClickHouse and Redis.
 * Should be called before running integration tests.
 * In CI (GitHub Actions), uses service containers instead.
 */
export async function startTestContainers(): Promise<{
  clickHouseClient: ClickHouseClient;
  redisConnection: Redis;
  clickHouseUrl: string;
  redisUrl: string;
}> {
  if (process.env.NODE_ENV !== "test") {
    logger.fatal(
      "startTestContainers should only be called in test environment",
    );
  }

  // If using service containers (CI), connect to them directly
  if (isUsingServiceContainers()) {
    const clickHouseUrl = process.env.CLICKHOUSE_URL!;
    const redisUrl = process.env.REDIS_URL!;

    if (!clickHouseClient) {
      // Don't set database in connection - we'll create it first
      clickHouseClient = createClient({
        url: new URL(clickHouseUrl),
      });
    }

    if (!redisConnection) {
      redisConnection = new IORedis(redisUrl, {
        maxRetriesPerRequest: 0,
        offlineQueue: true,
      });
    }

    // Initialize ClickHouse schema (creates database and tables)
    await initializeClickHouseSchema(clickHouseClient);

    // Close the old client and create a new one with the database in the URL path
    await clickHouseClient.close();
    const urlWithDatabase = new URL(clickHouseUrl);

    urlWithDatabase.pathname = "/test_langwatch";

    clickHouseClient = createClient({ url: urlWithDatabase });

    return {
      clickHouseClient,
      redisConnection,
      clickHouseUrl,
      redisUrl,
    };
  }

  // Otherwise, use testcontainers (local development)
  // Start ClickHouse container with labels for cleanup tracking
  if (!clickHouseContainer) {
    clickHouseContainer = await new ClickHouseContainer()
      .withLabels(CONTAINER_LABELS)
      .start();
  }

  // Start Redis container with labels for cleanup tracking
  if (!redisContainer) {
    redisContainer = await new RedisContainer()
      .withLabels(CONTAINER_LABELS)
      .start();
  }

  // Create ClickHouse client
  if (!clickHouseClient) {
    const clickHouseUrl = clickHouseContainer.getConnectionUrl();
    // Don't set database in connection - we'll create it first
    clickHouseClient = createClient({
      url: new URL(clickHouseUrl),
    });
  }

  // Create Redis connection
  if (!redisConnection) {
    const redisUrl = redisContainer.getConnectionUrl();
    redisConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: 0,
      offlineQueue: true,
    });
    await redisConnection.flushall();
  }

  // Initialize ClickHouse schema (creates database and tables)
  await initializeClickHouseSchema(clickHouseClient);

  // Close the old client and create a new one with the database in the URL path
  await clickHouseClient.close();
  const clickHouseUrl = clickHouseContainer.getConnectionUrl();
  const urlWithDatabase = new URL(clickHouseUrl);
  urlWithDatabase.pathname = "/test_langwatch";

  clickHouseClient = createClient({ url: urlWithDatabase });

  return {
    clickHouseClient,
    redisConnection,
    clickHouseUrl: clickHouseContainer.getConnectionUrl(),
    redisUrl: redisContainer.getConnectionUrl(),
  };
}

/**
 * Stops testcontainers and cleans up connections.
 * Should be called after integration tests complete.
 * In CI, only closes connections (doesn't stop service containers).
 */
export async function stopTestContainers(): Promise<void> {
  const errors: Error[] = [];

  // Close ClickHouse client
  if (clickHouseClient) {
    try {
      await clickHouseClient.close();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
    clickHouseClient = null;
  }

  // Close Redis connection
  if (redisConnection) {
    try {
      await redisConnection.quit();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
    redisConnection = null;
  }

  // Only stop containers if we started them (not in CI)
  if (!isUsingServiceContainers()) {
    // Stop ClickHouse container
    if (clickHouseContainer) {
      try {
        await clickHouseContainer.stop({ timeout: 10000 });
      } catch (e) {
        logger.warn("Failed to stop ClickHouse container gracefully", {
          error: e,
        });
      }
      clickHouseContainer = null;
    }

    // Stop Redis container
    if (redisContainer) {
      try {
        await redisContainer.stop({ timeout: 10000 });
      } catch (e) {
        logger.warn("Failed to stop Redis container gracefully", { error: e });
      }
      redisContainer = null;
    }
  }

  if (errors.length > 0) {
    logger.warn("Errors during container cleanup", {
      errors: errors.map((e) => e.message),
    });
  }
}

/**
 * Gets the current ClickHouse client if containers are started.
 */
export function getTestClickHouseClient(): ClickHouseClient | null {
  return clickHouseClient;
}

/**
 * Gets the current Redis connection if containers are started.
 */
export function getTestRedisConnection(): Redis | null {
  return redisConnection;
}

/**
 * Initializes ClickHouse schema with required tables.
 */
async function initializeClickHouseSchema(
  client: ClickHouseClient,
): Promise<void> {
  // Create database first
  await client.exec({
    query: `CREATE DATABASE IF NOT EXISTS "test_langwatch"`,
  });

  // Create event_log table
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS "test_langwatch".event_log
      (
          "TenantId" String CODEC(ZSTD(1)),
          "IdempotencyKey" String CODEC(ZSTD(1)),
          "AggregateType" LowCardinality(String) CODEC(ZSTD(1)),
          "AggregateId" String CODEC(ZSTD(1)),
          "EventId" String CODEC(ZSTD(1)),
          "EventType" LowCardinality(String) CODEC(ZSTD(1)),
          "EventTimestamp" DateTime64(3) CODEC(Delta(4), ZSTD(1)),
          "EventPayload" JSON CODEC(ZSTD(3)),
          "ProcessingTraceparent" String DEFAULT '' CODEC(ZSTD(1)),
          "CreatedAt" DateTime64(3) DEFAULT now64(3) CODEC(Delta(4), ZSTD(1))
      )
      ENGINE = MergeTree
      PARTITION BY (TenantId, toDate(EventTimestamp))
      ORDER BY (TenantId, AggregateType, AggregateId, EventTimestamp, EventId)
      SETTINGS index_granularity = 8192
    `,
  });

  // Create processor_checkpoints table
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS "test_langwatch".processor_checkpoints (
        CheckpointKey String,
        ProcessorName String,
        ProcessorType String,
        EventId String,
        Status String,
        EventTimestamp UInt64,
        SequenceNumber UInt64,
        ProcessedAt Nullable(UInt64),
        FailedAt Nullable(UInt64),
        ErrorMessage Nullable(String),
        TenantId String,
        AggregateType String,
        AggregateId String,
        UpdatedAt DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(UpdatedAt)
      PARTITION BY (TenantId, AggregateType)
      ORDER BY (TenantId, CheckpointKey)
    `,
  });

  // Create ingested_spans table
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS "test_langwatch".ingested_spans
      (
          "Id" String CODEC(ZSTD(1)),
          "Timestamp" DateTime64(3) CODEC(Delta(8), ZSTD(1)),
          "TraceId" String CODEC(ZSTD(1)),
          "SpanId" String CODEC(ZSTD(1)),
          "TenantId" String CODEC(ZSTD(1)),
          "ParentSpanId" String CODEC(ZSTD(1)),
          "TraceState" String CODEC(ZSTD(1)),
          "SpanName" LowCardinality(String) CODEC(ZSTD(1)),
          "SpanKind" LowCardinality(String) CODEC(ZSTD(1)),
          "ServiceName" LowCardinality(String) CODEC(ZSTD(1)),
          "ResourceAttributes" Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          "ScopeName" String CODEC(ZSTD(1)),
          "ScopeVersion" String CODEC(ZSTD(1)),
          "SpanAttributes" Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          "Duration" Int64 CODEC(ZSTD(1)),
          "StatusCode" LowCardinality(String) CODEC(ZSTD(1)),
          "StatusMessage" String CODEC(ZSTD(1)),
          "Events.Timestamp" Array(DateTime64(3)) CODEC(ZSTD(1)),
          "Events.Name" Array(LowCardinality(String)) CODEC(ZSTD(1)),
          "Events.Attributes" Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
          "Links.TraceId" Array(String) CODEC(ZSTD(1)),
          "Links.SpanId" Array(String) CODEC(ZSTD(1)),
          "Links.TraceState" Array(String) CODEC(ZSTD(1)),
          "Links.Attributes" Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
          INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
          INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
          INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
          INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
          INDEX idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
          INDEX idx_duration Duration TYPE minmax GRANULARITY 1
      )
      ENGINE = ReplacingMergeTree(Timestamp)
      PARTITION BY (toDate(Timestamp), TenantId)
      ORDER BY (TenantId, TraceId, SpanId)
      SETTINGS index_granularity = 8192
    `,
  });

  // Create trace_summaries table
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS "test_langwatch".trace_summaries
      (
        Id String CODEC(ZSTD(1)),
        TenantId String CODEC(ZSTD(1)),
        TraceId String CODEC(ZSTD(1)),
        Version DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        IOSchemaVersion String CODEC(ZSTD(1)),
        ComputedInput  Nullable(String) CODEC(ZSTD(1)),
        ComputedOutput Nullable(String) CODEC(ZSTD(1)),
        ComputedMetadata Map(String, String) CODEC(ZSTD(1)),
        TimeToFirstTokenMs Nullable(UInt32),
        TimeToLastTokenMs  Nullable(UInt32),
        TotalDurationMs Int64,
        TokensPerSecond Nullable(UInt32),
        SpanCount UInt32,
        ContainsErrorStatus Boolean,
        ContainsOKStatus Boolean,
        Models Array(String),
        TopicId Nullable(String),
        SubTopicId Nullable(String),
        TotalPromptTokenCount Nullable(UInt32),
        TotalCompletionTokenCount Nullable(UInt32),
        HasAnnotation Nullable(Boolean),
        CreatedAt DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        LastUpdatedAt DateTime64(9) CODEC(Delta(8), ZSTD(1))
      )
      ENGINE = ReplacingMergeTree(SpanCount)
      PARTITION BY (toDate(CreatedAt), TenantId)
      ORDER BY (TenantId, CreatedAt)
      SETTINGS index_granularity = 8192
    `,
  });
}

/**
 * Cleans up test data from ClickHouse tables and Redis queues.
 * Useful for test isolation.
 * Uses TRUNCATE for synchronous cleanup (faster and more reliable than DELETE).
 */
export async function cleanupTestData(tenantId?: string): Promise<void> {
  // Clean up Redis queues (BullMQ stores queues in Redis)
  if (redisConnection) {
    await redisConnection.flushall();
  }

  if (!clickHouseClient) {
    return;
  }

  if (tenantId) {
    // Clean up specific tenant data using DELETE (TRUNCATE doesn't support WHERE)
    await clickHouseClient.exec({
      query: `
        ALTER TABLE "test_langwatch".event_log DELETE WHERE TenantId = {tenantId:String}
      `,
      query_params: { tenantId },
    });

    await clickHouseClient.exec({
      query: `
        ALTER TABLE "test_langwatch".processor_checkpoints DELETE WHERE TenantId = {tenantId:String}
      `,
      query_params: { tenantId },
    });

    await clickHouseClient.exec({
      query: `
        ALTER TABLE "test_langwatch".ingested_spans DELETE WHERE TenantId = {tenantId:String}
      `,
      query_params: { tenantId },
    });

    await clickHouseClient.exec({
      query: `
        ALTER TABLE "test_langwatch".trace_summaries DELETE WHERE TenantId = {tenantId:String}
      `,
      query_params: { tenantId },
    });

    // Clean up test_event_handler_log table (created in testPipelines.ts)
    await clickHouseClient.exec({
      query: `
        ALTER TABLE "test_langwatch".test_event_handler_log DELETE WHERE TenantId = {tenantId:String}
      `,
      query_params: { tenantId },
    });
  } else {
    // Clean up all test data using TRUNCATE (synchronous and faster)
    await clickHouseClient.exec({
      query: `TRUNCATE TABLE IF EXISTS "test_langwatch".event_log`,
    });

    await clickHouseClient.exec({
      query: `TRUNCATE TABLE IF EXISTS "test_langwatch".processor_checkpoints`,
    });

    await clickHouseClient.exec({
      query: `TRUNCATE TABLE IF EXISTS "test_langwatch".ingested_spans`,
    });

    await clickHouseClient.exec({
      query: `TRUNCATE TABLE IF EXISTS "test_langwatch".trace_summaries`,
    });

    // Clean up test_event_handler_log table (created in testPipelines.ts)
    await clickHouseClient.exec({
      query: `TRUNCATE TABLE IF EXISTS "test_langwatch".test_event_handler_log`,
    });
  }
}
