import {
  createTenantId,
  FoldProjectionExecutor,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import {
  TRACE_NAME_CHANGED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import {
  TraceAnalyticsProjectionPort,
  type TraceAnalyticsProjectionEntry,
} from "../../ports/trace-analytics-projection.port.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { TraceAnalyticsStore } from "../../stores/eventing/eventing.trace-derived.store.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsData,
  type TraceAnalyticsRow,
} from "../trace-derived.projection.ts";
import { createSpanReceivedEvent, createTestRuntime } from "./fixtures/trace-summary-test.fixtures.ts";

/**
 * The version gate on the committed row. The row is trusted only when its
 * projection stamp is one the decoder can read in full; an older stamp is a
 * store miss so the fold rebuilds rather than resuming from a shape whose
 * missing columns are indistinguishable from real values.
 */

const TENANT = "tenant-gate";
const TRACE_ID = "aaaa0000000000000000000000000004";
const BASE_MS = 1_760_000_000_000;

const runtime = createTestRuntime();
const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, tryGet: async () => null },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime,
});

function project(state: TraceAnalyticsData): TraceAnalyticsRow {
  return TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
    state,
    tenantId: TENANT,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

/** A port that answers reads from a single fixed row. */
function storeOver(row: TraceAnalyticsRow): TraceAnalyticsStore {
  const storage = new (class extends TraceAnalyticsProjectionPort {
    async upsert(): Promise<void> {}
    async tryFindByTraceId() {
      return { row, appliedEventIds: ["evt-1", "evt-2"] };
    }
  })();
  return TraceAnalyticsStore.create({ storage, defaultRetentionDays: 90 });
}

const context = {
  aggregateId: TRACE_ID,
  tenantId: createTenantId(TENANT),
} as ProjectionStoreContext;

describe("TraceAnalyticsStore read-back version gate", () => {
  describe("given a trace a person deliberately renamed", () => {
    const rename = {
      id: "evt-rename",
      type: TRACE_NAME_CHANGED_EVENT_TYPE,
      tenantId: TENANT,
      aggregateId: TRACE_ID,
      occurredAt: BASE_MS,
      data: { traceId: TRACE_ID, newName: "Renamed by a human" },
      metadata: {},
    };

    /**
     * The kind of late contribution that names a trace when nothing else has:
     * a parented span, which the fallback path would otherwise claim the name
     * from because this trace has no real root.
     */
    const lateNamingSpan = () =>
      createSpanReceivedEvent({
        eventId: "evt-child",
        tenantId: TENANT,
        traceId: TRACE_ID,
        spanId: "cccc000000000001",
        parentSpanId: "cccc00000000000f",
        name: "llm-call",
        occurredAt: BASE_MS + 1000,
      });

    const renamed = () =>
      projection.apply({ ...projection.init(), traceId: TRACE_ID }, rename as never);

    describe("when a late span that would otherwise supply a name arrives", () => {
      /** @scenario a user-visible name survives a late unrelated contribution */
      it("keeps the person's name across the recovery", () => {
        const recovered = TraceAnalyticsFoldProjection.traceAnalyticsStateFromRow(
          project(renamed()),
        );

        expect(projection.apply(recovered, lateNamingSpan() as never).traceName).toBe(
          "Renamed by a human",
        );
      });
    });

    describe("when its committed row predates the fold recording that a person set the name", () => {
      /** @scenario a user-visible name survives a late unrelated contribution */
      it("refuses the row, so the rename is rebuilt rather than overwritten", async () => {
        const olderShape: TraceAnalyticsRow = {
          ...project(renamed()),
          version: "2026-06-20",
          // Indistinguishable from "nobody ever renamed it".
          traceNameUserOverridden: false,
        };

        // Read back, that row's own decoding lets the late span take the name.
        expect(
          projection.apply(
            TraceAnalyticsFoldProjection.traceAnalyticsStateFromRow(olderShape),
            lateNamingSpan() as never,
          ).traceName,
        ).toBe("llm-call");

        // Which is why the store never hands it to the fold at all.
        expect(await storeOver(olderShape).tryGet(TRACE_ID, context)).toBeNull();
      });
    });
  });
});

/**
 * A trace whose only signal is a classification carries nothing the analytics
 * row can hold, so the store writes no row for it. ADR-066 makes that safe
 * rather than lossy: no row is a MISS, and the fold's `refoldOnStoreMiss`
 * rebuilds the classification from the event log when a real event lands.
 */
describe("TraceAnalyticsStore dimension-only signal", () => {
  const topicEvent = {
    id: "evt-topic",
    type: TOPIC_ASSIGNED_EVENT_TYPE,
    tenantId: TENANT,
    aggregateId: TRACE_ID,
    occurredAt: BASE_MS,
    data: {
      topicId: "topic-1",
      topicName: "Support",
      subtopicId: null,
      subtopicName: null,
      isIncremental: false,
    },
    metadata: {},
  };

  const spanEvent = createSpanReceivedEvent({
    eventId: "evt-span",
    tenantId: TENANT,
    traceId: TRACE_ID,
    spanId: "bbbb000000000001",
    parentSpanId: null,
    name: "agent-run",
    occurredAt: BASE_MS + 1000,
  });

  /** A port that answers reads from whatever the store actually wrote. */
  function recordingPort() {
    const rows: TraceAnalyticsRow[] = [];
    const storage = new (class extends TraceAnalyticsProjectionPort {
      async upsert(entry: TraceAnalyticsProjectionEntry): Promise<void> {
        rows.push(entry.row);
      }
      async tryFindByTraceId() {
        const row = rows[rows.length - 1];
        return row ? { row, appliedEventIds: [] } : null;
      }
    })();
    return { storage, rows };
  }

  describe("given a trace whose only signal so far is an assigned topic", () => {
    describe("when its cached state is lost and a later span arrives", () => {
      // The row carries the classification, so the later span resumes from the
      // read-back directly: no event-log replay, which is what lets the fold
      // declare trustAbsentMiss. Readers derive hasSignal=false and keep the
      // row out of analytics, so writing it costs the product nothing.
      /** @scenario a signal with nothing else to store is not lost to a cold cache */
      it("resumes the classification from the committed row instead of losing it", async () => {
        const { storage, rows } = recordingPort();
        const fold = TraceAnalyticsFoldProjection.create({
          store: TraceAnalyticsStore.create({ storage, defaultRetentionDays: 90 }),
          traceCanonicalisation: TraceCanonicalisationService.create(),
          runtime: createTestRuntime(),
        });
        // A loader that fails the test if the executor still replays history:
        // the whole point of the always-write row is that it never needs to.
        fold.eventLoaderUpTo = async () => {
          throw new Error("event log must not be read: the row carries the state");
        };
        const executor = new FoldProjectionExecutor();

        await executor.execute(fold, topicEvent as never, context);

        // The dimension-only state was committed — flagged out of analytics,
        // but durably there for the next delivery to resume from.
        expect(rows).toHaveLength(1);
        expect(rows[0]!.hasSignal).toBe(false);
        expect(rows[0]!.topicId).toBe("topic-1");

        const resumed = await executor.execute(fold, spanEvent as never, context);

        expect(resumed.topicId).toBe("topic-1");
        expect(resumed.spanCount).toBe(1);
        // The span turned it into a real trace: the rewrite is visible.
        expect(rows[rows.length - 1]!.hasSignal).toBe(true);
      });
    });
  });
});
