import { TraceCanonicalisationService } from "@langwatch/trace-server";
import type { ProjectionStoreContext } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import type { TraceAnalyticsRepository } from "~/server/app-layer/traces/repositories/trace-analytics.repository";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_TYPE,
} from "../../schemas/constants";
import { anchorStorageTime } from "../services/storage-anchor";
import {
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
} from "../traceAnalytics.foldProjection";
import { TraceAnalyticsStore } from "../traceAnalytics.store";
import {
  createSpanReceivedEvent,
  msToUnixNano,
} from "./fixtures/trace-summary-test.fixtures";

/**
 * The slim fold's STORAGE ANCHOR (ADR-071 step 3, migration 00061).
 *
 * `OccurredAt` on `trace_analytics` is the partition key, the lead sort key and
 * the TTL anchor. It used to carry the fold's span timing baseline — the running
 * `min(span.startTimeUnixMs)` — which only SPANS ever set. A trace whose only
 * signal is a log record (Claude Code / Codex "Path B") therefore committed at
 * `new Date(0)`: partition 196952, TTL deadline `1970 + retention`, already past.
 *
 * The two jobs are now separate state: `storageAnchorMs`, frozen on the first
 * contribution of any kind that carries a usable business time, and `occurredAt`,
 * still span-seeded and still the baseline `TotalDurationMs` is measured from.
 *
 * These tests drive the fold through its own dispatch (`projection.apply`) rather
 * than through the exported span helper, because the anchor is applied at that
 * seam — the point of putting it there is that no contribution type can miss it.
 */

const TENANT = "tenant-anchor";
const TRACE_ID = "aaaa0000000000000000000000000009";
const BASE_MS = 1_760_000_000_000;

