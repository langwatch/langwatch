import { AppTraceProjectionsAdapter } from "~/runtime/app/trace-projections.adapter";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import type { ProjectionStoreContext } from "@langwatch/eventing";
import { createTenantId, FoldProjectionExecutor } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import type { TraceAnalyticsRepository } from "@langwatch/trace-server";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import {
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
  traceAnalyticsStateFromRow,
} from "@langwatch/trace-server";
import { TraceAnalyticsStore } from "@langwatch/trace-server";
import { createSpanReceivedEvent } from "./fixtures/trace-summary-test.fixtures";
import { AppTraceProjectionStorageAdapter } from "~/runtime/app/trace-projection-storage.adapter";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";

/**
 * Read-back round-trip for the slim trace fold (ADR-066). `fromRow` is the
 * inverse of the projection: it must reproduce the fold's WORKING state — not
 * just the queryable columns — from the last committed row, so the delivery
 * path never refolds from `event_log`. It is a deserialize, not a rebuild.
 */

const TENANT = "tenant-rb";
const BASE_MS = 1_760_000_000_000;

const projection = TraceAnalyticsFoldProjection.create({
  runtime: AppTraceProjectionsAdapter.createRuntime(TraceCanonicalisationService.create()),
  traceCanonicalisation: TraceCanonicalisationService.create(),
  store: { store: async () => {}, get: async () => null },
});

