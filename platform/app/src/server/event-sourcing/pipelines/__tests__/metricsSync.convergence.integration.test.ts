import { TraceCanonicalisationService } from "@langwatch/trace-server";
/**
 * REAL integration test for per-role cost/latency metrics derivation.
 *
 * Sends actual OTLP spans through the trace processing pipeline with
 * ClickHouse, then verifies that scenario role cost/latency are correctly
 * DERIVED from the stored spans (they are no longer accumulated on the fold,
 * which kept the hot path O(1)).
 *
 * This test proves the full path:
 * 1. Spans with scenario.role + child LLM spans arrive and are stored
 * 2. The fold persists O(1) scalars to trace_summaries (no per-span maps)
 * 3. Reading the stored spans back and deriving role metrics yields the
 *    expected per-role cost (nearest-ancestor) and latency
 *
 * @see specs/features/suites/trace-role-cost-accumulation.feature
 */

import { defineAggregate, defineEvents, definePipeline, EventSourcing } from "@langwatch/eventing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryClickHouseRepository } from "@langwatch/trace-server";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
} from "@langwatch/eventing/server";
import { getTestClickHouseClient } from "../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "../../__tests__/integration/testHelpers";
import { AssignTopicCommand } from "@langwatch/trace-server";
import { RecordSpanCommand } from "@langwatch/trace-server";
import { SpanCostService } from "@langwatch/trace-server";
import { SpanStorageMapProjection } from "@langwatch/trace-server";
import { SpanStorageStore } from "@langwatch/trace-server";
import { TraceSummaryFoldProjection } from "@langwatch/trace-server";
import { TraceSummaryStore } from "@langwatch/trace-server";
import { TRACE_PROCESSING_EVENT_TYPES } from "@langwatch/trace-contract";
import type { TraceProcessingEvent } from "@langwatch/trace-server";
import type { OtlpSpan } from "@langwatch/trace-contract";

const hasTestcontainers = !!(process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL);

