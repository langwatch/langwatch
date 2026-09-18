import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import { passesTraceOriginGuards } from "../_originGuardedSubscriber";

const NOW = new Date("2026-07-18T12:00:00.000Z").getTime();

function event(
  overrides: Partial<TraceProcessingEvent> = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "project-1",
    occurredAt: NOW,
    createdAt: NOW,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-01-14",
    data: {},
    ...overrides,
  } as TraceProcessingEvent;
}

function fold(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "trace-1",
    occurredAt: NOW,
    spanCount: 1,
    blockedByGuardrail: false,
    computedOutput: "answer",
    attributes: { "langwatch.origin": "application" },
    ...overrides,
  } as TraceSummaryData;
}

describe("passesTraceOriginGuards", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a recent message event on a recent resolved trace", () => {
    /** @scenario "a new span on a recent trace re-runs evaluations" */
    it("admits span and origin-resolution events", () => {
      expect(passesTraceOriginGuards(event(), fold())).toBe(true);
      expect(
        passesTraceOriginGuards(
          event({ type: ORIGIN_RESOLVED_EVENT_TYPE }),
          fold(),
        ),
      ).toBe(true);
    });
  });

  describe("given an event older than one hour", () => {
    it("rejects it", () => {
      expect(
        passesTraceOriginGuards(
          event({ occurredAt: NOW - 60 * 60 * 1000 - 1 }),
          fold(),
        ),
      ).toBe(false);
    });
  });

  describe("given a derived trace event", () => {
    /** @scenario "a topic assignment does not re-run evaluations" */
    it("rejects it", () => {
      expect(
        passesTraceOriginGuards(
          event({ type: "lw.obs.trace.topic_assigned" }),
          fold(),
        ),
      ).toBe(false);
    });
  });

  describe("given a trace older than the 24-hour trace-age cap", () => {
    /** @scenario "evaluations do not re-run for a trace older than the cutoff" */
    it("rejects a fresh span while admitting a trace just inside the cap", () => {
      expect(
        passesTraceOriginGuards(
          event(),
          fold({ occurredAt: NOW - 24 * 60 * 60 * 1000 - 1 }),
        ),
      ).toBe(false);
      expect(
        passesTraceOriginGuards(
          event(),
          fold({ occurredAt: NOW - 24 * 60 * 60 * 1000 + 1 }),
        ),
      ).toBe(true);
    });
  });

  describe("given a fold state with no recorded spans", () => {
    // A trace summary outside the fold's read window rehydrates empty:
    // spanCount 0, occurredAt 0. The trace-age cap cannot fire on a zero
    // start time, so a late origin resolution passes every shared guard.
    //
    // That stays true here on purpose. The empty-fold rule is an EVALUATION
    // rule, not a trace-processing one, so it lives on the evaluation
    // trigger (see evaluationTrigger.guards.unit.test.ts) and not in this
    // shared chain, which the EE trace-alert subscriber also runs. Alerting
    // on a trace whose fold rehydrated empty is a separate product question
    // from evaluating it, and this guard must not decide it for both.
    //
    // Admitting it here is NOT a statement that the alert is then correct.
    // Downstream the trigger's filters are matched against this same empty
    // fold, so a filtered alert is discarded at confirm and an unfiltered one
    // notifies with blank content. Tracked on the alert-path issue.
    it("admits a late origin resolution, leaving the rule to each subscriber", () => {
      expect(
        passesTraceOriginGuards(
          event({ type: ORIGIN_RESOLVED_EVENT_TYPE }),
          fold({ spanCount: 0, occurredAt: 0 }),
        ),
      ).toBe(true);
    });

    // "Age unknown", not "recent": with no valid start time the age cap has
    // nothing to compare, so this admits the trace without establishing its
    // age at all. spanCount is the signal being tested, not recency.
    it("still admits a trace of unknown age whose only span left the start time unknown", () => {
      expect(
        passesTraceOriginGuards(
          event({ type: ORIGIN_RESOLVED_EVENT_TYPE }),
          fold({ spanCount: 1, occurredAt: 0 }),
        ),
      ).toBe(true);
    });
  });

  describe("given a trace without a usable resolved origin", () => {
    it("rejects unresolved and guardrail-blocked folds", () => {
      expect(passesTraceOriginGuards(event(), fold({ attributes: {} }))).toBe(
        false,
      );
      expect(
        passesTraceOriginGuards(
          event(),
          fold({ blockedByGuardrail: true, computedOutput: null }),
        ),
      ).toBe(false);
    });
  });
});
