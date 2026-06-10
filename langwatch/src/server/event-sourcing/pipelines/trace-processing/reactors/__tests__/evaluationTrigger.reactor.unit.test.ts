import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createEvaluationTriggerReactor,
  detectCausalityLoop,
  type EvaluationTriggerReactorDeps,
} from "../evaluationTrigger.reactor";
import { DEFERRED_CHECK_DELAY_MS } from "../originGate.reactor";
import { TRACK_EVENT_SPAN_NAME } from "~/server/tracer/constants";
import { MAX_PROCESSED_SPANS } from "../../projections/traceSummary.foldProjection";

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
    nonBilledCost: null,
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

interface SpanEventOpts {
  spanName?: string;
  spanId?: string;
  parentSpanId?: string | null;
  attributes?: Array<{ key: string; value: unknown }>;
}

function createSpanEvent(opts: SpanEventOpts = {}): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {
      span: {
        name: opts.spanName ?? "openai.chat",
        spanId: opts.spanId ?? "span-1",
        parentSpanId: opts.parentSpanId ?? null,
        attributes: opts.attributes ?? [],
      },
    },
    metadata: { spanId: opts.spanId ?? "span-1", traceId: "trace-1" },
  } as unknown as TraceProcessingEvent;
}

function createTopicAssignedEvent(): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.topic_assigned",
    version: 1,
    data: { topicId: "topic-1", subtopicId: null },
    metadata: { traceId: "trace-1" },
  } as unknown as TraceProcessingEvent;
}

function createOriginEvent(origin = "application"): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.origin_resolved",
    version: 1,
    data: { origin },
    metadata: { traceId: "trace-1" },
  } as unknown as TraceProcessingEvent;
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

describe("detectCausalityLoop (pure)", () => {
  /** @scenario Incoming span with causality_depth=1 does not trigger evaluations */
  it("returns 'depth_direct' when inbound span attr has reserved.causality_depth=1", () => {
    const reason = detectCausalityLoop({
      spanAttributes: [
        { key: "langwatch.reserved.causality_depth", value: { intValue: 1 } },
      ],
    });
    expect(reason).toBe("depth_direct");
  });

  /** @scenario Incoming span with causality_depth=0 still triggers evaluations */
  it("returns null when inbound span attr has reserved.causality_depth=0", () => {
    const reason = detectCausalityLoop({
      spanAttributes: [
        { key: "langwatch.reserved.causality_depth", value: { intValue: 0 } },
      ],
    });
    expect(reason).toBeNull();
  });

  /** @scenario Incoming span with no causality_depth attribute is treated as depth 0 */
  it("returns null when no causality_depth attribute is present", () => {
    const reason = detectCausalityLoop({
      spanAttributes: [{ key: "service.name", value: { stringValue: "x" } }],
    });
    expect(reason).toBeNull();
  });

  it("accepts depth as a string-valued OTLP attribute", () => {
    const reason = detectCausalityLoop({
      spanAttributes: [
        { key: "langwatch.reserved.causality_depth", value: { stringValue: "2" } },
      ],
    });
    expect(reason).toBe("depth_direct");
  });

  it("ignores malformed depth values", () => {
    const reason = detectCausalityLoop({
      spanAttributes: [
        { key: "langwatch.reserved.causality_depth", value: { stringValue: "abc" } },
      ],
    });
    expect(reason).toBeNull();
  });
});

describe("evaluationTrigger reactor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    delete process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD;
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

      await reactor.handle(createOriginEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the event is a derived enrichment (topic assignment)", () => {
    /** @scenario a topic assignment does not re-run evaluations */
    it("does not dispatch evaluations", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await reactor.handle(createTopicAssignedEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when the trace is older than the evaluation cutoff", () => {
    /** @scenario evaluations do not re-run for a trace older than the cutoff */
    it("does not dispatch even on a genuine new span", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        occurredAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      });

      await reactor.handle(createSpanEvent(), createContext(state));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });

    /** @scenario a new span on a recent trace re-runs evaluations */
    it("dispatches for a recent trace", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        occurredAt: Date.now(),
      });

      await reactor.handle(createSpanEvent(), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the trace exceeds the processing cap", () => {
    /** @scenario Evaluations run for a trace under the processing cap */
    it("dispatches evaluations for a trace just under the cap", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        spanCount: MAX_PROCESSED_SPANS - 1,
        occurredAt: Date.now(),
      });

      await reactor.handle(createSpanEvent(), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });

    /** @scenario Evaluations are skipped for a trace over the processing cap */
    it("skips evaluation dispatch once the trace passes the cap (span still stored elsewhere)", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        spanCount: MAX_PROCESSED_SPANS,
        occurredAt: Date.now(),
      });

      await reactor.handle(createSpanEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when trace has origin=evaluation (no longer hardcoded skip)", () => {
    it("dispatches normally — preconditions filter, not the reactor", async () => {
      // Per user direction post-2026-05-11 plan-mode debate: origin is a
      // user-configurable precondition, not a hardcoded reactor guard.
      // The depth signal (per-span) is the sole hard rule.
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "evaluation" },
      });

      await reactor.handle(createOriginEvent("evaluation"), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("loop prevention via per-span causality_depth", () => {
    /** @scenario Incoming span with causality_depth=1 does not trigger evaluations */
    it("blocks dispatch when inbound span has causality_depth=1", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({
        attributes: [
          { key: "langwatch.reserved.causality_depth", value: { intValue: 1 } },
        ],
      });

      await reactor.handle(event, createContext(state));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });

    /** @scenario Incoming span with causality_depth=0 still triggers evaluations */
    it("dispatches when inbound span has causality_depth=0", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({
        attributes: [
          { key: "langwatch.reserved.causality_depth", value: { intValue: 0 } },
        ],
      });

      await reactor.handle(event, createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });

    /** @scenario LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD bypasses depth check */
    it("env kill-switch bypasses the depth check", async () => {
      process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD = "1";
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({
        parentSpanId: "S1",
        attributes: [
          { key: "langwatch.reserved.causality_depth", value: { intValue: 5 } },
        ],
      });

      await reactor.handle(event, createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when trace has no origin", () => {
    it("returns early without dispatching evaluations", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({ attributes: {} });

      await reactor.handle(createOriginEvent(""), createContext(state));

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

      await reactor.handle(createOriginEvent(), createContext(state));

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

      await reactor.handle(createOriginEvent(), createContext(state));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when inbound event is a synthetic span (langwatch.track_event)", () => {
    it("does NOT invoke monitor service", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({ spanName: TRACK_EVENT_SPAN_NAME });

      await reactor.handle(event, createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
    });

    it("does NOT dispatch evaluation commands", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({ spanName: TRACK_EVENT_SPAN_NAME });

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
      const event = createSpanEvent({ spanName: "openai.chat" });

      await reactor.handle(event, createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when inbound event has no span data field", () => {
    it("dispatches evaluation commands (non-span events bypass span-only guards)", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await reactor.handle(createOriginEvent(), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });
});
