import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { definePipeline } from "../../../library";
import { EventSourcing } from "../../../runtime/eventSourcing";
import { EventSourcingRuntime } from "../../../runtime/eventSourcingRuntime";
import type { PipelineWithCommandHandlers } from "../../../runtime/pipeline/types";
import { BullmqQueueProcessorFactory } from "../../../runtime/queue/factory";
import { EventStoreClickHouse } from "../../../runtime/stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../../runtime/stores/repositories/eventRepositoryClickHouse";
import { RecordSpanCommand } from "../commands/recordSpanCommand";
import { AssignTopicCommand } from "../commands/assignTopicCommand";
import { traceSummaryFoldProjection } from "../projections/traceSummary.foldProjection";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import { spanStorageMapProjection } from "../handlers/spanStorage.mapProjection";
import type { TraceProcessingEvent } from "../schemas/events";
import type { OtlpSpan } from "../schemas/otlp";

// ============================================================================
// Test Helpers
// ============================================================================

function generateTestTraceId(): string {
  return `trace-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function generateTestSpanId(): string {
  return `span-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function generateTestPipelineName(): string {
  return `trace_processing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Builds a minimal valid OTLP span for testing.
 */
function buildTestSpan({
  traceId,
  spanId,
  name = "test-span",
  startTimeMs = Date.now(),
  durationMs = 100,
  parentSpanId,
  attributes = [],
  statusCode = 1,
  statusMessage,
}: {
  traceId: string;
  spanId: string;
  name?: string;
  startTimeMs?: number;
  durationMs?: number;
  parentSpanId?: string;
  attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: number; doubleValue?: number; boolValue?: boolean } }>;
  statusCode?: number;
  statusMessage?: string;
}): OtlpSpan {
  const startNano = BigInt(startTimeMs) * 1_000_000n;
  const endNano = startNano + BigInt(durationMs) * 1_000_000n;

  return {
    traceId,
    spanId,
    parentSpanId: parentSpanId ?? null,
    name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: startNano.toString(),
    endTimeUnixNano: endNano.toString(),
    attributes,
    events: [],
    links: [],
    status: {
      code: statusCode as 0 | 1 | 2,
      message: statusMessage ?? null,
    },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

/**
 * Creates a test pipeline for trace processing using real ClickHouse and Redis.
 */
function createTraceTestPipeline(): PipelineWithCommandHandlers<
  any,
  { recordSpan: any; assignTopic: any }
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
    { eventStore, queueProcessorFactory },
  );

  const eventSourcing = new EventSourcing(runtime);

  const pipelineDefinition = definePipeline<TraceProcessingEvent>()
    .withName(pipelineName)
    .withAggregateType("trace" as AggregateType)
    .withFoldProjection("traceSummary", traceSummaryFoldProjection as any)
    .withMapProjection("spanStorage", spanStorageMapProjection as any)
    .withCommand("recordSpan", RecordSpanCommand as any)
    .withCommand("assignTopic", AssignTopicCommand as any)
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
 * Waits for the trace summary fold projection to reach the expected span count.
 */
async function waitForTraceSummary(
  pipeline: ReturnType<typeof createTraceTestPipeline>,
  traceId: string,
  tenantId: ReturnType<typeof createTestTenantId>,
  expectedSpanCount: number,
  timeoutMs = 15000,
): Promise<void> {
  const startTime = Date.now();
  const pollIntervalMs = 100;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const projection = await pipeline.service.getProjectionByName(
        "traceSummary",
        traceId,
        { tenantId },
      );
      const data = projection?.data as TraceSummaryData | undefined;
      if (data && data.SpanCount >= expectedSpanCount) {
        return;
      }
    } catch {
      // Projection not ready yet
    }

    const elapsed = Date.now() - startTime;
    const currentInterval = elapsed < 500 ? pollIntervalMs : elapsed < 1500 ? pollIntervalMs * 2 : 300;
    await new Promise((resolve) => setTimeout(resolve, currentInterval));
  }

  throw new Error(
    `Timeout waiting for trace summary. Expected SpanCount >= ${expectedSpanCount} for trace ${traceId}`,
  );
}

/**
 * Waits for the trace summary to have a non-null topic assignment.
 */
async function waitForTopicAssignment(
  pipeline: ReturnType<typeof createTraceTestPipeline>,
  traceId: string,
  tenantId: ReturnType<typeof createTestTenantId>,
  expectedTopicId: string,
  timeoutMs = 15000,
): Promise<void> {
  const startTime = Date.now();
  const pollIntervalMs = 100;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const projection = await pipeline.service.getProjectionByName(
        "traceSummary",
        traceId,
        { tenantId },
      );
      const data = projection?.data as TraceSummaryData | undefined;
      if (data && data.TopicId === expectedTopicId) {
        return;
      }
    } catch {
      // Not ready yet
    }

    const elapsed = Date.now() - startTime;
    const currentInterval = elapsed < 500 ? pollIntervalMs : elapsed < 1500 ? pollIntervalMs * 2 : 300;
    await new Promise((resolve) => setTimeout(resolve, currentInterval));
  }

  throw new Error(
    `Timeout waiting for topic assignment. Expected TopicId "${expectedTopicId}" for trace ${traceId}`,
  );
}

/**
 * Waits for stored spans to appear in the stored_spans table.
 */
async function waitForStoredSpans(
  traceId: string,
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
          FROM stored_spans
          WHERE TraceId = {traceId:String}
            AND TenantId = {tenantId:String}
        `,
        query_params: { traceId, tenantId },
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
    `Timeout waiting for stored spans. Expected ${expectedCount} for trace ${traceId}`,
  );
}

