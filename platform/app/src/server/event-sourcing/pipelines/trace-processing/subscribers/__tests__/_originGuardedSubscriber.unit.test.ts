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
