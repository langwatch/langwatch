import { AppTraceProjectionsAdapter } from "~/runtime/app/trace-projections.adapter";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import { FoldProjectionExecutor } from "@langwatch/eventing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { createAppTraceSummaryStore } from "~/runtime/app/trace-summary-fold.adapter";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "~/server/event-sourcing/__tests__/integration/testHelpers";
import { RecordSpanCommand } from "@langwatch/trace-server";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { TraceSummaryFoldProjection } from "@langwatch/trace-server";
import { RECORD_SPAN_COMMAND_TYPE } from "@langwatch/trace-contract";
import type { SpanReceivedEvent } from "@langwatch/trace-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";

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

function buildRawSpan(traceId: string, spanId: string, startTimeMs: number): OtlpSpan {
  const startNano = BigInt(startTimeMs) * 1_000_000n;
  const endNano = startNano + BigInt(10) * 1_000_000n;
  return {
    traceId,
    spanId,
    parentSpanId: null,
    name: `span-${spanId}`,
    kind: 1,
    startTimeUnixNano: startNano.toString(),
    endTimeUnixNano: endNano.toString(),
    attributes: [],
    events: [],
    links: [],
    status: { code: 1, message: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

const hasTestcontainers = !!(process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL);

describe.skipIf(!hasTestcontainers)("Trace summary fold coalescing -> ClickHouse", () => {
  let tenantId: ReturnType<typeof createTestTenantId>;
  let tenantIdString: string;
  let traceSummaryStore: ReturnType<typeof createAppTraceSummaryStore>;

  beforeEach(() => {
    const clickHouseClient = getTestClickHouseClient();
    if (!clickHouseClient) throw new Error("ClickHouse required.");
    tenantId = createTestTenantId();
    tenantIdString = getTenantIdString(tenantId);
    traceSummaryStore = createAppTraceSummaryStore({
      repository: new TraceSummaryService(
        new TraceSummaryClickHouseRepository(async () => clickHouseClient),
      ).repository,
      redis: null,
      defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    });
    // Touch span-storage wiring too, to keep the import surface honest.
    void new SpanStorageService(new SpanStorageClickHouseRepository(async () => clickHouseClient));
  });

  afterEach(async () => {
    await cleanupTestDataForTenant(tenantIdString);
  });

  describe("given many spans for one trace folded as one coalesced batch", () => {
    /** @scenario 'Coalesced folding produces the correct accumulated state through the pipeline' */
    it("folds every span into the exact accumulated count persisted in ClickHouse", async () => {
      const traceId = generateId("trace");
      const SPAN_COUNT = 40;
      const base = Date.now();

      // Build valid normalized span events via the real command (no queue), so
      // this is deterministic. executeBatch then folds them in ONE
      // load/apply/store cycle — the coalescing path — straight to ClickHouse.
      const command = createTestRecordSpanCommand();
      const events: SpanReceivedEvent[] = [];
      for (let i = 0; i < SPAN_COUNT; i++) {
        const produced = await command.handle({
          type: RECORD_SPAN_COMMAND_TYPE,
          aggregateId: traceId,
          tenantId: tenantIdString,
          data: {
            span: buildRawSpan(traceId, `${generateId("span")}-${i}`, base + i),
            resource: null,
            instrumentationScope: null,
            piiRedactionLevel: "DISABLED",
            occurredAt: base + i,
          },
        } as never);
        events.push(...produced);
      }
      expect(events).toHaveLength(SPAN_COUNT);

      const executor = new FoldProjectionExecutor();
      const fold = TraceSummaryFoldProjection.create({
        runtime: AppTraceProjectionsAdapter.createRuntime(TraceCanonicalisationService.create()),
        traceCanonicalisation: TraceCanonicalisationService.create(),
        store: traceSummaryStore,
      });
      const context = { aggregateId: traceId, tenantId, key: traceId };

      const folded = (await executor.executeBatch(
        fold as never,
        events as never,
        context,
      )) as TraceSummaryData;

      // In-memory result: every span folded, no double-count, no loss.
      expect(folded.spanCount).toBe(SPAN_COUNT);

      // Persisted in ClickHouse: read the single stored summary back. Poll to
      // tolerate ClickHouse insert visibility lag (the row is written once).
      let persisted: TraceSummaryData | null = null;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        persisted = (await traceSummaryStore.get(traceId, context)) as TraceSummaryData | null;
        if (persisted?.spanCount === SPAN_COUNT) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(persisted?.spanCount).toBe(SPAN_COUNT);
    }, 45000);
  });
});
