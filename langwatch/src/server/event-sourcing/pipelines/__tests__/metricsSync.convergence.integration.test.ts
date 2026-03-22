/**
 * REAL integration test for per-role cost/latency metrics propagation.
 *
 * Sends actual OTLP spans through the trace processing pipeline with
 * ClickHouse + Redis, then verifies that roleCosts/roleLatencies are
 * accumulated in the trace summary fold state.
 *
 * This test proves the full path:
 * 1. Span with langwatch.scenario.role arrives
 * 2. traceSummary fold accumulates roleCosts via parent-role inheritance
 * 3. Fold state is persisted to ClickHouse trace_summaries table
 * 4. Data can be read back from the store
 *
 * @see specs/features/suites/trace-role-cost-accumulation.feature
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import type { AggregateType } from "../../";
import { definePipeline } from "../../";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
} from "../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "../../__tests__/integration/testHelpers";
import { EventSourcing } from "../../eventSourcing";
import { EventStoreClickHouse } from "../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../stores/repositories/eventRepositoryClickHouse";
import { RecordSpanCommand } from "../trace-processing/commands/recordSpanCommand";
import { AssignTopicCommand } from "../trace-processing/commands/assignTopicCommand";
import { createSpanStorageMapProjection } from "../trace-processing/projections/spanStorage.mapProjection";
import { createTraceSummaryFoldProjection } from "../trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../trace-processing/schemas/events";
import type { OtlpSpan } from "../trace-processing/schemas/otlp";
import { SpanAppendStore } from "../trace-processing/projections/spanStorage.store";
import { TraceSummaryStore } from "../trace-processing/projections/traceSummary.store";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

class TestRecordSpanCommand extends RecordSpanCommand {
  static override readonly schema = RecordSpanCommand.schema;
  constructor() {
    super({
      piiRedactionService: { redactSpan: async () => {} },
      costEnrichmentService: { enrichSpan: async () => {} },
      tokenEstimationService: { estimateSpanTokens: async () => {} },
    });
  }
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function buildOtlpSpan({
  traceId,
  spanId,
  parentSpanId,
  name,
  attributes,
  durationMs = 1000,
}: {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string } }>;
  durationMs?: number;
}): OtlpSpan {
  const startNano = BigInt(Date.now()) * 1_000_000n;
  const endNano = startNano + BigInt(durationMs) * 1_000_000n;

  return {
    traceId,
    spanId,
    parentSpanId,
    name,
    kind: 1,
    startTimeUnixNano: startNano.toString(),
    endTimeUnixNano: endNano.toString(),
    attributes,
    events: [],
    links: [],
    status: { code: 1, message: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

describe.skipIf(!hasTestcontainers)(
  "Role cost/latency accumulation — end-to-end integration",
  () => {
    let eventSourcing: EventSourcing;
    let tracePipeline: ReturnType<typeof createTracePipeline>;
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;
    let traceSummaryStore: TraceSummaryStore;

    function createTracePipeline() {
      const clickHouseClient = getTestClickHouseClient();
      const redisConnection = getTestRedisConnection();

      if (!clickHouseClient || !redisConnection) {
        throw new Error("ClickHouse and Redis required.");
      }

      const eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(clickHouseClient),
      );
      eventSourcing = EventSourcing.createWithStores({
        eventStore,
        clickhouse: async () => clickHouseClient,
        redis: redisConnection,
      });

      const spanAppendStore = new SpanAppendStore(
        new SpanStorageService(
          new SpanStorageClickHouseRepository(async () => clickHouseClient),
        ).repository,
      );
      traceSummaryStore = new TraceSummaryStore(
        new TraceSummaryService(
          new TraceSummaryClickHouseRepository(async () => clickHouseClient),
        ).repository,
      );

      const noopReactor = {
        name: "noop",
        options: {},
        handle: async () => {},
      };

      const pipelineName = `trace_role_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const pipelineDef = definePipeline<TraceProcessingEvent>()
        .withName(pipelineName)
        .withAggregateType("trace" as AggregateType)
        .withFoldProjection(
          "traceSummary",
          createTraceSummaryFoldProjection({ store: traceSummaryStore }) as any,
        )
        .withMapProjection(
          "spanStorage",
          createSpanStorageMapProjection({ store: spanAppendStore }) as any,
        )
        .withReactor("traceSummary", "evaluationTrigger", noopReactor as any)
        .withReactor("traceSummary", "customEvaluationSync", noopReactor as any)
        .withReactor("traceSummary", "traceUpdateBroadcast", noopReactor as any)
        .withReactor("traceSummary", "simulationMetricsSync", noopReactor as any)
        .withReactor("traceSummary", "projectMetadata", noopReactor as any)
        .withReactor("spanStorage", "spanStorageBroadcast", noopReactor as any)
        .withCommand("recordSpan", TestRecordSpanCommand as any)
        .withCommand("assignTopic", AssignTopicCommand as any)
        .build();

      const registered = eventSourcing.register(pipelineDef);
      return {
        ...registered,
        ready: () => registered.service.waitUntilReady(),
      };
    }

    beforeEach(async () => {
      tracePipeline = createTracePipeline();
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      await tracePipeline.ready();
    }, 30_000);

    afterEach(async () => {
      await eventSourcing.close();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await cleanupTestDataForTenant(tenantIdString);
    });

    describe("when agent span with role has child LLM spans", () => {
      it("accumulates child LLM costs into the agent role", async () => {
        const traceId = generateId("trace");
        const rootSpanId = generateId("root");
        const agentSpanId = generateId("agent");
        const llm1SpanId = generateId("llm1");
        const llm2SpanId = generateId("llm2");

        // 1. Root span (Scenario Turn)
        await tracePipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildOtlpSpan({
            traceId,
            spanId: rootSpanId,
            parentSpanId: null,
            name: "Scenario Turn",
            attributes: [
              { key: "langwatch.span.type", value: { stringValue: "span" } },
            ],
            durationMs: 5000,
          }),
          resource: { attributes: [], droppedAttributesCount: 0 },
          instrumentationScope: { name: "langwatch.test" },
          piiRedactionLevel: "DISABLED",
          occurredAt: Date.now(),
        });

        // 2. Agent span with role
        await tracePipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildOtlpSpan({
            traceId,
            spanId: agentSpanId,
            parentSpanId: rootSpanId,
            name: "WeatherAgent.call",
            attributes: [
              { key: "langwatch.span.type", value: { stringValue: "agent" } },
              { key: "langwatch.scenario.role", value: { stringValue: "Agent" } },
              { key: "langwatch.scenario.run_id", value: { stringValue: "scenariorun_test123" } },
            ],
            durationMs: 4000,
          }),
          resource: { attributes: [], droppedAttributesCount: 0 },
          instrumentationScope: { name: "langwatch.test" },
          piiRedactionLevel: "DISABLED",
          occurredAt: Date.now(),
        });

        // 3. Child LLM span 1 (under agent)
        await tracePipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildOtlpSpan({
            traceId,
            spanId: llm1SpanId,
            parentSpanId: agentSpanId,
            name: "llm",
            attributes: [
              { key: "langwatch.span.type", value: { stringValue: "llm" } },
              { key: "gen_ai.request.model", value: { stringValue: "gpt-5-mini" } },
              { key: "gen_ai.usage.input_tokens", value: { intValue: "100" } },
              { key: "gen_ai.usage.output_tokens", value: { intValue: "50" } },
            ],
            durationMs: 2000,
          }),
          resource: { attributes: [], droppedAttributesCount: 0 },
          instrumentationScope: { name: "langwatch.test" },
          piiRedactionLevel: "DISABLED",
          occurredAt: Date.now(),
        });

        // 4. Child LLM span 2 (under agent)
        await tracePipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildOtlpSpan({
            traceId,
            spanId: llm2SpanId,
            parentSpanId: agentSpanId,
            name: "llm",
            attributes: [
              { key: "langwatch.span.type", value: { stringValue: "llm" } },
              { key: "gen_ai.request.model", value: { stringValue: "gpt-5-mini" } },
              { key: "gen_ai.usage.input_tokens", value: { intValue: "80" } },
              { key: "gen_ai.usage.output_tokens", value: { intValue: "40" } },
            ],
            durationMs: 1500,
          }),
          resource: { attributes: [], droppedAttributesCount: 0 },
          instrumentationScope: { name: "langwatch.test" },
          piiRedactionLevel: "DISABLED",
          occurredAt: Date.now(),
        });

        // Poll for the fold state to have all 4 spans processed
        const deadline = Date.now() + 30_000;
        let foldState: TraceSummaryData | null = null;

        while (Date.now() < deadline) {
          try {
            const projection = await tracePipeline.service.getProjectionByName(
              "traceSummary",
              traceId,
              { tenantId },
            );
            if (projection && (projection as any).data?.spanCount >= 4) {
              foldState = (projection as any).data as TraceSummaryData;
              break;
            }
          } catch {
            // Not ready yet
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        // THE ACTUAL ASSERTIONS — these should FAIL right now
        // because roleCosts aren't being persisted/accumulated correctly
        expect(foldState).not.toBeNull();
        expect(foldState!.spanCount).toBe(4);

        // Role costs should have Agent entry with accumulated LLM costs
        expect(foldState!.roleCosts).toBeDefined();
        expect(Object.keys(foldState!.roleCosts ?? {})).toContain("Agent");
        expect(foldState!.roleCosts!["Agent"]).toBeGreaterThan(0);

        // Role latencies should have Agent entry = agent span duration (4000ms)
        expect(foldState!.roleLatencies).toBeDefined();
        expect(foldState!.roleLatencies!["Agent"]).toBe(4000);

        // scenario_run_id should be hoisted to attributes
        expect(foldState!.attributes["langwatch.scenario.run_id"]).toBe("scenariorun_test123");
      }, 60_000);
    });
  },
);
