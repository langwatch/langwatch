import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { getTestClickHouseClient } from "../../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "../../../__tests__/integration/testHelpers";
import { FoldProjectionExecutor } from "../../../projections/foldProjectionExecutor";
import { RecordSpanCommand } from "../commands/recordSpanCommand";
import { RECORD_SPAN_COMMAND_TYPE } from "../schemas/constants";
import type { SpanReceivedEvent } from "../schemas/events";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import { TraceSummaryFoldProjection } from "../projections/traceSummary.foldProjection";
import type { OtlpSpan } from "../schemas/otlp";
import { TraceSummaryStore } from "../projections/traceSummary.store";

// Subclass that injects no-op span-enrichment deps so the production
// `require("~/server/db")` default-dependency path never runs (that require
// can't be resolved at runtime under vitest). Mirrors the pattern in
// metricsSync.convergence.integration.test.ts. A no-op contentDropService is
// included so the deps are complete and the prisma default path stays skipped;
// this test does not exercise the data-privacy drop.
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
        }),
      },
    } as never);
  }
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

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

describe.skipIf(!hasTestcontainers)(
  "Trace summary fold coalescing -> ClickHouse",
  () => {
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;
    let traceSummaryStore: TraceSummaryStore;

    beforeEach(() => {
      const clickHouseClient = getTestClickHouseClient();
      if (!clickHouseClient) throw new Error("ClickHouse required.");
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      traceSummaryStore = new TraceSummaryStore(
        new TraceSummaryService(
          new TraceSummaryClickHouseRepository(async () => clickHouseClient),
        ).repository,
      );
      // Touch span-storage wiring too, to keep the import surface honest.
      void new SpanStorageService(
        new SpanStorageClickHouseRepository(async () => clickHouseClient),
      );
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
        const command = new TestRecordSpanCommand();
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
        const fold = new TraceSummaryFoldProjection({ store: traceSummaryStore });
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
  },
);