function project(state: TraceAnalyticsData): TraceAnalyticsRow {
  return projectAnalyticsStateToRow({
    state,
    tenantId: TENANT,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

function committedState(): TraceAnalyticsData {
  return {
    ...projection.init(),
    traceId: "trace-rb",
    spanCount: 7,
    topicId: "topic-1",
    subTopicId: "sub-1",
    traceName: "My Trace",
    models: ["gpt-5-mini", "claude-fable-5"],
    // Deliberately LATER than `occurredAt`: the anchor froze on the first span
    // this trace folded, and an earlier-starting span then arrived and pulled
    // the timing baseline back. Keeping the two apart in the fixture is what
    // makes a decoder that reads one out of the other's column fail here.
    storageAnchorMs: BASE_MS + 250,
    occurredAt: BASE_MS,
    totalDurationMs: 4200,
    totalCost: 0.42,
    nonBilledCost: 0.1,
    totalPromptTokenCount: 120,
    totalCompletionTokenCount: 60,
    timeToFirstTokenMs: 350,
    tokensPerSecond: 42,
    containsErrorStatus: true,
    annotationIds: ["ann-a", "ann-b"],
    attributes: {
      "langwatch.user_id": "user-9",
      "gen_ai.conversation.id": "conv-9",
      "langwatch.customer_id": "cust-9",
      "langwatch.origin": "playground",
      "langwatch.labels": JSON.stringify(["alpha", "beta"]),
      "langwatch.reserved.cache_read_tokens": "500",
      "langwatch.reserved.log_record_count": "3",
      "metadata.team": "platform",
      // Payload — dropped by the trim, never read by the fold.
      "gen_ai.prompt": "the whole conversation history that must not persist",
    },
    rootSpanStartTimeMs: BASE_MS - 5,
    traceNameUserOverridden: true,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    createdAt: BASE_MS - 100,
    updatedAt: BASE_MS + 100,
    LastEventOccurredAt: BASE_MS + 50,
  };
}

describe("traceAnalytics read-back (fromRow)", () => {
  describe("given a committed slim row", () => {
    const state = committedState();
    const row = project(state);
    const decoded = traceAnalyticsStateFromRow(row);

    it("keeps the storage anchor and the span timing baseline apart", () => {
      // The anchor rides in OccurredAt (partition + sort key + TTL) and the
      // baseline in its own column (migration 00061). Decoding either from the
      // other's column is the defect this split exists to stop: it would either
      // move a committed row's partition or restart the trace's duration.
      expect(decoded.storageAnchorMs).toBe(BASE_MS + 250);
      expect(decoded.occurredAt).toBe(BASE_MS);
      expect(row.occurredAtMs).toBe(BASE_MS + 250);
      expect(row.earliestSpanStartMs).toBe(BASE_MS);
    });

    it("recovers the fold bookkeeping the trimmed row would otherwise drop", () => {
      expect(decoded.spanCount).toBe(7);
      expect(decoded.annotationIds).toEqual(["ann-a", "ann-b"]);
      expect(decoded.rootSpanStartTimeMs).toBe(BASE_MS - 5);
      expect(decoded.traceNameUserOverridden).toBe(true);
      expect(decoded.traceNameFromFallback).toBe(false);
      expect(decoded.rootMetadataFromFallback).toBe(false);
      expect(decoded.LastEventOccurredAt).toBe(BASE_MS + 50);
    });

    it("recovers the hoisted dimensions and reserved accumulators", () => {
      expect(decoded.traceName).toBe("My Trace");
      expect(decoded.models).toEqual(["gpt-5-mini", "claude-fable-5"]);
      expect(decoded.totalCost).toBe(0.42);
      expect(decoded.timeToFirstTokenMs).toBe(350);
      // Dimensions are re-injected from their typed columns.
      expect(decoded.attributes["langwatch.origin"]).toBe("playground");
      expect(decoded.attributes["langwatch.user_id"]).toBe("user-9");
      expect(decoded.attributes["langwatch.labels"]).toBe(JSON.stringify(["alpha", "beta"]));
      // Reserved accumulators survive the trim by contract.
      expect(decoded.attributes["langwatch.reserved.cache_read_tokens"]).toBe("500");
    });

    it("does not carry payload keys the trim drops back into state", () => {
      expect(decoded.attributes["gen_ai.prompt"]).toBeUndefined();
    });

    it("re-projects to the identical row — read-back is a fixed point", () => {
      // The strongest guarantee: folding nothing new onto the recovered state
      // and writing it back reproduces the row byte-for-byte, so a cache miss
      // followed by a store cannot diverge the persisted analytics.
      expect(project(decoded)).toEqual(row);
    });
  });

  describe("given a pre-migration row whose read-back columns are absent", () => {
    it("stays total, mapping the absent columns to their state defaults", () => {
      const row = project(committedState());
      // A row written before migration 00056 supplies the column defaults.
      const legacyRow: TraceAnalyticsRow = {
        ...row,
        spanCount: 0,
        annotationIds: [],
        rootSpanStartTimeMs: 0,
        traceNameFromFallback: false,
        rootMetadataFromFallback: false,
        traceNameUserOverridden: false,
        lastEventOccurredAt: 0,
        // And, on a row written before migration 00061, no span timing baseline.
        earliestSpanStartMs: 0,
      };

      const decoded = traceAnalyticsStateFromRow(legacyRow);

      // The real analytics columns still round-trip.
      expect(decoded.traceName).toBe("My Trace");
      expect(decoded.totalCost).toBe(0.42);
      // The absent read-back columns map to their state defaults — the decoder
      // never throws. 0 root time reads back as "no root claimed yet". Whether
      // such a row may be decoded AT ALL is the store's call, not this
      // function's — see the version-gate tests below.
      expect(decoded.rootSpanStartTimeMs).toBeUndefined();
      expect(decoded.annotationIds).toEqual([]);
      expect(decoded.spanCount).toBe(0);
      expect(decoded.LastEventOccurredAt).toBe(0);
      // 0 reads back as "no span has seeded the timing baseline". On a row this
      // old that default is indistinguishable from the truth, and nothing else
      // on the row carries the baseline — which is why the VERSION gate refuses
      // the stamp outright. Note this is a property of the STAMP, not of the
      // zero: the pre-split stamp decodes a baseline of 0 quite happily, because
      // there OccurredAt still carries the real value (see the pre-split
      // describe below).
      expect(decoded.occurredAt).toBe(0);
    });
  });
});

describe("TraceAnalyticsStore read-back version gate", () => {
  const context = {
    aggregateId: "trace-rb",
    tenantId: createTenantId(TENANT),
  } as unknown as ProjectionStoreContext;

  function storeOver(row: TraceAnalyticsRow) {
    const tryFindByTraceIdWithApplied = vi
      .fn()
      .mockResolvedValue({ row, appliedEventIds: ["evt-1", "evt-2"] });
    const repository = {
      tryFindByTraceIdWithApplied,
    } as unknown as TraceAnalyticsRepository;
    const store = TraceAnalyticsStore.create({
      storage: AppTraceProjectionStorageAdapter.createAnalytics(repository),
      defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    });
    return { store, tryFindByTraceIdWithApplied };
  }

  describe("given a row stamped with the current projection version", () => {
    /** @scenario a stored state written under the fold's current shape is read straight back */
    it("reads the state and the durable watermark back", async () => {
      const { store } = storeOver(project(committedState()));

      const { state, appliedEventIds } = await store.getWithApplied("trace-rb", context);

      expect(state?.spanCount).toBe(7);
      expect(state?.traceNameUserOverridden).toBe(true);
      expect(appliedEventIds).toEqual(["evt-1", "evt-2"]);
    });
  });

  describe("given a row stamped with the version just before the anchor split", () => {
    // The one older stamp that is decoded rather than refused. On a pre-split
    // row `OccurredAt` is `min(span start)` — at once a valid anchor (it is
    // what the row is already partitioned and TTL'd on) and the correct span
    // timing baseline (it is what the new column was split out to carry).
    //
    // The alternative — refusing it — would rebuild the entire population, and
    // a rebuild re-derives the anchor, so the change whose premise is "an
    // anchor is written once" would open by moving every one of them.
    const preSplitRow = (over: Partial<TraceAnalyticsRow> = {}) =>
      ({
        ...project(committedState()),
        version: TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
        // The column this shape does not have. Its ClickHouse DEFAULT is 0, so
        // that is what a real pre-split row decodes as.
        earliestSpanStartMs: 0,
        occurredAtMs: BASE_MS + 250,
        ...over,
      }) satisfies TraceAnalyticsRow;

    it("decodes it instead of reporting a miss", async () => {
      const { store } = storeOver(preSplitRow());

      const { state, appliedEventIds, miss } = await store.getWithApplied("trace-rb", context);

      expect(miss).toBeUndefined();
      expect(state).not.toBeNull();
      // The watermark survives too — the row was trusted, so redelivery dedup
      // keeps working across the transition.
      expect(appliedEventIds).toEqual(["evt-1", "evt-2"]);
    });

    /** @scenario "A trace recorded before the upgrade keeps its place in the timeline" */
    it("takes the timing baseline from the anchor's column, because there they are the same value", () => {
      const state = traceAnalyticsStateFromRow(preSplitRow());

      // Both read off OccurredAt: pre-split, that column WAS min(span start).
      expect(state.storageAnchorMs).toBe(BASE_MS + 250);
      expect(state.occurredAt).toBe(BASE_MS + 250);
    });

    /** @scenario "A trace recorded before the upgrade keeps its place in the timeline" */
    it("keeps the anchor exactly where the row was already stored", () => {
      // The point of decoding rather than refolding: re-projecting the decoded
      // state must reproduce the same partition column, so the row is rewritten
      // onto its own sort key rather than a second one.
      const rewritten = project(traceAnalyticsStateFromRow(preSplitRow()));

      expect(rewritten.occurredAtMs).toBe(BASE_MS + 250);
    });

    it("leaves a log-only pre-split row free to anchor on its next signal", () => {
      // The 196952 row this whole change exists to rescue. It carries 0, which
      // is right twice over — no span was ever folded, and an unusable anchor
      // is what lets the next contribution freeze a real one.
      const state = traceAnalyticsStateFromRow(preSplitRow({ occurredAtMs: 0 }));

      expect(state.storageAnchorMs).toBe(0);
      expect(state.occurredAt).toBe(0);

      const anchored = projection.apply(state, {
        id: "evt-late-log",
        type: "lw.obs.trace.log_record_received",
        tenantId: TENANT,
        aggregateId: "trace-rb",
        occurredAt: BASE_MS + 9_000,
        data: {
          traceId: "trace-rb",
          spanId: "ffffffffffffff01",
          timeUnixMs: BASE_MS + 9_000,
          severityNumber: 9,
          severityText: "INFO",
          body: "api_request",
          attributes: {},
          resourceAttributes: {},
          scopeName: "com.anthropic.claude_code",
          scopeVersion: null,
          piiRedactionLevel: "DISABLED",
        },
      } as unknown as TraceProcessingEvent);

      expect(anchored.storageAnchorMs).toBe(BASE_MS + 9_000);
      // …and the timing baseline stays untouched: no span has been folded.
      expect(anchored.occurredAt).toBe(0);
    });
  });

  describe("given a row stamped with an older projection version", () => {
    // Such a row predates the read-back columns, so every one of them decodes
    // as a ClickHouse default indistinguishable from a real value — spanCount 0
    // would re-add committed cost past the span cap, a false
    // traceNameUserOverridden would let a late span overwrite a user's rename,
    // and a zero span timing baseline (migration 00061) would restart the
    // trace's duration from whichever span arrived next.
    const staleRow = (): TraceAnalyticsRow => ({
      ...project(committedState()),
      version: "2026-06-20",
      spanCount: 0,
      annotationIds: [],
      rootSpanStartTimeMs: 0,
      traceNameUserOverridden: false,
      lastEventOccurredAt: 0,
      earliestSpanStartMs: 0,
    });

    /** @scenario a stored state written under an older shape is rebuilt rather than trusted */
    it("reports a store miss so the fold refolds instead of trusting it", async () => {
      const { store } = storeOver(staleRow());

      const { state, appliedEventIds, miss } = await store.getWithApplied("trace-rb", context);

      expect(state).toBeNull();
      // The watermark goes with the state: keeping it would suppress the very
      // events the re-fold needs to see.
      expect(appliedEventIds).toEqual([]);
      // Asserted on the REAL store, not a mock. The executor skips its
      // unwindowed re-read on `undecodable`, and until this was pinned here the
      // only test naming the value fabricated it from a `vi.fn()` — so deleting
      // the discriminator from this store left the suite green while the
      // executor silently went back to an unpruned scan per event.
      expect(miss).toBe("undecodable");
    });

    it("tells an absent row apart from a refused one", async () => {
      // The two miss kinds mean opposite things to an operator: `absent` says
      // "widen readWindow.widthMs", `undecodable` says "a stale shape is being
      // rebuilt". Reporting a version rejection as `absent` spent the
      // window-fallback signal on a schema condition.
      const repository = {
        tryFindByTraceIdWithApplied: vi.fn().mockResolvedValue(null),
      } as unknown as TraceAnalyticsRepository;
      const store = TraceAnalyticsStore.create({
        storage: AppTraceProjectionStorageAdapter.createAnalytics(repository),
        defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      });

      const { state, miss } = await store.getWithApplied("trace-rb", context);

      expect(state).toBeNull();
      expect(miss).toBe("absent");
    });

    it("misses through get() too, so both read paths agree", async () => {
      const { store } = storeOver(staleRow());

      expect(await store.get("trace-rb", context)).toBeNull();
    });
  });

  describe("given a trace a person deliberately renamed", () => {
    const renameEvent = {
      id: "evt-rename",
      type: "lw.obs.trace.trace_name_changed",
      tenantId: TENANT,
      aggregateId: "trace-rb",
      aggregateType: "trace",
      occurredAt: BASE_MS,
      createdAt: BASE_MS,
      metadata: {},
      data: { traceId: "trace-rb", newName: "Renamed by a human" },
    } as unknown as TraceProcessingEvent;

    /**
     * The kind of late contribution that names a trace when nothing else has:
     * a parented span, which the fallback path would otherwise claim the name
     * from because this trace has no real root.
     */
    const lateNamingSpan = () =>
      createSpanReceivedEvent({
        eventId: "evt-child",
        tenantId: TENANT,
        traceId: "trace-rb",
        spanId: "cccc000000000001",
        parentSpanId: "cccc00000000000f",
        name: "llm-call",
        occurredAt: BASE_MS + 1000,
      });

    const renamed = () =>
      projection.apply({ ...projection.init(), traceId: "trace-rb" }, renameEvent);

    describe("when a late span that would otherwise supply a name arrives", () => {
      /** @scenario a user-visible name survives a late unrelated contribution */
      it("keeps the person's name across the recovery", () => {
        const recovered = traceAnalyticsStateFromRow(project(renamed()));

        expect(projection.apply(recovered, lateNamingSpan()).traceName).toBe("Renamed by a human");
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
          projection.apply(traceAnalyticsStateFromRow(olderShape), lateNamingSpan()).traceName,
        ).toBe("llm-call");

        // Which is why the store never hands it to the fold at all.
        const { store } = storeOver(olderShape);
        expect(await store.get("trace-rb", context)).toBeNull();
      });
    });
  });
});

/**
 * A trace whose only signal is a classification carries nothing the analytics
 * row can hold, so the store writes no row for it. ADR-066 makes that safe
 * rather than lossy: no row is a MISS, and the fold's `refoldOnStoreMiss`
 * rebuilds the classification from `event_log` when a real event finally lands.
 */
describe("TraceAnalyticsStore dimension-only signal", () => {
  const TRACE_ID = "aaaa0000000000000000000000000001";
  const context: ProjectionStoreContext = {
    aggregateId: TRACE_ID,
    tenantId: createTenantId(TENANT),
  };

  const topicEvent = {
    id: "evt-topic",
    type: "lw.obs.trace.topic_assigned",
    tenantId: TENANT,
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    occurredAt: BASE_MS,
    createdAt: BASE_MS,
    metadata: {},
    data: {
      topicId: "topic-1",
      topicName: "Support",
      subtopicId: null,
      subtopicName: null,
      isIncremental: false,
    },
  } as unknown as TraceProcessingEvent;

  const spanEvent: TraceProcessingEvent = createSpanReceivedEvent({
    eventId: "evt-span",
    tenantId: TENANT,
    traceId: TRACE_ID,
    spanId: "bbbb000000000001",
    parentSpanId: null,
    name: "agent-run",
    occurredAt: BASE_MS + 1000,
  });

  /** A repository that answers reads from whatever the store actually wrote. */
  function recordingRepo() {
    const rows: TraceAnalyticsRow[] = [];
    // Cast through `unknown` like the other partial stubs here: this answers
    // only the two members the store exercises, so annotating it as a complete
    // `TraceAnalyticsRepository` would claim members it does not implement.
    const repo = {
      upsert: async (row: TraceAnalyticsRow) => {
        rows.push(row);
      },
      tryFindByTraceIdWithApplied: async () => {
        const row = rows[rows.length - 1];
        return row ? { row, appliedEventIds: [] } : null;
      },
    } as unknown as TraceAnalyticsRepository;
    return { repo, rows };
  }

  describe("given a trace whose only signal so far is an assigned topic", () => {
    describe("when its cached state is lost and a later span arrives", () => {
      /**
       * The row carries the classification, so the later span resumes from the
       * read-back directly: no `event_log` replay, which is what lets the fold
       * declare `trustAbsentMiss`. Readers derive hasSignal=false and keep the
       * row out of analytics, so writing it costs the product nothing.
       */
      /** @scenario a signal with nothing else to store is not lost to a cold cache */
      it("resumes the classification from the committed row instead of losing it", async () => {
        const { repo, rows } = recordingRepo();
        const fold = TraceAnalyticsFoldProjection.create({
          runtime: AppTraceProjectionsAdapter.createRuntime(TraceCanonicalisationService.create()),
          traceCanonicalisation: TraceCanonicalisationService.create(),
          store: TraceAnalyticsStore.create({
            storage: AppTraceProjectionStorageAdapter.createAnalytics(repo),
            defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
          }),
        });
        // A loader that fails the test if the executor still replays history:
        // the whole point of the always-write row is that it never needs to.
        fold.eventLoaderUpTo = async () => {
          throw new Error("event_log must not be read: the row carries the state");
        };
        const executor = new FoldProjectionExecutor();

        await executor.execute(fold, topicEvent, context);

        // The dimension-only state was committed — flagged out of analytics,
        // but durably there for the next delivery to resume from.
        expect(rows).toHaveLength(1);
        expect(rows[0]!.hasSignal).toBe(false);
        expect(rows[0]!.topicId).toBe("topic-1");

        const resumed = await executor.execute(fold, spanEvent, context);

        expect(resumed.topicId).toBe("topic-1");
        expect(resumed.spanCount).toBe(1);
        // The span turned it into a real trace: the rewrite is visible.
        expect(rows[rows.length - 1]!.hasSignal).toBe(true);
      });
    });
  });
});