function createTestRecordSpanCommand(): RecordSpanCommand {
  return RecordSpanCommand.create({
    piiRedaction: { redact: async () => {} },
    costEnrichment: { enrich: async () => {} },
    tokenEstimation: { estimate: async () => {} },
    contentDrop: {
      drop: async () => ({ droppedCount: 0, droppedCategories: [] }),
    },
  });
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
  attributes: Array<{
    key: string;
    value: { stringValue?: string; intValue?: string };
  }>;
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

      if (!clickHouseClient) {
        throw new Error("ClickHouse required.");
      }

      const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });
      const eventStore = EventingClickHouseEventStore.create({
        repository: EventingClickHouseEventRepository.create({
          resolveClient: async () => clickHouseClient,
          retention,
        }),
        retention,
      });
      // Use in-memory queue (no Redis) so commands are processed synchronously
      eventSourcing = EventSourcing.createWithStores({
        eventStore,
      });

      const spanAppendStore = new SpanAppendStore(
        new SpanStorageService(new SpanStorageClickHouseRepository(async () => clickHouseClient))
          .repository,
      );
      traceSummaryStore = new TraceSummaryStore(
        new TraceSummaryService(
          TraceSummaryClickHouseRepository.create({
            resolveClient: async () => clickHouseClient,
            defaultRetentionDays: 30,
          }),
        ).repository,
      );

      const noopFoldSubscriber = () => ({
        fold: "traceSummary",
        handler: async () => {},
      });
      const noopMapSubscriber = () => ({
        map: "spanStorage",
        handler: async () => {},
      });

      const pipelineName = `trace_role_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const pipelineDef = definePipeline<TraceProcessingEvent>({
        name: pipelineName,
        aggregate: defineAggregate({
          type: "trace",
          events: defineEvents(TRACE_PROCESSING_EVENT_TYPES),
        }),
      })
        .withClickHouseFoldProjection(
          new TraceSummaryFoldProjection({
            store: traceSummaryStore,
            traceCanonicalisation: TraceCanonicalisationService.create(),
          }) as any,
        )
        .withClickHouseMapProjection(
          SpanStorageMapProjection.create({
            store: spanAppendStore,
            traceCanonicalisation: TraceCanonicalisationService.create(),
          }) as any,
        )
        .withProjectionSubscriber("evaluationTrigger", noopFoldSubscriber() as any)
        .withProjectionSubscriber("customEvaluationSync", noopFoldSubscriber() as any)
        .withProjectionSubscriber("traceUpdateBroadcast", noopFoldSubscriber() as any)
        .withProjectionSubscriber("simulationMetricsSync", noopFoldSubscriber() as any)
        .withProjectionSubscriber("projectMetadata", noopFoldSubscriber() as any)
        .withProjectionSubscriber("spanStorageBroadcast", noopMapSubscriber() as any)
        .withCommandInstance("recordSpan", RecordSpanCommand, createTestRecordSpanCommand())
        .withCommand("assignTopic", AssignTopicCommand as any)
        .build();

      const registered = eventSourcing.register(pipelineDef);
      return {
        ...registered,
        ready: () => registered.service.waitUntilReady(),
      };
    }

    beforeEach(async () => {
      console.log("[TEST] Creating pipeline...");
      tracePipeline = createTracePipeline();
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      console.log("[TEST] Waiting for pipeline ready...");
      await tracePipeline.ready();
      console.log("[TEST] Pipeline ready. tenantId:", tenantIdString);
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
        console.log("[TEST] Sending root span...");
        await tracePipeline.commands.recordSpan.send({
          tenantId: tenantIdString,
          span: buildOtlpSpan({
            traceId,
            spanId: rootSpanId,
            parentSpanId: null,
            name: "Scenario Turn",
            attributes: [
              { key: "langwatch.span.type", value: { stringValue: "span" } },
              {
                key: "scenario.run_id",
                value: { stringValue: "scenariorun_test123" },
              },
              { key: "langwatch.origin", value: { stringValue: "simulation" } },
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
              { key: "scenario.role", value: { stringValue: "Agent" } },
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
              {
                key: "gen_ai.request.model",
                value: { stringValue: "gpt-5-mini" },
              },
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
              {
                key: "gen_ai.request.model",
                value: { stringValue: "gpt-5-mini" },
              },
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

        console.log("[TEST] All 4 spans sent. Checking event_log...");

        // Check if events were written to event_log
        const clickHouseClientDebug = getTestClickHouseClient()!;
        const eventResult = await clickHouseClientDebug.query({
          query: `SELECT count() as cnt FROM event_log WHERE TenantId = {tenantId:String} AND AggregateId = {traceId:String}`,
          query_params: { tenantId: tenantIdString, traceId },
          format: "JSONEachRow",
          clickhouse_settings: { select_sequential_consistency: "1" },
        });
        const eventRows = await eventResult.json();
        console.log("[TEST] Events in event_log for this trace:", (eventRows[0] as any)?.cnt);

        console.log("[TEST] Polling trace_summaries...");
        const clickHouseClient = getTestClickHouseClient()!;
        const deadline = Date.now() + 30_000;
        let row: any = null;

        while (Date.now() < deadline) {
          const result = await clickHouseClient.query({
            query: `
              SELECT SpanCount, TotalCost, Attributes
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
              ORDER BY UpdatedAt DESC
              LIMIT 1
            `,
            query_params: { tenantId: tenantIdString, traceId },
            format: "JSONEachRow",
            clickhouse_settings: { select_sequential_consistency: "1" },
          });
          const rows = await result.json();
          if (rows.length > 0) {
            console.log(
              "[TEST] Found row, SpanCount:",
              (rows[0] as any).SpanCount,
              "Attrs:",
              JSON.stringify((rows[0] as any).Attributes),
            );
            if ((rows[0] as any).SpanCount >= 4) {
              row = rows[0];
              break;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        expect(row).not.toBeNull();
        expect(row.SpanCount).toBe(4);

        // scenario.run_id hoisted from root span to the fold attributes (O(1)).
        expect(row.Attributes["scenario.run_id"]).toBe("scenariorun_test123");

        // Role cost/latency are derived from the stored spans, not the fold.
        // Read them back and verify the derivation produces the expected
        // per-role aggregates (both child LLM costs attributed to Agent; Agent
        // latency = its own span duration).
        const spanRepo = new SpanStorageClickHouseRepository(async () => clickHouseClient);
        const spans = await spanRepo.getNormalizedSpansByTraceId({
          tenantId: tenantIdString,
          traceId,
        });
        const { scenarioRoleCosts, scenarioRoleLatencies } = deriveScenarioRoleMetricsFromSpans({
          spans,
          spanCostService: new SpanCostService(),
        });

        expect(scenarioRoleCosts.Agent).toBeGreaterThan(0);
        expect(scenarioRoleLatencies.Agent).toBe(4000);
      }, 60_000);
    });
  },
);
