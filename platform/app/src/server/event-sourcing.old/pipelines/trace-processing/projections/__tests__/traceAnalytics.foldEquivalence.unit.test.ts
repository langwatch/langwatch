import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
  traceAnalyticsStateFromRow,
} from "../traceAnalytics.foldProjection";
import {
  createSpanReceivedEvent,
  msToUnixNano,
} from "./fixtures/trace-summary-test.fixtures";

/**
 * FOLD-EQUIVALENCE for the slim trace fold's read-back (ADR-099).
 *
 * `traceAnalytics.readBack.unit.test.ts` proves a fixed point —
 * `project(fromRow(project(s))) === project(s)` — which only says the row is
 * stable under re-writing. The property the read-back actually relies on is
 * stronger and different:
 *
 *     fold(events, fromRow(project(s))) === fold(events, s)
 *
 * Resuming from a row-reconstructed state must land in the same place as never
 * having lost the state at all. A field that is silently dropped on read-back is
 * invisible to the fixed point (both sides re-project the same dropped default)
 * but shows up here the moment a later event READS it — which is exactly how a
 * reset span count re-adds committed cost, and how a lost `traceNameUserOverridden`
 * lets a late span overwrite a rename.
 *
 * The state is never written as a literal: it is folded out of a realistic event
 * sequence through the projection's own dispatch, so the attribute keys the
 * handlers genuinely touch (the hoisted dimensions, the reserved accumulators,
 * the origin latch) are the ones under test.
 */

const TENANT = "tenant-fold-equiv";
const TRACE_ID = "aaaa0000000000000000000000000001";
const BASE_MS = 1_760_000_000_000;

const projection = new TraceAnalyticsFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

