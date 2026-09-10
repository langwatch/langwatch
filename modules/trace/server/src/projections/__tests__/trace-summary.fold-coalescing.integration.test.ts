import {
  createTenantId,
  FoldProjectionExecutor,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  TraceSummaryProjectionPort,
  type TraceSummaryProjectionEntry,
} from "../../repositories/projection/trace-summary-projection.repository.ts";
import { TraceCanonicalisationService } from "../../services/canonicalisers/trace-canonicalisation.service.ts";
import { TraceSummaryStore } from "../../stores/eventing/eventing.trace-summary.store.ts";
import type { TraceSummaryData } from "../trace-summary.projection.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import {
  createSpanReceivedEvent,
  createTestRuntime,
  msToUnixNano,
} from "./fixtures/trace-summary-test.fixtures.ts";

/**
 * A backed-up group is folded as ONE batch: the executor loads the state once,
 * applies every event in order, and stores once. The accumulated count that
 * reaches the store has to match the per-event fold exactly — a batch that
 * double-counts or loses a span is invisible until someone reads the row.
 */

const TENANT = "tenant-coalesce";
const TRACE_ID = "aaaa0000000000000000000000000005";
const SPAN_COUNT = 40;
const BASE_MS = 1_760_000_000_000;

/** The persistence boundary, answering reads from whatever was written. */
class MemoryProjectionPort extends TraceSummaryProjectionPort {
  readonly written: TraceSummaryProjectionEntry[] = [];

  async upsert(entry: TraceSummaryProjectionEntry): Promise<void> {
    this.written.push(entry);
  }

  async findByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<TraceSummaryData | null> {
    const last = [...this.written]
      .reverse()
      .find((entry) => entry.tenantId === input.tenantId && entry.data.traceId === input.traceId);
    return last?.data ?? null;
  }
}

describe("trace summary fold coalescing", () => {
  let storage: MemoryProjectionPort;
  let store: TraceSummaryStore;

  beforeEach(() => {
    storage = new MemoryProjectionPort();
    store = TraceSummaryStore.create({ storage, defaultRetentionDays: 90 });
  });

  describe("given many spans for one trace folded as one coalesced batch", () => {
    /** @scenario Coalesced folding produces the correct accumulated state through the pipeline */
    it("folds every span into the exact accumulated count the store reads back", async () => {
      const events = Array.from({ length: SPAN_COUNT }, (_, index) =>
        createSpanReceivedEvent({
          eventId: `evt-coalesce-${index}`,
          tenantId: TENANT,
          traceId: TRACE_ID,
          spanId: `cccc0000000000${index.toString(16).padStart(2, "0")}`,
          parentSpanId: index === 0 ? null : "cccc000000000000",
          name: `span-${index}`,
          occurredAt: BASE_MS + index,
          startTimeUnixNano: msToUnixNano(BASE_MS + index),
          endTimeUnixNano: msToUnixNano(BASE_MS + index + 10),
        }),
      );

      const executor = new FoldProjectionExecutor();
      const fold = TraceSummaryFoldProjection.create({
        store,
        traceCanonicalisation: TraceCanonicalisationService.create(),
        runtime: createTestRuntime(),
      });
      const context = {
        aggregateId: TRACE_ID,
        tenantId: createTenantId(TENANT),
        key: TRACE_ID,
      } as ProjectionStoreContext;

      const folded = (await executor.executeBatch(
        fold as never,
        events as never,
        context,
      )) as TraceSummaryData;

      // In-memory result: every span folded, no double-count, no loss.
      expect(folded.spanCount).toBe(SPAN_COUNT);

      // ...and the same count is what the store commits and reads back. One
      // write for the whole batch is the coalescing claim; the count is the
      // correctness claim.
      expect(storage.written).toHaveLength(1);
      const persisted = await store.tryGet(TRACE_ID, context);
      expect(persisted?.spanCount).toBe(SPAN_COUNT);
    });
  });
});
