import { describe, expect, it } from "vitest";

import type { ProcessHandlerContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";
import { TRACK_EVENT_SPAN_NAME } from "~/server/tracer/constants";

import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  STALE_TRACE_THRESHOLD_MS,
  TOPIC_ASSIGNED_EVENT_TYPE,
} from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  buildProcessEventView,
  EVALUATION_TRIGGER_ENQUEUE,
  evaluationTriggerWake,
  handleTraceActivity,
} from "../evaluationTrigger.process";
import {
  CAUSALITY_DEPTH_ATTRIBUTE,
  EVALUATION_TRIGGER_ENQUEUE_WINDOW_MS,
  EVALUATION_TRIGGER_MAX_TRACE_AGE_MS,
  EVALUATION_TRIGGER_QUIET_PERIOD_MS,
  type EvaluationTriggerEventView,
  type EvaluationTriggerState,
  INITIAL_EVALUATION_TRIGGER_STATE,
} from "../evaluationTriggerProcess.types";

const TRACE_ID = "trace-1";
const PROJECT_ID = "project-1";
const NOW = 1_700_000_000_000;

type Intents = Parameters<typeof evaluationTriggerWake>[1]["intents"];

function makeCtx(
  overrides: {
    at?: number;
    now?: number;
    key?: string;
    projectId?: string;
  } = {},
): ProcessHandlerContext<any> {
  return {
    at: overrides.at ?? NOW,
    now: overrides.now ?? NOW,
    key: overrides.key ?? TRACE_ID,
    projectId: overrides.projectId ?? PROJECT_ID,
    intents: {
      requestEvaluations: (key: string, payload: unknown) => ({
        messageKey: key,
        intentType: "requestEvaluations",
        payload,
      }),
    } as unknown as Intents,
  };
}

/** An ordinary span: real execution, at causality depth zero. */
const MESSAGE: EvaluationTriggerEventView = {
  isMessage: true,
  isEligibleSpan: true,
  isEvaluatorSpan: false,
};

/** A span an evaluator workflow emitted. */
const EVALUATOR_SPAN: EvaluationTriggerEventView = {
  isMessage: true,
  isEligibleSpan: false,
  isEvaluatorSpan: true,
};

/** A thumbs-up posted through /api/track_event. */
const SYNTHETIC: EvaluationTriggerEventView = {
  isMessage: false,
  isEligibleSpan: false,
  isEvaluatorSpan: false,
};

function armed(
  overrides: Partial<EvaluationTriggerState> = {},
): EvaluationTriggerState {
  return {
    ...INITIAL_EVALUATION_TRIGGER_STATE,
    traceStartedAt: NOW,
    lastActivityAt: NOW,
    pendingEligibleSpanCount: 1,
    deadlineAt: NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS,
    ...overrides,
  };
}

function attribute(key: string, value: unknown) {
  return { key, value };
}

function spanEvent(
  overrides: { name?: string; spanAttributes?: unknown[] } = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    tenantId: PROJECT_ID,
    createdAt: NOW,
    occurredAt: NOW,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {
      span: {
        traceId: TRACE_ID,
        spanId: "span-1",
        parentSpanId: null,
        name: overrides.name ?? "chat",
        attributes: overrides.spanAttributes ?? [],
      },
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: TRACE_ID },
  } as unknown as TraceProcessingEvent;
}

