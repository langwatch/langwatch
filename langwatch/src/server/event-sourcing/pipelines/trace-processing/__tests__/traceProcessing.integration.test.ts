import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
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
import { AssignTopicCommand } from "../commands/assignTopicCommand";
import { RecordSpanCommand } from "../commands/recordSpanCommand";
import { createSpanStorageMapProjection } from "../projections/spanStorage.mapProjection";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import { createTraceSummaryFoldProjection } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";
import type { OtlpSpan } from "../schemas/otlp";
import { SpanAppendStore } from "../projections/spanStorage.store";
import { TraceSummaryStore } from "../projections/traceSummary.store";

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

  const eventSourcing = EventSourcing.createWithStores({
    eventStore,
    queueProcessorFactory,
    clickhouse: clickHouseClient,
    redis: redisConnection,
  });

  const spanAppendStore = new SpanAppendStore(SpanStorageService.create(clickHouseClient).repository);
  const traceSummaryStore = new TraceSummaryStore(TraceSummaryService.create(clickHouseClient).repository);

  const pipelineDefinition = definePipeline<TraceProcessingEvent>()
    .withName(pipelineName)
    .withAggregateType("trace" as AggregateType)
    .withFoldProjection("traceSummary", createTraceSummaryFoldProjection({ store: traceSummaryStore }) as any)
    .withMapProjection("spanStorage", createSpanStorageMapProjection({ store: spanAppendStore }) as any)
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
      if (data && data.spanCount >= expectedSpanCount) {
        return;
      }
    } catch {
      // Projection not ready yet
    }

    const elapsed = Date.now() - startTime;
    const currentInterval = elapsed < 500 ? pollIntervalMs : elapsed < 1500 ? pollIntervalMs * 2 : 300;
    await new Promise((resolve) => setTimeout(resolve, currentInterval));
  }

  // Final attempt
  try {
    const projection = await pipeline.service.getProjectionByName(
      "traceSummary",
      traceId,
      { tenantId },
    );
    const data = projection?.data as TraceSummaryData | undefined;
    if (data && data.spanCount >= expectedSpanCount) {
      return;
    }
  } catch { /* ignore */ }

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
      if (data && data.topicId === expectedTopicId) {
        return;
      }
    } catch {
      // Not ready yet
    }

    const elapsed = Date.now() - startTime;
    const currentInterval = elapsed < 500 ? pollIntervalMs : elapsed < 1500 ? pollIntervalMs * 2 : 300;
    await new Promise((resolve) => setTimeout(resolve, currentInterval));
  }

  // Final attempt
  try {
    const projection = await pipeline.service.getProjectionByName(
      "traceSummary",
      traceId,
      { tenantId },
    );
    const data = projection?.data as TraceSummaryData | undefined;
    if (data && data.topicId === expectedTopicId) {
      return;
    }
  } catch { /* ignore */ }

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

  // Final attempt
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
  } catch { /* ignore */ }

  throw new Error(
    `Timeout waiting for stored spans. Expected ${expectedCount} for trace ${traceId}`,
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

        expect(data.traceId).toBe(traceId);
        expect(data.spanCount).toBe(1);
        expect(data.totalDurationMs).toBeGreaterThan(0);
        expect(data.containsOKStatus).toBe(true);
        expect(data.containsErrorStatus).toBe(false);
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

        expect(data.spanCount).toBe(2);
        expect(data.totalDurationMs).toBeGreaterThanOrEqual(500);
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

        expect(data.containsErrorStatus).toBe(true);
        expect(data.errorMessage).toBe("Connection refused");
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

        expect(data.totalPromptTokenCount).toBe(150);
        expect(data.totalCompletionTokenCount).toBe(80);
        expect(data.models).toContain("gpt-4o");
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

        expect(data.topicId).toBe(topicId);
        expect(data.subTopicId).toBe(subtopicId);
        expect(data.spanCount).toBe(1);
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

        expect(data.attributes["sdk.name"]).toBe("opentelemetry");
        expect(data.attributes["sdk.language"]).toBe("python");
        expect(data.attributes["service.name"]).toBe("my-agent");
      });
    });
  },
  60000,
);
