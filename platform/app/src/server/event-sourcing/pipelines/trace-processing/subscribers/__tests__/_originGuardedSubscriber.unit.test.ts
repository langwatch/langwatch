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
    // start time, so a late origin resolution must be rejected on its own.
    /** @scenario "a late origin resolution on a trace with no recorded spans does not re-run evaluations" */
    it("rejects a late origin resolution even though the origin is set", () => {
      expect(
        passesTraceOriginGuards(
          event({ type: ORIGIN_RESOLVED_EVENT_TYPE }),
          fold({ spanCount: 0, occurredAt: 0 }),
        ),
      ).toBe(false);
    });

    /** @scenario "a late origin resolution on a recent trace whose span has no valid timing still re-runs evaluations" */
    it("still admits a recent trace whose only span left the start time unknown", () => {
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
