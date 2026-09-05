import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  TraceAnalyticsProjectionPort,
  type TraceAnalyticsProjectionEntry,
} from "../../ports/trace-analytics-projection.port";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service";
import { TraceAnalyticsStore } from "../../stores/eventing/eventing.trace-derived.store";
import { TraceAnalyticsFoldProjection, type TraceAnalyticsData } from "../trace-derived.projection";
import { createTestRuntime } from "./fixtures/trace-summary-test.fixtures";

/**
 * The applied-event-id watermark (ADR-066). The executor dedups a redelivered
 * batch against the ids persisted NEXT TO the row, so a store that drops them
 * re-applies the batch on the next cold-cache retry: a silent double-count with
 * no error anywhere.
 */

const TENANT = "tenant-watermark";
const TRACE_ID = "trace-1";

const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => null },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime: createTestRuntime(),
});

const context = (appliedEventIds?: string[]): ProjectionStoreContext =>
  ({
    aggregateId: TRACE_ID,
    tenantId: createTenantId(TENANT),
    ...(appliedEventIds ? { appliedEventIds } : {}),
  }) as ProjectionStoreContext;

const signalState = (): TraceAnalyticsData => ({
  ...projection.init(),
  traceId: TRACE_ID,
  spanCount: 2,
  occurredAt: 1_700_000_000_000,
  storageAnchorMs: 1_700_000_000_000,
});

/** Records everything written, and reads back whatever was written last. */
function recordingPort() {
  const written: TraceAnalyticsProjectionEntry[] = [];
  const storage = new (class extends TraceAnalyticsProjectionPort {
    async upsert(entry: TraceAnalyticsProjectionEntry): Promise<void> {
      written.push(entry);
    }
    async tryFindByTraceId() {
      const entry = written[written.length - 1];
      return entry ? { row: entry.row, appliedEventIds: entry.appliedEventIds } : null;
    }
  })();
  return { storage, written };
}

describe("TraceAnalyticsStore — redelivery watermark", () => {
  describe("when a state is committed with the ids of the batch that produced it", () => {
    /** @scenario the redelivery watermark survives the write path */
    it("persists the applied-event-id watermark next to the row", async () => {
      const { storage, written } = recordingPort();
      const store = TraceAnalyticsStore.create({ storage, defaultRetentionDays: 90 });

      await store.store(signalState(), context(["evt-1", "evt-2"]));

      expect(written).toHaveLength(1);
      expect(written[0]!.appliedEventIds).toEqual(["evt-1", "evt-2"]);
    });

    /** @scenario the watermark round-trips through the read-back */
    it("reads the same watermark back with the state", async () => {
      const { storage } = recordingPort();
      const store = TraceAnalyticsStore.create({ storage, defaultRetentionDays: 90 });
      await store.store(signalState(), context(["evt-1"]));

      const back = await store.getWithApplied(TRACE_ID, context());

      expect(back.state).not.toBeNull();
      expect(back.appliedEventIds).toEqual(["evt-1"]);
      expect(back.miss).toBeUndefined();
    });
  });
});