const CLICKHOUSE_CONSISTENCY_DELAY_MS = 200;

async function waitForClickHouseConsistency(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, CLICKHOUSE_CONSISTENCY_DELAY_MS));
}

// ============================================================================
// Integration Tests
// ============================================================================

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

describe.skipIf(!hasTestcontainers)(
  "Trace Processing Pipeline",
  () => {
    let pipeline: ReturnType<typeof createTraceTestPipeline>;
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;

    beforeEach(async () => {
      pipeline = createTraceTestPipeline();
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      await pipeline.ready();
    });

    afterEach(async () => {
      await pipeline.service.close();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await cleanupTestDataForTenant(tenantIdString);
    });

    describe("given a single span is recorded", () => {
      it("creates a trace summary with span metrics", async () => {
        const traceId = generateTestTraceId();
        const spanId = generateTestSpanId();
        const now = Date.now();

        await pipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildTestSpan({
            traceId,
            spanId,
            name: "root-operation",
            startTimeMs: now,
            durationMs: 250,
            statusCode: 1,
          }),
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        });

        await waitForTraceSummary(pipeline, traceId, tenantId, 1);

        const projection = await pipeline.service.getProjectionByName(
          "traceSummary",
          traceId,
          { tenantId },
        );
        const data = projection?.data as TraceSummaryData;

        expect(data.TraceId).toBe(traceId);
        expect(data.SpanCount).toBe(1);
        expect(data.TotalDurationMs).toBeGreaterThan(0);
        expect(data.ContainsOKStatus).toBe(true);
        expect(data.ContainsErrorStatus).toBe(false);
      });

      it("writes the span to stored_spans via map projection", async () => {
        const traceId = generateTestTraceId();
        const spanId = generateTestSpanId();

        await pipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildTestSpan({ traceId, spanId, name: "stored-span" }),
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        });

        const count = await waitForStoredSpans(traceId, tenantIdString, 1);
        expect(count).toBeGreaterThanOrEqual(1);
      });
    });

    describe("given multiple spans arrive for the same trace", () => {
      it("accumulates span count and duration in the trace summary", async () => {
        const traceId = generateTestTraceId();
        const now = Date.now();

        // Root span
        await pipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildTestSpan({
            traceId,
            spanId: generateTestSpanId(),
            name: "root",
            startTimeMs: now,
            durationMs: 500,
          }),
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        });
        await waitForClickHouseConsistency();

        // Child span
        await pipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildTestSpan({
            traceId,
            spanId: generateTestSpanId(),
            name: "child-llm-call",
            startTimeMs: now + 10,
            durationMs: 200,
            parentSpanId: "parent",
          }),
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        });

        await waitForTraceSummary(pipeline, traceId, tenantId, 2);

        const projection = await pipeline.service.getProjectionByName(
          "traceSummary",
          traceId,
          { tenantId },
        );
        const data = projection?.data as TraceSummaryData;

        expect(data.SpanCount).toBe(2);
        expect(data.TotalDurationMs).toBeGreaterThanOrEqual(500);
      });
    });

    describe("given a span with an error status", () => {
      it("records the error in the trace summary", async () => {
        const traceId = generateTestTraceId();

        await pipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildTestSpan({
            traceId,
            spanId: generateTestSpanId(),
            name: "failing-operation",
            statusCode: 2,
            statusMessage: "Connection refused",
          }),
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        });

        await waitForTraceSummary(pipeline, traceId, tenantId, 1);

        const projection = await pipeline.service.getProjectionByName(
          "traceSummary",
          traceId,
          { tenantId },
        );
        const data = projection?.data as TraceSummaryData;

        expect(data.ContainsErrorStatus).toBe(true);
        expect(data.ErrorMessage).toBe("Connection refused");
      });
    });

    describe("given a span with token usage attributes", () => {
      it("aggregates token counts in the trace summary", async () => {
        const traceId = generateTestTraceId();

        await pipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildTestSpan({
            traceId,
            spanId: generateTestSpanId(),
            name: "llm-call",
            attributes: [
              { key: "gen_ai.usage.input_tokens", value: { intValue: 150 } },
              { key: "gen_ai.usage.output_tokens", value: { intValue: 80 } },
              { key: "gen_ai.response.model", value: { stringValue: "gpt-4o" } },
            ],
          }),
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        });

        await waitForTraceSummary(pipeline, traceId, tenantId, 1);

        const projection = await pipeline.service.getProjectionByName(
          "traceSummary",
          traceId,
          { tenantId },
        );
        const data = projection?.data as TraceSummaryData;

        expect(data.TotalPromptTokenCount).toBe(150);
        expect(data.TotalCompletionTokenCount).toBe(80);
        expect(data.Models).toContain("gpt-4o");
      });
    });

    describe("given a topic is assigned after spans are recorded", () => {
      it("updates the trace summary with topic and subtopic", async () => {
        const traceId = generateTestTraceId();
        const topicId = `topic-${Date.now()}`;
        const subtopicId = `subtopic-${Date.now()}`;

        // First record a span so the trace summary exists
        await pipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildTestSpan({
            traceId,
            spanId: generateTestSpanId(),
            name: "main-operation",
          }),
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        });
        await waitForTraceSummary(pipeline, traceId, tenantId, 1);

        // Then assign a topic
        await pipeline.commands.assignTopic.send({
          tenantId: tenantIdString,
          traceId,
          topicId,
          topicName: "Customer Support",
          subtopicId,
          subtopicName: "Billing Questions",
          isIncremental: false,
        });

        await waitForTopicAssignment(pipeline, traceId, tenantId, topicId);

        const projection = await pipeline.service.getProjectionByName(
          "traceSummary",
          traceId,
          { tenantId },
        );
        const data = projection?.data as TraceSummaryData;

        expect(data.TopicId).toBe(topicId);
        expect(data.SubTopicId).toBe(subtopicId);
        expect(data.SpanCount).toBe(1);
      });
    });

    describe("given a span with resource attributes", () => {
      it("extracts SDK and service info into trace summary attributes", async () => {
        const traceId = generateTestTraceId();

        await pipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildTestSpan({
            traceId,
            spanId: generateTestSpanId(),
            name: "instrumented-span",
          }),
          resource: {
            attributes: [
              { key: "telemetry.sdk.name", value: { stringValue: "opentelemetry" } },
              { key: "telemetry.sdk.language", value: { stringValue: "python" } },
              { key: "service.name", value: { stringValue: "my-agent" } },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        });

        await waitForTraceSummary(pipeline, traceId, tenantId, 1);

        const projection = await pipeline.service.getProjectionByName(
          "traceSummary",
          traceId,
          { tenantId },
        );
        const data = projection?.data as TraceSummaryData;

        expect(data.Attributes["sdk.name"]).toBe("opentelemetry");
        expect(data.Attributes["sdk.language"]).toBe("python");
        expect(data.Attributes["service.name"]).toBe("my-agent");
      });
    });
  },
  60000,
);