const projection = new TraceAnalyticsFoldProjection({
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

type FoldEvent = { type: string };

function foldAll(
  events: readonly FoldEvent[],
  from: TraceAnalyticsData = projection.init(),
): TraceAnalyticsData {
  return events.reduce((state, event) => projection.apply(state, event), from);
}

/** A Path-B log record: real trace context, no span anywhere on the trace. */
function logRecordEvent({
  eventId,
  occurredAt,
}: {
  eventId: string;
  occurredAt: number;
}): FoldEvent {
  return {
    id: eventId,
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    tenantId: TENANT,
    aggregateId: TRACE_ID,
    occurredAt,
    data: {
      traceId: TRACE_ID,
      spanId: "bbbb000000000001",
      timeUnixMs: occurredAt,
      severityNumber: 9,
      severityText: "INFO",
      body: "api_request",
      attributes: {},
      resourceAttributes: {},
      scopeName: "com.anthropic.claude_code",
      scopeVersion: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: {},
  } as unknown as FoldEvent;
}

function spanEvent({
  eventId,
  spanId,
  startMs,
  endMs,
  attributes,
}: {
  eventId: string;
  spanId: string;
  startMs: number;
  endMs: number;
  attributes?: Record<string, string | number | boolean>;
}): FoldEvent {
  return createSpanReceivedEvent({
    eventId,
    tenantId: TENANT,
    traceId: TRACE_ID,
    spanId,
    parentSpanId: null,
    name: "agent-run",
    // The envelope is stamped at ingest, which for a span is its END — the
    // anchor must take the span's own start instead.
    occurredAt: endMs,
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(endMs),
    attributes,
  }) as FoldEvent;
}

describe("traceAnalytics storage anchor", () => {
  describe("given a trace whose only signal is a log record", () => {
    const logAtMs = BASE_MS + 60_000;
    const state = foldAll([logRecordEvent({ eventId: "evt-log", occurredAt: logAtMs })]);
    const row = project(state);

    /** @scenario "A trace whose only signal is a log record is anchored in real time" */
    it("anchors the row at the log's own business time", () => {
      expect(row.occurredAtMs).toBe(logAtMs);
    });

    /** @scenario "A trace whose only signal is a log record is anchored in real time" */
    it("commits into a live partition rather than 196952", () => {
      // The defect this fix exists for, stated the way ClickHouse sees it: the
      // partition expression is toYearWeek(OccurredAt) and the TTL is
      // OccurredAt + retention, so an epoch anchor is a row born expired.
      expect(new Date(row.occurredAtMs).getUTCFullYear()).toBeGreaterThan(1970);
      // Pinned to the ANCHOR, not merely to "not 1970". `projectAnalyticsStateToRow`
      // falls back to `state.createdAt` (fold time, so also a live partition)
      // when nothing anchored, which would satisfy the year check on its own —
      // this is what makes the test fail if the anchor silently stops working
      // and the fallback quietly covers for it.
      expect(state.storageAnchorMs).toBe(logAtMs);
    });

    it("leaves the span timing baseline unset, inventing no duration", () => {
      // The anchor must NOT double as the baseline: a log's time is when the
      // platform accepted the record, not when any work started.
      expect(state.occurredAt).toBe(0);
      expect(row.earliestSpanStartMs).toBe(0);
      expect(row.totalDurationMs).toBe(0);
    });

    describe("when the state is committed through the store", () => {
      /** @scenario "A trace whose only signal is a log record is anchored in real time" */
      it("writes the row, carrying the anchor the fold froze", async () => {
        const upsert = vi.fn().mockResolvedValue(undefined);
        const store = new TraceAnalyticsStore({
          upsert,
        } as unknown as TraceAnalyticsRepository);

        await store.store(state, {
          aggregateId: TRACE_ID,
          tenantId: createTenantId(TENANT),
        } as unknown as ProjectionStoreContext);

        // Named before it is dereferenced: this is the only test proving the
        // deliberately-unchanged `hasPersistableSignal` still admits a log-only
        // trace, and without it a refusal surfaces as "cannot read properties
        // of undefined" instead of pointing at the gate.
        expect(upsert).toHaveBeenCalledTimes(1);
        const written = upsert.mock.calls[0]?.[0] as TraceAnalyticsRow;
        expect(written.traceId).toBe(TRACE_ID);
        expect(written.occurredAtMs).toBe(logAtMs);
      });
    });
  });

  describe("given a trace whose spans arrive in start order", () => {
    const firstSpanStartMs = BASE_MS + 500;
    const state = foldAll([
      spanEvent({
        eventId: "evt-span-1",
        spanId: "bbbb00000000000f",
        startMs: firstSpanStartMs,
        endMs: BASE_MS + 3000,
      }),
      spanEvent({
        eventId: "evt-span-2",
        spanId: "bbbb000000000010",
        startMs: BASE_MS + 1000,
        endMs: BASE_MS + 2000,
      }),
    ]);
    const row = project(state);

    /** @scenario "A trace with spans is anchored at its first span's start" */
    it("anchors on the first span's start, where the column already sat", () => {
      // The no-partition-shift guarantee: before the split this column held
      // min(span start), which for an in-order trace IS the first span's start.
      expect(row.occurredAtMs).toBe(firstSpanStartMs);
      expect(row.earliestSpanStartMs).toBe(firstSpanStartMs);
    });

    it("anchors on the span's start rather than the envelope's ingest stamp", () => {
      // `span_received` stamps `occurredAt` at the span's END, so an anchor
      // taken off the envelope would move every span trace by its duration.
      expect(row.occurredAtMs).toBeLessThan(state.LastEventOccurredAt);
    });
  });

  describe("given an earlier-starting span that arrives after the trace was anchored", () => {
    const firstFoldedStartMs = BASE_MS + 5_000;
    const lateEarlierStartMs = BASE_MS + 1_000;

    const anchored = foldAll([
      spanEvent({
        eventId: "evt-late-1",
        spanId: "bbbb000000000011",
        startMs: firstFoldedStartMs,
        endMs: BASE_MS + 6_000,
      }),
    ]);
    const afterLateSpan = foldAll(
      [
        spanEvent({
          eventId: "evt-late-2",
          spanId: "bbbb000000000012",
          startMs: lateEarlierStartMs,
          endMs: BASE_MS + 2_000,
        }),
      ],
      anchored,
    );

    /** @scenario "A late earlier-starting span moves the trace's timing, not its anchor" */
    it("pulls the timing baseline back to the earlier span", () => {
      expect(project(afterLateSpan).earliestSpanStartMs).toBe(lateEarlierStartMs);
    });

    /** @scenario "A late earlier-starting span moves the trace's timing, not its anchor" */
    it("leaves the anchor exactly where it froze", () => {
      // ADR-071's four consequences — orphaned versions, cross-partition
      // orphans, a TTL deadline that moves towards the row, and a dedup scope
      // that can miss the true latest — all come from this value moving.
      expect(project(afterLateSpan).occurredAtMs).toBe(project(anchored).occurredAtMs);
      expect(project(afterLateSpan).occurredAtMs).toBe(firstFoldedStartMs);
    });
  });

  describe("given a log record followed by the span whose work it describes", () => {
    const logAtMs = BASE_MS + 60_000;
    // The ordinary shape: the producer emits its log AFTER the work finished,
    // so the span both starts and ends before the log is accepted.
    const spanStartMs = logAtMs - 5_000;
    const spanEndMs = logAtMs - 1_000;

    const log = logRecordEvent({ eventId: "evt-lts-log", occurredAt: logAtMs });
    const span = spanEvent({
      eventId: "evt-lts-span",
      spanId: "bbbb000000000013",
      startMs: spanStartMs,
      endMs: spanEndMs,
      attributes: {
        "langwatch.span.type": "llm",
        "gen_ai.usage.output_tokens": 100,
      },
    });

    /** @scenario "A trace's duration is measured from its spans, never from a log record" */
    it("measures the duration from the span, not from the gap to the log", () => {
      // REGRESSION GUARD, and the reason the anchor is a separate field rather
      // than a seeded `occurredAt`. `SpanTimingService` reads `occurredAt > 0`
      // as "a span has seeded the baseline" and computes
      // `currentEnd = occurredAt + totalDurationMs`. Seed it from a log — whose
      // time is platform ACCEPT time — and the first span measures from the log
      // instead of from itself, inflating TotalDurationMs by the whole ingest
      // lag and taking TokensPerSecond (completion tokens over that duration)
      // with it.
      const state = foldAll([log, span]);

      expect(state.occurredAt).toBe(spanStartMs);
      expect(state.totalDurationMs).toBe(spanEndMs - spanStartMs);
    });

    /** @scenario "A trace's duration is measured from its spans, never from a log record" */
    it("reports the same duration whichever of the two folds first", () => {
      // The inflation was also order-dependent, so one trace could report two
      // different latencies depending on which signal was delivered first.
      const logFirst = foldAll([log, span]);
      const spanFirst = foldAll([span, log]);

      expect(logFirst.totalDurationMs).toBe(spanFirst.totalDurationMs);
      expect(logFirst.occurredAt).toBe(spanFirst.occurredAt);
    });

    it("keeps the anchor of whichever contribution was folded first", () => {
      // First-observed, not min: the anchor is a storage address, and ADR-071's
      // rule is that it is written once. The two orders anchor differently and
      // that is the intended behaviour — what must never happen is a committed
      // row's anchor moving underneath it.
      expect(project(foldAll([log, span])).occurredAtMs).toBe(logAtMs);
      expect(project(foldAll([span, log])).occurredAtMs).toBe(spanStartMs);
    });
  });

  describe("given a trace whose first contribution carries no span at all", () => {
    const topicAtMs = BASE_MS + 90_000;

    it("still anchors, because any contribution with a business time may", () => {
      // Dimension-only signal (a classification, an annotation, a rename) has a
      // business time too. Anchoring on it is what stops a trace class from
      // being permanently un-anchorable — whether such a state is WRITTEN is a
      // separate decision the persistable-signal gate still owns.
      const state = foldAll([
        {
          id: "evt-topic",
          type: TOPIC_ASSIGNED_EVENT_TYPE,
          tenantId: TENANT,
          aggregateId: TRACE_ID,
          occurredAt: topicAtMs,
          data: {
            topicId: "topic-1",
            topicName: "Support",
            subtopicId: null,
            subtopicName: null,
            isIncremental: false,
          },
          metadata: {},
        } as unknown as FoldEvent,
      ]);

      expect(state.storageAnchorMs).toBe(topicAtMs);
    });
  });

  describe("given an event type this fold does not handle", () => {
    it("anchors nothing, because nothing was contributed", () => {
      const state = foldAll([
        {
          id: "evt-unknown",
          type: "lw.obs.trace.not_a_trace_analytics_event",
          tenantId: TENANT,
          aggregateId: TRACE_ID,
          occurredAt: BASE_MS,
          data: {},
        } as unknown as FoldEvent,
      ]);

      expect(state.storageAnchorMs).toBe(0);
    });
  });

  describe("given a business time a producer sent from far in the future", () => {
    // The anchor is producer-controlled and the collector bounds only the PAST
    // edge, so without a future bound one span claiming to start in 2286 fixes
    // that row's partition AND its `OccurredAt + retention` TTL deadline in
    // 2286 — a row that outlives its tenant's retention indefinitely and that
    // `ttlReconciler` cannot reach, because it anchors on the same column.
    // Before the freeze this self-corrected: `min(span start)` pulled the live
    // row back as soon as a sane span arrived. Freezing is what makes it stick.
    const now = BASE_MS;
    const farFuture = BASE_MS + 400 * 24 * 60 * 60 * 1000;

    /** @scenario "A trace that reports a start time years ahead is not filed under it" */
    it("refuses it rather than freezing the row into a partition years away", () => {
      const state = anchorStorageTime({
        state: projection.init(),
        eventOccurredAtMs: farFuture,
        now,
      });

      expect(state.storageAnchorMs).toBe(0);
    });

    it("still accepts a time inside the skew allowance, so a merely wrong clock anchors on itself", () => {
      const skewed = now + 60 * 60 * 1000;

      const state = anchorStorageTime({
        state: projection.init(),
        eventOccurredAtMs: skewed,
        now,
      });

      expect(state.storageAnchorMs).toBe(skewed);
    });

    it("lets the next usable contribution anchor instead", () => {
      // Refusing must not strand the trace un-anchorable — it only declines
      // THIS candidate.
      const refused = anchorStorageTime({
        state: projection.init(),
        eventOccurredAtMs: farFuture,
        now,
      });

      const anchored = anchorStorageTime({
        state: refused,
        eventOccurredAtMs: BASE_MS + 5_000,
        now,
      });

      expect(anchored.storageAnchorMs).toBe(BASE_MS + 5_000);
    });
  });

  describe("given a contribution whose business time is unusable", () => {
    it.each([
      ["zero", 0],
      ["negative", -1],
      ["not a number", Number.NaN],
      ["infinite", Number.POSITIVE_INFINITY],
    ])("leaves the state untouched when the time is %s", (_label, value) => {
      const before = projection.init();

      const after = anchorStorageTime({
        state: before,
        eventOccurredAtMs: value,
        now: BASE_MS,
      });

      // Same REFERENCE, not merely an equal object: an un-anchorable
      // contribution must not churn the state.
      expect(after).toBe(before);
    });

    it("leaves the state untouched when there is no time at all", () => {
      const before = projection.init();

      expect(
        anchorStorageTime({
          state: before,
          eventOccurredAtMs: undefined,
          now: BASE_MS,
        }),
      ).toBe(before);
    });
  });

  describe("given a state nothing could anchor", () => {
    // Every event carried `occurredAt: 0` — the event schema permits it
    // (`nonnegative`, not `positive`). The partition column still must not be
    // the epoch, so the projection falls back through fold time.
    const unanchored = (): TraceAnalyticsData => ({
      ...projection.init(),
      traceId: TRACE_ID,
      storageAnchorMs: 0,
      createdAt: BASE_MS,
    });

    it("falls back to fold time so the row never lands in 196952", () => {
      expect(project(unanchored()).occurredAtMs).toBe(BASE_MS);
    });

    it("falls back again when even fold time is unusable", () => {
      // `parseClickHouseDateTimeMs` returns 0 on a parse failure, so a
      // read-back state can carry `createdAt: 0`. Trusting it unchecked would
      // put the row straight back into the partition this change exists to
      // escape.
      const row = projectAnalyticsStateToRow({
        state: { ...unanchored(), createdAt: 0 },
        tenantId: TENANT,
        version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
        now: BASE_MS,
      });

      expect(row.occurredAtMs).toBe(BASE_MS);
    });
  });
});
