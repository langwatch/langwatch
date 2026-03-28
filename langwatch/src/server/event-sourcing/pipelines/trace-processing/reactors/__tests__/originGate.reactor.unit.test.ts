import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createOriginGateReactor,
  createDeferredOriginHandler,
  makeDeferredJobId,
  type OriginGateReactorDeps,
  type DeferredOriginPayload,
} from "../originGate.reactor";

function createFoldState(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "hello",
    computedOutput: "world",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    hasAnnotation: null,
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attributes: {},
    ...overrides,
  };
}

function createEvent(
  overrides: Partial<TraceProcessingEvent> = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {},
    metadata: { spanId: "span-1", traceId: "trace-1" },
    ...overrides,
  } as TraceProcessingEvent;
}

function createContext(
  foldState: TraceSummaryData,
): ReactorContext<TraceSummaryData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    foldState,
  };
}

function createDeps(
  overrides: Partial<OriginGateReactorDeps> = {},
): OriginGateReactorDeps {
  return {
    scheduleDeferred: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("originGate reactor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when origin is already resolved", () => {
    it("does not schedule deferred resolution", async () => {
      const deps = createDeps();
      const reactor = createOriginGateReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.scheduleDeferred).not.toHaveBeenCalled();
    });

    it("skips for all origin types", async () => {
      for (const origin of ["application", "evaluation", "simulation", "workflow"]) {
        const deps = createDeps();
        const reactor = createOriginGateReactor(deps);
        const state = createFoldState({
          attributes: { "langwatch.origin": origin },
        });

        await reactor.handle(createEvent(), createContext(state));

        expect(deps.scheduleDeferred).not.toHaveBeenCalled();
      }
    });
  });

  describe("when origin is absent (pure OTEL trace)", () => {
    it("schedules deferred origin resolution with traceId as id", async () => {
      const deps = createDeps();
      const reactor = createOriginGateReactor(deps);
      const state = createFoldState({ attributes: {} });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.scheduleDeferred).toHaveBeenCalledWith({
        id: "trace-1",
        tenantId: "tenant-1",
        traceId: "trace-1",
      });
    });
  });

  describe("when trace is old (resyncing)", () => {
    it("skips without scheduling", async () => {
      const deps = createDeps();
      const reactor = createOriginGateReactor(deps);
      const state = createFoldState({ attributes: {} });
      const oldEvent = createEvent({
        occurredAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      });

      await reactor.handle(oldEvent, createContext(state));

      expect(deps.scheduleDeferred).not.toHaveBeenCalled();
    });
  });
});

describe("createDeferredOriginHandler()", () => {
  describe("when called", () => {
    it("dispatches resolveOrigin command unconditionally", async () => {
      const resolveOriginFn = vi.fn().mockResolvedValue(undefined);
      const handler = createDeferredOriginHandler(resolveOriginFn);
      const payload: DeferredOriginPayload = {
        id: "trace-1",
        tenantId: "tenant-1",
        traceId: "trace-1",
      };

      await handler(payload);

      expect(resolveOriginFn).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        traceId: "trace-1",
        origin: "application",
        reason: "deferred_fallback",
        occurredAt: expect.any(Number),
      });
      // occurredAt should be the dispatch time (now), not the original trace time
      const calledOccurredAt = resolveOriginFn.mock.calls[0]![0].occurredAt;
      expect(calledOccurredAt).toBeGreaterThanOrEqual(Date.now() - 1000);
      expect(calledOccurredAt).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  describe("when resolveOrigin throws", () => {
    it("propagates the error", async () => {
      const resolveOriginFn = vi.fn().mockRejectedValue(new Error("command failed"));
      const handler = createDeferredOriginHandler(resolveOriginFn);
      const payload: DeferredOriginPayload = {
        id: "trace-1",
        tenantId: "tenant-1",
        traceId: "trace-1",
      };

      await expect(handler(payload)).rejects.toThrow("command failed");
    });
  });
});

describe("makeDeferredJobId()", () => {
  it("generates dedup key from tenant and trace", () => {
    const payload: DeferredOriginPayload = {
      id: "trace-1",
      tenantId: "tenant-1",
      traceId: "trace-1",
    };
    expect(makeDeferredJobId(payload)).toBe("deferred-origin:tenant-1:trace-1");
  });
});