describe("evaluationTrigger process", () => {
  describe("given a trace that is still being written to", () => {
    it("arms the quiet period on the first message", () => {
      const result = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        MESSAGE,
        makeCtx(),
      );

      expect(result.nextWakeAt).toBe(NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS);
      expect(result.state.deadlineAt).toBe(
        NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS,
      );
    });

    /** @scenario "A conversation that resumes pushes the wait out" */
    it("pushes the wait out when another message arrives", () => {
      const first = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        MESSAGE,
        makeCtx(),
      );

      const second = handleTraceActivity(
        first.state,
        MESSAGE,
        makeCtx({ at: NOW + 10_000, now: NOW + 10_000 }),
      );

      // A fixed dedup window fires a set interval after the FIRST message of
      // the window, evaluating a conversation that is still going.
      expect(second.nextWakeAt).toBe(
        NOW + 10_000 + EVALUATION_TRIGGER_QUIET_PERIOD_MS,
      );
    });

    it("asks for nothing until the trace goes quiet", () => {
      const result = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        MESSAGE,
        makeCtx(),
      );

      expect(result.intents ?? []).toEqual([]);
    });

    it("records when the trace started and when it last spoke", () => {
      const first = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        MESSAGE,
        makeCtx(),
      );

      // Out of order on purpose: events are delivered at least once and in no
      // guaranteed order, so a late-arriving earlier span must move the start
      // back rather than forward.
      const earlier = handleTraceActivity(
        first.state,
        MESSAGE,
        makeCtx({ at: NOW - 5_000, now: NOW + 1_000 }),
      );

      expect(earlier.state.traceStartedAt).toBe(NOW - 5_000);
      expect(earlier.state.lastActivityAt).toBe(NOW);
    });
  });

  describe("given a synthetic event span", () => {
    it("arms nothing for it", () => {
      const result = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        SYNTHETIC,
        makeCtx(),
      );

      expect(result.nextWakeAt).toBeNull();
    });

    it("leaves a trace that already armed one alone", () => {
      const result = handleTraceActivity(
        armed(),
        SYNTHETIC,
        makeCtx({ at: NOW + 5_000, now: NOW + 5_000 }),
      );

      // Returning nothing would CLEAR the wake rather than leave it, and a
      // thumbs-up must not cancel a pending evaluation.
      expect(result.nextWakeAt).toBe(NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS);
    });
  });

  describe("given a span an evaluator emitted", () => {
    it("counts it apart from the spans that could trigger an evaluation", () => {
      const result = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        EVALUATOR_SPAN,
        makeCtx(),
      );

      expect(result.state.pendingEligibleSpanCount).toBe(0);
      expect(result.state.evaluatorEmittedSpanCount).toBe(1);
    });

    it("still treats it as activity on the trace", () => {
      // The loop guard reads a feature flag and records a metric, so it is
      // decided in the intent handler. Declining here would decide it with the
      // kill switch unread.
      const result = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        EVALUATOR_SPAN,
        makeCtx(),
      );

      expect(result.nextWakeAt).toBe(NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS);
    });
  });

  describe("given the subscriber is backed up", () => {
    it("schedules from now, not from the event's own instant", () => {
      const lagged = makeCtx({ at: NOW - 20_000, now: NOW });

      const result = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        MESSAGE,
        lagged,
      );

      expect(result.nextWakeAt).toBe(NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS);
    });

    it("arms nothing for a resync flood", () => {
      const resync = makeCtx({
        at: NOW - STALE_TRACE_THRESHOLD_MS - 1,
        now: NOW,
      });

      const result = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        MESSAGE,
        resync,
      );

      expect(result.nextWakeAt).toBeNull();
    });

    it("leaves an already-armed deadline alone when a resync event arrives", () => {
      const resync = makeCtx({
        at: NOW - STALE_TRACE_THRESHOLD_MS - 1,
        now: NOW,
      });

      const result = handleTraceActivity(armed(), MESSAGE, resync);

      expect(result.nextWakeAt).toBe(NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS);
    });
  });

  describe("given a trace that started days ago", () => {
    /** @scenario evaluations do not re-run for a trace older than the cutoff */
    it("arms nothing, even for a genuinely new message", () => {
      const historic = armed({
        traceStartedAt: NOW - EVALUATION_TRIGGER_MAX_TRACE_AGE_MS - 1,
        deadlineAt: null,
      });

      const result = handleTraceActivity(historic, MESSAGE, makeCtx());

      // The event is fresh; the trace is not. Re-evaluating days-old traces is
      // never wanted, whatever re-touched them. A daily clustering pass
      // re-touches thousands of them at once (2026-05-27 incident).
      expect(result.nextWakeAt).toBeNull();
    });

    it("never asks for its evaluations, because nothing wakes it", () => {
      const historic = armed({
        traceStartedAt: NOW - EVALUATION_TRIGGER_MAX_TRACE_AGE_MS - 1,
        deadlineAt: null,
      });

      const result = handleTraceActivity(historic, MESSAGE, makeCtx());

      expect(result.state.deadlineAt).toBeNull();
      expect(result.intents ?? []).toEqual([]);
    });
  });

  describe("given a recent trace", () => {
    /** @scenario a new span on a recent trace re-runs evaluations */
    it("asks for its evaluations once the new span's quiet period elapses", () => {
      const alreadyEvaluated = armed({
        traceStartedAt: NOW - 60_000,
        deadlineAt: null,
        pendingEligibleSpanCount: 0,
        requestCount: 1,
      });

      const resumed = handleTraceActivity(
        alreadyEvaluated,
        MESSAGE,
        makeCtx({ at: NOW, now: NOW }),
      );
      const woken = evaluationTriggerWake(
        resumed.state,
        makeCtx({ now: resumed.nextWakeAt! }),
      );

      expect(resumed.nextWakeAt).toBe(NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS);
      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]?.payload).toMatchObject({
        traceId: TRACE_ID,
        pendingEligibleSpanCount: 1,
      });
    });
  });

  describe("given the topic-clustering pass assigns a topic to a trace", () => {
    /** @scenario a topic assignment does not re-run evaluations */
    it("arms nothing for it", () => {
      const view = buildProcessEventView({
        type: TOPIC_ASSIGNED_EVENT_TYPE,
        data: { topicId: "topic-1", subtopicId: null },
      } as unknown as TraceProcessingEvent);

      const result = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        view,
        makeCtx(),
      );

      // A derived enrichment updates the trace but adds no message content.
      // The daily clustering pass appends one of these to thousands of
      // historical traces, and treating that as new activity re-ran every
      // monitor over the whole backlog (2026-05-27 read-amplification).
      expect(view.isMessage).toBe(false);
      expect(result.nextWakeAt).toBeNull();
      expect(result.intents ?? []).toEqual([]);
    });

    it("leaves a trace that already armed a quiet period alone", () => {
      const view = buildProcessEventView({
        type: TOPIC_ASSIGNED_EVENT_TYPE,
        data: { topicId: "topic-1", subtopicId: null },
      } as unknown as TraceProcessingEvent);

      const result = handleTraceActivity(
        armed(),
        view,
        makeCtx({ at: NOW + 5_000, now: NOW + 5_000 }),
      );

      // Returning nothing would CLEAR the wake rather than leave it, and a
      // topic landing must not cancel a pending evaluation either.
      expect(result.nextWakeAt).toBe(NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS);
    });
  });

  describe("when the quiet period elapses", () => {
    it("asks for the trace's evaluations", () => {
      const woken = evaluationTriggerWake(armed(), makeCtx());

      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]?.payload).toEqual({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
        occurredAt: NOW,
        requestGeneration: 0,
        pendingEligibleSpanCount: 1,
        evaluatorEmittedSpanCount: 0,
      });
    });

    it("hands the pending spans over to the request it raised", () => {
      const woken = evaluationTriggerWake(armed(), makeCtx());

      // The count travels on the payload and the instance goes back to zero,
      // so the NEXT request has to be justified by spans that arrive after
      // this one. A count that stayed put would let an evaluator's own span
      // ride the trace's history into a fresh dispatch, which is the loop.
      expect(woken.state.pendingEligibleSpanCount).toBe(0);
    });

    it("keeps the trace's evaluator-span census across the request", () => {
      const woken = evaluationTriggerWake(
        armed({ evaluatorEmittedSpanCount: 2 }),
        makeCtx(),
      );

      // Cumulative on purpose: a trace whose every span came out of an
      // evaluator must still read as a loop when its origin resolves minutes
      // later, long after any per-request count would have been cleared.
      expect(woken.state.evaluatorEmittedSpanCount).toBe(2);
    });

    it("clears its own deadline", () => {
      const woken = evaluationTriggerWake(armed(), makeCtx());

      expect(woken.nextWakeAt).toBeNull();
      expect(woken.state.deadlineAt).toBeNull();
    });

    it("addresses one generation by the same key every time", () => {
      const first = evaluationTriggerWake(armed(), makeCtx());
      const second = evaluationTriggerWake(
        armed(),
        makeCtx({ now: NOW + 5000 }),
      );

      // A stable message key is what lets the outbox collapse a duplicate wake.
      expect(first.intents?.[0]?.messageKey).toBe(
        second.intents?.[0]?.messageKey,
      );
    });

    it("asks again under a new key when the trace resumes", () => {
      const first = evaluationTriggerWake(armed(), makeCtx());

      const resumed = handleTraceActivity(
        first.state,
        MESSAGE,
        makeCtx({ at: NOW + 60_000, now: NOW + 60_000 }),
      );
      const second = evaluationTriggerWake(
        resumed.state,
        makeCtx({ now: NOW + 90_000 }),
      );

      // A permanent latch would make an ask that declined — a trace whose
      // origin had not resolved yet, say — the last word on that trace.
      expect(second.intents).toHaveLength(1);
      expect(second.intents?.[0]?.messageKey).not.toBe(
        first.intents?.[0]?.messageKey,
      );
    });

    it("numbers each ask so its evaluations can be told apart from a retry's", () => {
      const first = evaluationTriggerWake(armed(), makeCtx());
      const second = evaluationTriggerWake(
        first.state,
        makeCtx({ now: NOW + 90_000 }),
      );

      // The generation reaches the payload, not just the message key: the
      // evaluation ids are derived from it, which is what stops a retry
      // billing a second run of an evaluation it already dispatched.
      expect(
        (first.intents?.[0]?.payload as { requestGeneration: number })
          .requestGeneration,
      ).toBe(0);
      expect(
        (second.intents?.[0]?.payload as { requestGeneration: number })
          .requestGeneration,
      ).toBe(1);
    });
  });

  describe("given a trace with no id", () => {
    it("arms nothing", () => {
      const result = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        MESSAGE,
        makeCtx({ key: "" }),
      );

      expect(result.nextWakeAt).toBeNull();
    });

    it("clears itself instead of being re-found forever", () => {
      const woken = evaluationTriggerWake(armed(), makeCtx({ key: "" }));

      expect(woken.intents ?? []).toEqual([]);
      expect(woken.nextWakeAt).toBeNull();
    });
  });

  describe("the content boundary", () => {
    it("keeps span payload out of the persisted view", () => {
      const view = buildProcessEventView(
        spanEvent({
          spanAttributes: [
            attribute("gen_ai.prompt", {
              stringValue: "the customer's secret",
            }),
          ],
        }),
      );

      expect(view).toEqual({
        isMessage: true,
        isEligibleSpan: true,
        isEvaluatorSpan: false,
      });
    });

    it("reads a synthetic event span as no message at all", () => {
      const view = buildProcessEventView(
        spanEvent({ name: TRACK_EVENT_SPAN_NAME }),
      );

      expect(view.isMessage).toBe(false);
      expect(view.isEligibleSpan).toBe(false);
    });

    it("reads the causality depth an evaluator stamped", () => {
      const view = buildProcessEventView(
        spanEvent({
          spanAttributes: [
            attribute("langwatch.reserved.causality_depth", { intValue: 1 }),
          ],
        }),
      );

      expect(view.isEvaluatorSpan).toBe(true);
      expect(view.isEligibleSpan).toBe(false);
    });

    it("reads the depth whichever way the SDK encoded it", () => {
      const encodings = [
        { intValue: "2" },
        { stringValue: "3" },
        { doubleValue: 1 },
      ];

      for (const value of encodings) {
        const view = buildProcessEventView(
          spanEvent({
            spanAttributes: [
              attribute("langwatch.reserved.causality_depth", value),
            ],
          }),
        );
        expect(view.isEvaluatorSpan).toBe(true);
      }
    });

    it("treats depth zero as an ordinary message", () => {
      const view = buildProcessEventView(
        spanEvent({
          spanAttributes: [
            attribute("langwatch.reserved.causality_depth", { intValue: 0 }),
          ],
        }),
      );

      expect(view.isEligibleSpan).toBe(true);
    });

    it("reads a resolved origin as activity that triggers nothing on its own", () => {
      const view = buildProcessEventView({
        type: ORIGIN_RESOLVED_EVENT_TYPE,
        data: { origin: "application", reason: "deferred_fallback" },
      } as unknown as TraceProcessingEvent);

      expect(view).toEqual({
        isMessage: true,
        isEligibleSpan: false,
        isEvaluatorSpan: false,
      });
    });

    it("reads a malformed span as an ordinary message rather than skipping it", () => {
      const view = buildProcessEventView({
        type: SPAN_RECEIVED_EVENT_TYPE,
        data: { span: { attributes: "not an array" } },
      } as unknown as TraceProcessingEvent);

      // The predicate this replaces failed OPEN — a throw was read as "yes" —
      // and the boundary keeps pointing that way. A misread costs one ask the
      // handler declines; the opposite misread costs an evaluation, silently.
      expect(view).toEqual({
        isMessage: true,
        isEligibleSpan: true,
        isEvaluatorSpan: false,
      });
    });
  });

  describe("given every process is restarted before the trace goes quiet", () => {
    /** @scenario "A matching trace is evaluated even if the worker restarts" */
    it("still asks for the evaluation when the wait is over", () => {
      const arming = handleTraceActivity(
        INITIAL_EVALUATION_TRIGGER_STATE,
        buildProcessEventView(spanEvent()),
        makeCtx(),
      );

      expect(arming.nextWakeAt).toBe(NOW + EVALUATION_TRIGGER_QUIET_PERIOD_MS);

      // The restart: everything in memory is gone, and the process comes back
      // from the row it committed — which is JSON, not a live object.
      const rehydrated = JSON.parse(
        JSON.stringify(arming.state),
      ) as EvaluationTriggerState;

      const firing = evaluationTriggerWake(
        rehydrated,
        makeCtx({ now: arming.nextWakeAt! }),
      );

      expect(firing.intents).toHaveLength(1);
      expect(firing.intents?.[0]?.payload).toMatchObject({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
        pendingEligibleSpanCount: 1,
      });
      expect(firing.nextWakeAt).toBeNull();
    });
  });

  describe("given a trace whose spans all say the same thing", () => {
    const dedup = (() => {
      const config = EVALUATION_TRIGGER_ENQUEUE.deduplication;
      if (typeof config !== "object") {
        throw new Error("expected a deduplication config");
      }
      return config;
    })();

    it("stages one job for the whole window instead of one per span", () => {
      // The regression: without an enqueue declaration a 10k-span trace cost
      // 10k jobs, 10k inbox rows and 10k durable transitions to re-arm one
      // deadline. The reactor this replaced deduplicated per trace.
      expect(dedup.ttlMs).toBe(EVALUATION_TRIGGER_ENQUEUE_WINDOW_MS);
      expect(dedup.makeId(spanEvent())).toBe(dedup.makeId(spanEvent()));
    });

    it("closes the window well inside the quiet period it re-arms", () => {
      // A window as long as the quiet period could let the deadline elapse
      // between two deliveries of a trace that is still ingesting — evaluating
      // a half-finished trace, then billing a second generation for the rest.
      expect(EVALUATION_TRIGGER_ENQUEUE_WINDOW_MS).toBeLessThan(
        EVALUATION_TRIGGER_QUIET_PERIOD_MS,
      );
    });

    it("holds the window open past dispatch, so it is a rate bound and not an accident", () => {
      expect(dedup.shouldSurviveDispatch).toBe(true);
      expect(dedup.extend).toBe(false);
    });

    it("declines nothing pre-enqueue, because every event it is mounted on moves its state", () => {
      expect(EVALUATION_TRIGGER_ENQUEUE.filter).toBeUndefined();
    });
  });

  describe("given a trace carrying both real spans and an evaluator's own", () => {
    const dedup = (() => {
      const config = EVALUATION_TRIGGER_ENQUEUE.deduplication;
      if (typeof config !== "object") {
        throw new Error("expected a deduplication config");
      }
      return config;
    })();

    it("never collapses an eligible span into an evaluator span", () => {
      // Collapsing them would let the loop guard read "every span here came out
      // of an evaluation" for a trace that had genuine activity, and silently
      // decline a customer's evaluation.
      const evaluatorSpan = spanEvent({
        spanAttributes: [attribute(CAUSALITY_DEPTH_ATTRIBUTE, { intValue: 1 })],
      });

      expect(dedup.makeId(evaluatorSpan)).not.toBe(dedup.makeId(spanEvent()));
    });

    it("never collapses a synthetic feedback span into a real one", () => {
      expect(dedup.makeId(spanEvent({ name: TRACK_EVENT_SPAN_NAME }))).not.toBe(
        dedup.makeId(spanEvent()),
      );
    });

    it("never collapses a deferred origin resolution into a span", () => {
      const originResolved = {
        ...spanEvent(),
        type: ORIGIN_RESOLVED_EVENT_TYPE,
        data: { origin: "application", reason: "deferred_fallback" },
      } as unknown as TraceProcessingEvent;

      expect(dedup.makeId(originResolved)).not.toBe(dedup.makeId(spanEvent()));
    });

    it("stays total against a span it cannot make sense of", () => {
      // `makeId` runs at the routing seam inside `queue.send`; a throw there
      // loses this process's job for the event permanently (ADR-098).
      const malformed = {
        ...spanEvent(),
        data: { span: "not-an-object" },
      } as unknown as TraceProcessingEvent;

      expect(() => dedup.makeId(malformed)).not.toThrow();
    });
  });
});