function project(state: TraceAnalyticsData): TraceAnalyticsRow {
  return projectAnalyticsStateToRow({
    state,
    tenantId: TENANT,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

/** The persistence boundary, round-tripped: state → row → state. */
function roundTrip(state: TraceAnalyticsData): TraceAnalyticsData {
  return traceAnalyticsStateFromRow(project(state));
}

type FoldEvent = { type: string };

function foldAll(
  events: readonly FoldEvent[],
  from: TraceAnalyticsData,
): TraceAnalyticsData {
  return events.reduce((state, event) => projection.apply(state, event), from);
}

/**
 * A non-span trace event. The fold dispatches on `type` and its handler reads
 * `data`; the rest of the envelope is what the executor stamps on the way in.
 */
function traceEvent(event: {
  id: string;
  type: string;
  occurredAt: number;
  data: Record<string, unknown>;
}): FoldEvent {
  return {
    tenantId: TENANT,
    aggregateId: TRACE_ID,
    metadata: {},
    ...event,
  } as FoldEvent;
}

function spanEvent({
  eventId,
  spanId,
  parentSpanId,
  name,
  startMs,
  endMs,
  attributes,
}: {
  eventId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startMs: number;
  endMs: number;
  attributes?: Record<string, string | number | boolean>;
}): FoldEvent {
  return createSpanReceivedEvent({
    eventId,
    tenantId: TENANT,
    traceId: TRACE_ID,
    spanId,
    parentSpanId,
    name,
    occurredAt: endMs,
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(endMs),
    attributes,
  });
}

/**
 * One trace's life, in the order the pipeline really produces it: a child span
 * lands before its root, a human renames the trace, an earlier span arrives late,
 * annotations come and go, a log record contributes cost, a metric exemplar
 * carries the TTFT, and the deferred origin resolver fires last.
 *
 * Several of these events READ state the row must carry back:
 *   - the late earlier-starting child (`s2`) is only stopped from overwriting the
 *     human's name by `traceNameUserOverridden`;
 *   - `origin_resolved` only stands down because `langwatch.origin` is still on
 *     the attribute map;
 *   - the reserved cache/reasoning sums and the log-record count are read-modify-
 *     write accumulators, so losing them silently under-counts;
 *   - every span past the first adds to a running cost the span count caps.
 */
function renamedBeforeRootTrace(): readonly FoldEvent[] {
  return [
    // 1. A child span arrives first — names the trace by the fallback path.
    spanEvent({
      eventId: "evt-span-1",
      spanId: "bbbb000000000001",
      parentSpanId: "bbbb00000000000f",
      name: "llm-call",
      startMs: BASE_MS + 1000,
      endMs: BASE_MS + 2000,
      attributes: {
        "langwatch.span.type": "llm",
        "gen_ai.response.model": "gpt-5-mini",
        "gen_ai.usage.input_tokens": 120,
        "gen_ai.usage.output_tokens": 60,
        "gen_ai.usage.cached_tokens": 500,
        "gen_ai.usage.reasoning_tokens": 40,
        "langwatch.span.cost": 0.01,
        "langwatch.user.id": "user-9",
        "gen_ai.conversation.id": "conv-9",
        "metadata.team": "platform",
        // A user dumping a blob into metadata — kept as a dimension, but the
        // trim caps the value, so this key is lossy across the boundary.
        "metadata.debug_payload": "z".repeat(5000),
        // Payload — never hoisted onto the trace map at all, so the read-back
        // has nothing to lose.
        "gen_ai.prompt": "the whole conversation history that must not persist",
      },
    }),
    // 2. Topic classification lands.
    traceEvent({
      id: "evt-topic",
      type: "lw.obs.trace.topic_assigned",
      occurredAt: BASE_MS + 2100,
      data: {
        topicId: "topic-1",
        topicName: "Support",
        subtopicId: "sub-1",
        subtopicName: "Billing",
        isIncremental: false,
      },
    }),
    // 3. A human renames the trace.
    traceEvent({
      id: "evt-rename",
      type: "lw.obs.trace.trace_name_changed",
      occurredAt: BASE_MS + 2200,
      data: {
        traceId: TRACE_ID,
        previousName: "llm-call",
        newName: "Renamed by a human",
        changedByUserId: "user-9",
      },
    }),
    // 4. A late, EARLIER-starting child span — the fallback namer would claim
    //    the trace name here if the rename latch had not survived the round-trip.
    spanEvent({
      eventId: "evt-span-2",
      spanId: "bbbb000000000002",
      parentSpanId: "bbbb00000000000f",
      name: "retriever",
      startMs: BASE_MS + 800,
      endMs: BASE_MS + 1500,
      attributes: {
        "langwatch.span.type": "rag",
        "langwatch.labels": JSON.stringify(["alpha", "beta"]),
      },
    }),
    // 5. An annotation.
    traceEvent({
      id: "evt-ann-a",
      type: "lw.obs.trace.annotation_added",
      occurredAt: BASE_MS + 2300,
      data: { traceId: TRACE_ID, annotationId: "ann-a" },
    }),
    // 6. A log record contributes its own model / cost / tokens.
    traceEvent({
      id: "evt-log",
      type: "lw.obs.trace.log_contributed",
      occurredAt: BASE_MS + 2400,
      data: {
        traceId: TRACE_ID,
        spanId: "bbbb000000000003",
        nonBillable: false,
        liftedAttributes: {
          "langwatch.model": "claude-fable-5",
          "langwatch.cost.usd": 0.02,
          "langwatch.input_tokens": 30,
          "langwatch.output_tokens": 15,
        },
      },
    }),
    // 7. A metric exemplar carries the real time-to-first-token.
    traceEvent({
      id: "evt-metric",
      type: "lw.obs.trace.metric_data_point_correlated",
      occurredAt: BASE_MS + 2500,
      data: {
        traceId: TRACE_ID,
        spanId: "bbbb000000000001",
        metricName: "gen_ai.server.time_to_first_token",
        exemplarValue: 0.35,
      },
    }),
    // 8. The real root finally arrives, carrying the explicit origin.
    spanEvent({
      eventId: "evt-span-root",
      spanId: "bbbb00000000000f",
      parentSpanId: null,
      name: "agent-run",
      startMs: BASE_MS + 500,
      endMs: BASE_MS + 3000,
      attributes: {
        "langwatch.span.type": "agent",
        "langwatch.origin": "playground",
        "langwatch.customer.id": "cust-9",
      },
    }),
    // 9-10. The annotation set churns.
    traceEvent({
      id: "evt-ann-b",
      type: "lw.obs.trace.annotation_added",
      occurredAt: BASE_MS + 3100,
      data: { traceId: TRACE_ID, annotationId: "ann-b" },
    }),
    traceEvent({
      id: "evt-ann-rm",
      type: "lw.obs.trace.annotation_removed",
      occurredAt: BASE_MS + 3200,
      data: { traceId: TRACE_ID, annotationId: "ann-a" },
    }),
    // 11. The deferred origin resolver fires — it must stand down, because the
    //     root span already set an explicit origin on the attribute map.
    traceEvent({
      id: "evt-origin",
      type: "lw.obs.trace.origin_resolved",
      occurredAt: BASE_MS + 3300,
      data: { origin: "api", reason: "deferred-default" },
    }),
    // 12. A last span adds cost and more cache tokens on top of the running sums.
    spanEvent({
      eventId: "evt-span-3",
      spanId: "bbbb000000000004",
      parentSpanId: "bbbb00000000000f",
      name: "llm-call-2",
      startMs: BASE_MS + 2600,
      endMs: BASE_MS + 2900,
      attributes: {
        "langwatch.span.type": "llm",
        "gen_ai.response.model": "gpt-5-mini",
        "gen_ai.usage.input_tokens": 40,
        "gen_ai.usage.output_tokens": 20,
        "gen_ai.usage.cached_tokens": 250,
        "langwatch.span.cost": 0.03,
      },
    }),
  ];
}

/**
 * The other half of the name-resolution machinery: nobody renames this trace, so
 * it stays fallback-named until its real root turns up. The root's takeover is
 * gated on BOTH `traceNameFromFallback` (may the name change?) and
 * `rootMetadataFromFallback` (may the root claim move?) — and the root here
 * starts LATER than the child that claimed the fallback, which is the ordinary
 * consequence of clock skew between two services and the reason that second gate
 * exists at all. A read-back that reset either flag would freeze this trace under
 * the child's name.
 */
function fallbackNamedTrace(): readonly FoldEvent[] {
  return [
    spanEvent({
      eventId: "evt-fb-1",
      spanId: "cccc000000000001",
      parentSpanId: "cccc00000000000f",
      name: "llm-call",
      startMs: BASE_MS + 1000,
      endMs: BASE_MS + 2000,
      attributes: {
        "langwatch.span.type": "llm",
        "gen_ai.response.model": "gpt-5-mini",
        "gen_ai.usage.input_tokens": 90,
        "gen_ai.usage.output_tokens": 45,
        "langwatch.span.cost": 0.02,
      },
    }),
    spanEvent({
      eventId: "evt-fb-2",
      spanId: "cccc000000000002",
      parentSpanId: "cccc00000000000f",
      name: "retriever",
      startMs: BASE_MS + 800,
      endMs: BASE_MS + 1400,
      attributes: { "langwatch.span.type": "rag" },
    }),
    traceEvent({
      id: "evt-fb-ann",
      type: "lw.obs.trace.annotation_added",
      occurredAt: BASE_MS + 2100,
      data: { traceId: TRACE_ID, annotationId: "ann-c" },
    }),
    spanEvent({
      eventId: "evt-fb-root",
      spanId: "cccc00000000000f",
      parentSpanId: null,
      name: "agent-run",
      startMs: BASE_MS + 900,
      endMs: BASE_MS + 3000,
      attributes: {
        "langwatch.span.type": "agent",
        "langwatch.origin": "api",
      },
    }),
    traceEvent({
      id: "evt-fb-topic",
      type: "lw.obs.trace.topic_assigned",
      occurredAt: BASE_MS + 3100,
      data: {
        topicId: "topic-2",
        topicName: "Onboarding",
        subtopicId: null,
        subtopicName: null,
        isIncremental: true,
      },
    }),
    spanEvent({
      eventId: "evt-fb-3",
      spanId: "cccc000000000003",
      parentSpanId: "cccc00000000000f",
      name: "llm-call-2",
      startMs: BASE_MS + 2200,
      endMs: BASE_MS + 2800,
      attributes: {
        "langwatch.span.type": "llm",
        "gen_ai.response.model": "gpt-5-mini",
        "langwatch.span.cost": 0.01,
      },
    }),
  ];
}

/**
 * The Path-B shape: a Claude Code / Codex trace whose first signals are LOG
 * RECORDS, with a span turning up only later (or, for most such traces, never).
 *
 * This is the sequence the storage anchor exists for (ADR-099). It puts
 * two fields under the equivalence property that the span-led sequences cannot:
 * the anchor `OccurredAt` carries — which for this trace is a log's time, and
 * must come back frozen rather than re-derived from whatever folds next — and
 * the span timing baseline in `EarliestSpanStartMs`, which is 0 across the whole
 * log-only prefix and must NOT be confused with the anchor on the way back.
 */
function logLedTrace(): readonly FoldEvent[] {
  const logRecord = (index: number, occurredAt: number): FoldEvent =>
    traceEvent({
      id: `evt-ll-log-${index}`,
      type: "lw.obs.trace.log_record_received",
      occurredAt,
      data: {
        traceId: TRACE_ID,
        spanId: `ffff00000000000${index}`,
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
    });

  return [
    logRecord(1, BASE_MS + 1000),
    logRecord(2, BASE_MS + 1500),
    traceEvent({
      id: "evt-ll-topic",
      type: "lw.obs.trace.topic_assigned",
      occurredAt: BASE_MS + 1800,
      data: {
        topicId: "topic-3",
        topicName: "Coding",
        subtopicId: null,
        subtopicName: null,
        isIncremental: false,
      },
    }),
    logRecord(3, BASE_MS + 2000),
    // A span finally arrives, and starts BEFORE every log — so the timing
    // baseline lands earlier than the anchor, which stays put.
    spanEvent({
      eventId: "evt-ll-span",
      spanId: "ffff0000000000ff",
      parentSpanId: null,
      name: "agent-run",
      startMs: BASE_MS + 200,
      endMs: BASE_MS + 2500,
      attributes: {
        "langwatch.span.type": "agent",
        "gen_ai.usage.output_tokens": 40,
      },
    }),
    logRecord(4, BASE_MS + 3000),
  ];
}

const LIFECYCLE = renamedBeforeRootTrace();
const FALLBACK_LIFECYCLE = fallbackNamedTrace();
const LOG_LED_LIFECYCLE = logLedTrace();

/**
 * The two orderings differ in which name-resolution latch is load-bearing — the
 * rename latch only matters while no real root exists, the fallback flags only
 * matter when a real root lands on a still-fallback name — so the property needs
 * both to cover the set.
 */
const SEQUENCES = [
  {
    name: "a trace a human renamed before its root span arrived",
    events: LIFECYCLE,
  },
  {
    name: "a trace left fallback-named until its root span arrived",
    events: FALLBACK_LIFECYCLE,
  },
  {
    name: "a trace whose first signals are log records, with a span arriving late",
    events: LOG_LED_LIFECYCLE,
  },
];

/** Every interior boundary — the property has to hold wherever the crash lands. */
function splitPointsOf(events: readonly FoldEvent[]): number[] {
  return events.map((_, index) => index + 1).slice(0, -1);
}

describe("traceAnalytics fold-equivalence across the read-back boundary", () => {
  // The base class stamps `updatedAt` as `max(Date.now(), previous + 1)`. Frozen
  // time makes that purely a function of the previous value, so the two folds
  // can be compared on EVERY column instead of excusing a wall-clock one.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  describe.each(SEQUENCES)("given $name", ({ events }) => {
    describe.each(
      splitPointsOf(events),
    )("when the fold is interrupted after event %i and resumed from the committed row", (splitAt) => {
      const before = events.slice(0, splitAt);
      const after = events.slice(splitAt);

      /** @scenario a fold whose stored row is a slimmed analytics summary still recovers its working state */
      it("reaches the same row as the fold that never lost its state", () => {
        const committed = foldAll(before, projection.init());

        const uninterrupted = foldAll(after, committed);
        const resumed = foldAll(after, roundTrip(committed));

        expect(project(resumed)).toEqual(project(uninterrupted));
      });
    });
  });

  /**
   * The storage anchor and the span timing baseline, called out by name.
   *
   * The property above already compares every column, so this adds no coverage
   * — it adds a NAME. These two fields are one column apart and mean opposite
   * things (a frozen storage address vs. a value that moves as earlier spans
   * land), so a decoder that swaps them fails a test that says which is which,
   * instead of one that says "some column differs".
   */
  describe("given the log-led trace interrupted before its span arrives", () => {
    const splitAt = LOG_LED_LIFECYCLE.length - 2;
    const committed = foldAll(
      LOG_LED_LIFECYCLE.slice(0, splitAt),
      projection.init(),
    );
    const rest = LOG_LED_LIFECYCLE.slice(splitAt);

    /** @scenario "A log-led trace resumed from its committed row keeps its anchor and its timing" */
    it("resumes with the anchor its first log froze", () => {
      const uninterrupted = foldAll(rest, committed);
      const resumed = foldAll(rest, roundTrip(committed));

      expect(resumed.storageAnchorMs).toBe(uninterrupted.storageAnchorMs);
      expect(project(resumed).occurredAtMs).toBe(
        project(committed).occurredAtMs,
      );
    });

    /** @scenario "A log-led trace resumed from its committed row keeps its anchor and its timing" */
    it("resumes with the same timing baseline the late span sets", () => {
      const uninterrupted = foldAll(rest, committed);
      const resumed = foldAll(rest, roundTrip(committed));

      // The span in the tail starts BEFORE every log, so this is also the case
      // where the baseline ends up earlier than the anchor — decoding one from
      // the other's column would be visible here.
      expect(resumed.occurredAt).toBe(uninterrupted.occurredAt);
      expect(resumed.occurredAt).toBeLessThan(resumed.storageAnchorMs);
      expect(resumed.totalDurationMs).toBe(uninterrupted.totalDurationMs);
    });
  });

  describe("given the fallback-named trace folded without interruption", () => {
    it("lets the late real root take the trace name over from the fallback", () => {
      // Sanity anchor: the sequence really does exercise both fallback latches,
      // so a read-back that reset either has somewhere to bite.
      const complete = foldAll(FALLBACK_LIFECYCLE, projection.init());

      expect(project(complete).traceName).toBe("agent-run");
      expect(project(complete).rootSpanStartTimeMs).toBe(BASE_MS + 900);
    });
  });

  describe("given the renamed sequence folded without interruption", () => {
    const complete = foldAll(LIFECYCLE, projection.init());

    it("keeps the human's trace name against the late earlier-starting span", () => {
      // Sanity anchor for the property above: the sequence really does exercise
      // the name latch, so a lost `traceNameUserOverridden` has somewhere to bite.
      expect(project(complete).traceName).toBe("Renamed by a human");
    });

    it("keeps the explicit origin against the deferred resolver", () => {
      expect(project(complete).origin).toBe("playground");
    });

    it("accumulates cost and reserved cache tokens across spans and logs", () => {
      const row = project(complete);
      expect(row.totalCost).toBeCloseTo(0.06, 6);
      expect(row.cacheReadTokens).toBe(750);
      expect(row.spanCount).toBe(4);
    });
  });

  /**
   * The regression this property found, and the reason the trim now carries an
   * explicit accumulator set.
   *
   * `langwatch.prompt_ids` is a THIRD read-modify-write accumulator on the
   * attribute map (TraceAttributeAccumulationService unions each span's
   * `langwatch.prompt.id` into it), alongside the hoisted dimensions and the
   * `langwatch.reserved.*` sums — but it carried neither the reserved prefix nor
   * a typed column. So the trim treated it as an arbitrary key and dropped it
   * once the JSON passed the 256-char cap, around the eighth prompt-bearing span
   * in one trace, and `fromRow` could not re-inject it the way it re-injects
   * `langwatch.labels` from `Labels`. A trace resuming from its committed row
   * restarted the union from empty.
   *
   * Before read-back that was invisible: the trim only shrank the stored row,
   * and a store miss re-folded from `event_log`. Once the trimmed map became the
   * fold's next state, the same drop silently reset the accumulator.
   *
   * Fixed in `analytics-attribute-trim.service.ts` by keeping the named
   * FOLD_ACCUMULATOR_KEYS under the metadata cap rather than the arbitrary one,
   * which is why this fixture now passes. Nine spans is deliberately just past
   * the OLD 256-char boundary (~300 chars of JSON): it is the case that used to
   * fail, so it stays here as the regression guard. It does NOT exercise the
   * 4096-char metadata cap — past that, truncation still breaks the JSON and
   * resets the union, and the durable fix is a typed column with an element
   * cap. Nothing on this row is that today: `AnnotationIds` is an uncapped
   * `Array(String)` the fold appends to without bound, so it is a second
   * instance of the debt rather than the pattern to follow.
   */
  describe("given a trace whose accumulated prompt ids outgrow the attribute cap", () => {
    const promptSpans = Array.from({ length: 9 }, (_, index) =>
      spanEvent({
        eventId: `evt-prompt-${index}`,
        spanId: `dddd00000000000${index}`,
        parentSpanId: "dddd0000000000ff",
        name: `llm-call-${index}`,
        startMs: BASE_MS + index * 100,
        endMs: BASE_MS + index * 100 + 50,
        attributes: {
          "langwatch.span.type": "llm",
          "langwatch.prompt.id": `prompt_2Zx9QwErTyUiOpAsDfGhJ${index}:3`,
        },
      }),
    );

    it("reaches the same row as the fold that never lost its state", () => {
      const committed = foldAll(promptSpans.slice(0, 8), projection.init());

      const uninterrupted = foldAll(promptSpans.slice(8), committed);
      const resumed = foldAll(promptSpans.slice(8), roundTrip(committed));

      expect(project(resumed)).toEqual(project(uninterrupted));
    });
  });

  /**
   * PAST the accumulator cap, where equivalence is no longer the property.
   *
   * Every over-cap fixture above is a plain string no later span re-sends, so
   * nothing ever read a truncated value back. This one does: the committed row's
   * `langwatch.prompt_ids` is cut mid-array by the 4096-char cap, and the spans
   * after the split each carry another `langwatch.prompt.id`, so the accumulator
   * READS the fragment and writes the union back.
   *
   * Equivalence cannot hold here — a truncated union is information the row did
   * not keep — so the property under test is the weaker one the trim's docblock
   * actually promises: truncation RESETS the union. What it must never do is
   * treat the fragment as an element, which re-escapes it into the next array
   * and nests one level deeper per cycle until the value is unreadable garbage
   * for every downstream `prompt_ids` consumer. Three cycles is enough for
   * nesting to be unmistakable; a reset is a fixed point after the first.
   */
  describe("given accumulated prompt ids past the 4096-char cap re-sent by a later span", () => {
    // ~31 chars of JSON per id, so 200 ids is comfortably past 4096 and the
    // committed value is certain to be cut mid-array.
    const OVER_CAP_SPANS = 200;
    const overCapSpans = Array.from({ length: OVER_CAP_SPANS }, (_, index) =>
      spanEvent({
        eventId: `evt-overcap-${index}`,
        spanId: `eeee${String(index).padStart(12, "0")}`,
        parentSpanId: "eeee0000000000ff",
        name: `llm-call-${index}`,
        startMs: BASE_MS + index * 10,
        endMs: BASE_MS + index * 10 + 5,
        attributes: {
          "langwatch.span.type": "llm",
          "langwatch.prompt.id": `prompt_2Zx9QwErTyUiOpAsDfGhJ${index}:3`,
        },
      }),
    );

    const committed = foldAll(
      overCapSpans.slice(0, OVER_CAP_SPANS - 3),
      projection.init(),
    );
    const tail = overCapSpans.slice(OVER_CAP_SPANS - 3);

    /** One crash-and-resume cycle: commit the row, read it back, fold on. */
    function cycle(state: TraceAnalyticsData): TraceAnalyticsData {
      return foldAll(tail, roundTrip(state));
    }

    it("commits a value the cap really did cut mid-array", () => {
      // Guards the guard: if the fixture ever stops crossing the cap, every
      // assertion below would pass vacuously against an intact array.
      const raw = project(committed).attributes["langwatch.prompt_ids"] ?? "";

      expect(raw.length).toBeGreaterThan(4096);
      expect(raw.endsWith("]")).toBe(false);
    });

    it("restarts the union from the spans after the truncation", () => {
      const resumed = cycle(committed);
      const ids = JSON.parse(
        project(resumed).attributes["langwatch.prompt_ids"] ?? "[]",
      ) as string[];

      expect(ids).toEqual(
        tail.map(
          (_, index) =>
            `prompt_2Zx9QwErTyUiOpAsDfGhJ${OVER_CAP_SPANS - 3 + index}:3`,
        ),
      );
    });

    it("does not nest the truncated fragment back into the array", () => {
      let state = committed;
      for (let cycles = 0; cycles < 3; cycles++) state = cycle(state);

      const ids = JSON.parse(
        project(state).attributes["langwatch.prompt_ids"] ?? "[]",
      ) as string[];

      // The nesting signature: an element that is itself a serialised array.
      // Note the LENGTH stays put either way — the trim re-truncates to the same
      // cap every cycle — so size is not the tell; the element shape is.
      expect(ids.some((id) => id.trimStart().startsWith("["))).toBe(false);
      expect(ids.every((id) => id.startsWith("prompt_"))).toBe(true);
    });
  });
});

/**
 * Round-trip disposition for every field of the fold's working state.
 *
 * This table is the exhaustiveness guard: it is typed as a total map over
 * `keyof TraceAnalyticsData`, so ADDING a field to the state type fails to
 * compile until someone records what happens to it across the persistence
 * boundary — and the runtime key check below catches a field that exists on a
 * folded state without existing on the type.
 */
type RoundTripDisposition =
  /** The row carries a column for it and `fromRow` restores it verbatim. */
  | "restored"
  /** Deliberately lossy: the write-time trim decides what survives. */
  | "trimmed-at-write";

const TRACE_STATE_DISPOSITION = {
  traceId: "restored",
  spanCount: "restored",
  topicId: "restored",
  subTopicId: "restored",
  traceName: "restored",
  models: "restored",
  storageAnchorMs: "restored",
  occurredAt: "restored",
  totalDurationMs: "restored",
  totalCost: "restored",
  nonBilledCost: "restored",
  totalPromptTokenCount: "restored",
  totalCompletionTokenCount: "restored",
  timeToFirstTokenMs: "restored",
  tokensPerSecond: "restored",
  containsErrorStatus: "restored",
  annotationIds: "restored",
  attributes: "trimmed-at-write",
  rootSpanStartTimeMs: "restored",
  traceNameUserOverridden: "restored",
  traceNameFromFallback: "restored",
  rootMetadataFromFallback: "restored",
  createdAt: "restored",
  updatedAt: "restored",
  LastEventOccurredAt: "restored",
} satisfies Record<keyof TraceAnalyticsData, RoundTripDisposition>;

describe("traceAnalytics read-back field coverage", () => {
  describe("given a state still carrying the fallback name latches", () => {
    // Stopped one event short of the real root, so both fallback booleans are
    // TRUE here — on a completed trace they are false, and comparing false to
    // false would let a decoder that hardcodes them pass.
    const state = foldAll(FALLBACK_LIFECYCLE.slice(0, 3), projection.init());
    const decoded = roundTrip(state);

    it.each([
      "traceNameFromFallback",
      "rootMetadataFromFallback",
    ] as const)("restores %s while it is still set", (field) => {
      expect(state[field]).toBe(true);
      expect(decoded[field]).toBe(true);
    });
  });

  describe("given a state folded from the full event sequence", () => {
    const state = foldAll(LIFECYCLE, projection.init());
    const decoded = roundTrip(state);

    it("accounts for every field the fold actually carries", () => {
      // A new state field with no entry above fails to compile; one that only
      // exists at runtime fails here.
      expect(Object.keys(state).sort()).toEqual(
        Object.keys(TRACE_STATE_DISPOSITION).sort(),
      );
      expect(Object.keys(decoded).sort()).toEqual(
        Object.keys(TRACE_STATE_DISPOSITION).sort(),
      );
    });

    it.each(
      Object.entries(TRACE_STATE_DISPOSITION)
        .filter(([, disposition]) => disposition === "restored")
        .map(([field]) => field as keyof TraceAnalyticsData),
    )("restores %s verbatim from the row", (field) => {
      expect(decoded[field]).toEqual(state[field]);
    });

    describe("when the trimmed attribute map is decoded", () => {
      it("re-injects the hoisted dimensions from their typed columns", () => {
        expect(decoded.attributes["langwatch.user_id"]).toBe("user-9");
        expect(decoded.attributes["gen_ai.conversation.id"]).toBe("conv-9");
        expect(decoded.attributes["langwatch.customer_id"]).toBe("cust-9");
        expect(decoded.attributes["langwatch.origin"]).toBe("playground");
        expect(decoded.attributes["langwatch.labels"]).toBe(
          JSON.stringify(["alpha", "beta"]),
        );
      });

      it("carries the read-modify-write accumulators back untouched", () => {
        expect(decoded.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
          "750",
        );
        expect(decoded.attributes["langwatch.reserved.log_record_count"]).toBe(
          "1",
        );
      });

      it("hands back the capped metadata value, not the original", () => {
        // The one genuinely lossy key in this trace: the fold accumulated the
        // full blob, the row can only carry the capped copy, and re-capping it
        // is idempotent — which is why the equivalence property still holds.
        expect(state.attributes["metadata.debug_payload"]).toHaveLength(5000);
        expect(decoded.attributes["metadata.debug_payload"]).toMatch(/…$/);
        expect(
          decoded.attributes["metadata.debug_payload"]!.length,
        ).toBeLessThan(5000);
      });

      it("never had the payload span attribute to lose", () => {
        // `gen_ai.prompt` is on the span, but the accumulation service never
        // hoists it onto the trace map, so the boundary drops nothing here.
        expect(state.attributes["gen_ai.prompt"]).toBeUndefined();
        expect(decoded.attributes["gen_ai.prompt"]).toBeUndefined();
      });
    });
  });
});
