import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createEvaluationTriggerReactor,
  type EvaluationTriggerReactorDeps,
} from "../evaluationTrigger.reactor";
import { DEFERRED_CHECK_DELAY_MS } from "../originGate.reactor";
import { TRACK_EVENT_SPAN_NAME } from "~/server/tracer/constants";

function createFoldState(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "",
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
    rootSpanType: null,
    containsAi: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    LastEventOccurredAt: 0,
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attributes: {},
    ...overrides,
  };
}

function createEvent(
  overrides: Partial<TraceProcessingEvent> & { spanName?: string } = {},
): TraceProcessingEvent {
  const { spanName, ...rest } = overrides;
  // When spanName is provided, build a valid span_received event. When omitted,
  // build an origin_resolved event — represents non-span events flowing through
  // the reactor (must NOT be short-circuited by the synthetic-span filter).
  if (spanName === undefined) {
    return {
      id: "event-1",
      aggregateId: "trace-1",
      aggregateType: "trace",
      tenantId: "tenant-1",
      createdAt: Date.now(),
      occurredAt: Date.now(),
      type: "lw.obs.trace.origin_resolved",
      version: 1,
      data: { origin: "application" },
      metadata: { traceId: "trace-1" },
      ...rest,
    } as TraceProcessingEvent;
  }
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: { span: { name: spanName } },
    metadata: { spanId: "span-1", traceId: "trace-1" },
    ...rest,
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
  overrides: Partial<EvaluationTriggerReactorDeps> = {},
): EvaluationTriggerReactorDeps {
  return {
    monitors: {
      getEnabledOnMessageMonitors: vi.fn().mockResolvedValue([
        { id: "mon-1", checkType: "llm/boolean", name: "Test Monitor", evaluator: null },
      ]),
    } as unknown as EvaluationTriggerReactorDeps["monitors"],
    evaluation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("evaluationTrigger reactor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when trace has explicit application origin", () => {
    it("dispatches evaluation commands", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when trace has non-application origin", () => {
    it("dispatches for origin 'simulation' (preconditions handle filtering)", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "simulation" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });

    it("dispatches for origin 'evaluation' (preconditions handle filtering)", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "evaluation" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when trace has no origin", () => {
    it("returns early without dispatching evaluations", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({ attributes: {} });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when trace-level eval is dispatched", () => {
    it("uses 6-minute dedup TTL to outlast deferred origin window", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await reactor.handle(createEvent(), createContext(state));

      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(options).toBeDefined();
      expect(options!.deduplication).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(DEFERRED_CHECK_DELAY_MS + 60_000);
      expect(options!.delay).toBeUndefined();
    });
  });

  describe("when trace is blocked by guardrail with no output", () => {
    it("skips without dispatching", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        blockedByGuardrail: true,
        computedOutput: null,
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when inbound event is a synthetic span (langwatch.track_event)", () => {
    // Regression test for Bug 2 of issue #3875: the reactor must short-circuit
    // BEFORE querying monitors when the inbound span name is a synthetic event
    // like TRACK_EVENT_SPAN_NAME. Without this filter, thumbs-up/down feedback
    // spans re-trigger ON_MESSAGE monitors and the presidio evaluator crashes
    // on null computedInput/Output.
    it("does NOT invoke monitor service", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      // Origin gate must pass so that only the synthetic-span check rejects.
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createEvent({ spanName: TRACK_EVENT_SPAN_NAME });

      await reactor.handle(event, createContext(state));

      // Filter must happen BEFORE the DB lookup.
      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
    });

    it("does NOT dispatch evaluation commands", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createEvent({ spanName: TRACK_EVENT_SPAN_NAME });

      await reactor.handle(event, createContext(state));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when inbound event is a normal (non-synthetic) span", () => {
    it("dispatches evaluation commands", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createEvent({ spanName: "openai.chat" });

      await reactor.handle(event, createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when inbound event has no span data field", () => {
    // Events without a span (e.g. non-span event types) must NOT be short-circuited
    // by the synthetic-span filter — only an explicit name match should reject.
    it("dispatches evaluation commands", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });
});
