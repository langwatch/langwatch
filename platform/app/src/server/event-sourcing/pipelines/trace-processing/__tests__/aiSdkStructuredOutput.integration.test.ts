import { TraceCanonicalisationService } from "@langwatch/trace-server";
import { FoldProjectionExecutor } from "@langwatch/eventing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { getTestClickHouseClient } from "../../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "../../../__tests__/integration/testHelpers";
import { RecordSpanCommand } from "../commands/recordSpanCommand";
import { SpanStorageMapProjection } from "../projections/spanStorage.mapProjection";
import { SpanAppendStore } from "../projections/spanStorage.store";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import { TraceSummaryFoldProjection } from "../projections/traceSummary.foldProjection";
import { TraceSummaryStore } from "../projections/traceSummary.store";
import { RECORD_SPAN_COMMAND_TYPE, SPAN_RECEIVED_EVENT_TYPE } from "../schemas/constants";
import type { OtlpSpan } from "../schemas/otlp";

class TestRecordSpanCommand extends RecordSpanCommand {
  static override readonly schema = RecordSpanCommand.schema;

  constructor() {
    super({
      piiRedactionService: { redactSpan: async () => {} },
      costEnrichmentService: { enrichSpan: async () => {} },
      tokenEstimationService: { estimateSpanTokens: async () => {} },
      contentDropService: {
        dropSpanContent: async () => ({
          droppedCount: 0,
          droppedCategories: [],
          droppedAttributeKeys: [],
        }),
      },
    });
  }
}

function buildSpan(traceId: string, spanId: string, startTimeMs: number): OtlpSpan {
  const response = JSON.stringify({ greeting: "Hallo" });
  const startTimeUnixNano = BigInt(startTimeMs) * 1_000_000n;

  return {
    traceId,
    spanId,
    parentSpanId: null,
    name: "ai.generateText",
    kind: 1,
    startTimeUnixNano: startTimeUnixNano.toString(),
    endTimeUnixNano: (startTimeUnixNano + 100_000_000n).toString(),
    attributes: [
      {
        key: "ai.response.object",
        value: { stringValue: response },
      },
      {
        key: "ai.response.text",
        value: { stringValue: "" },
      },
      {
        key: "ai.prompt",
        value: { stringValue: "Translate Hello to Dutch" },
      },
    ],
    events: [],
    links: [],
    status: { code: 1, message: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

describe.skipIf(!hasTestcontainers)(
  "AI SDK structured output through trace processing",
  () => {
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string | undefined;
    let traceSummaryStore: TraceSummaryStore;
    let spanStorageService: SpanStorageService;

    beforeEach(() => {
      const clickHouseClient = getTestClickHouseClient();
      if (!clickHouseClient) throw new Error("ClickHouse client required.");

      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      traceSummaryStore = new TraceSummaryStore(
        new TraceSummaryService(
          new TraceSummaryClickHouseRepository(async () => clickHouseClient),
        ).repository,
      );
      spanStorageService = new SpanStorageService(
        new SpanStorageClickHouseRepository(async () => clickHouseClient),
      );
    });

    afterEach(async () => {
      if (!tenantIdString) return;
      await cleanupTestDataForTenant(tenantIdString);
    });

    it("persists flat structured output when text is empty", async () => {
      const currentTenantIdString = tenantIdString;
      if (!currentTenantIdString) {
        throw new Error("Test tenant was not initialized.");
      }

      const traceId = `trace-ai-sdk-${Date.now()}`;
      const spanId = `span-ai-sdk-${Date.now()}`;
      const occurredAt = Date.now();
      const command = new TestRecordSpanCommand();
      const [event] = await command.handle({
        type: RECORD_SPAN_COMMAND_TYPE,
        aggregateId: traceId,
        tenantId: currentTenantIdString,
        data: {
          span: buildSpan(traceId, spanId, occurredAt),
          resource: null,
          instrumentationScope: {
            name: "embedded-ai",
            version: "6.0.0",
          },
          piiRedactionLevel: "DISABLED",
          occurredAt,
        },
      } as never);

      expect(event?.type).toBe(SPAN_RECEIVED_EVENT_TYPE);

      const context = {
        aggregateId: traceId,
        tenantId,
        key: traceId,
      };
      const fold = new TraceSummaryFoldProjection({
        traceCanonicalisation: TraceCanonicalisationService.create(),
        store: traceSummaryStore,
      });
      const folded = (await new FoldProjectionExecutor().executeBatch(
        fold as never,
        [event] as never,
        context,
      )) as TraceSummaryData;

      expect(folded.computedOutput).toBe('{"greeting":"Hallo"}');

      const mapProjection = new SpanStorageMapProjection({
        traceCanonicalisation: TraceCanonicalisationService.create(),
        store: new SpanAppendStore(spanStorageService.repository),
      });
      const normalizedSpan = mapProjection.mapTraceSpanReceived(event!);
      await new SpanAppendStore(spanStorageService.repository).append(
        normalizedSpan,
        context,
      );

      const storedSpans = await spanStorageService.getSpansByTraceId({
        tenantId: currentTenantIdString,
        traceId,
      });

      expect(storedSpans).toHaveLength(1);
      expect(storedSpans[0]?.type).toBe("llm");
      expect(storedSpans[0]?.output).toEqual({
        type: "chat_messages",
        value: [{ role: "assistant", content: '{"greeting":"Hallo"}' }],
      });

      // Poll to tolerate ClickHouse insert visibility lag, the same way
      // traceProcessing.coalescing.integration.test.ts does. A bare read here
      // passes on an idle machine and fails on a loaded CI runner, which is
      // the whole difficulty: the value is correct, it is just not readable
      // yet at the instant the fold returns.
      let persistedSummary: TraceSummaryData | null = null;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        persistedSummary = (await traceSummaryStore.get(
          traceId,
          context,
        )) as TraceSummaryData | null;
        if (persistedSummary?.computedOutput !== undefined) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(persistedSummary?.computedOutput).toBe('{"greeting":"Hallo"}');
    }, 45_000);
  },
);
