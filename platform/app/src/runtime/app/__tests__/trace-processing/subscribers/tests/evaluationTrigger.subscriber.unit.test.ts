import type { TriggerContext } from "@langwatch/eventing";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { TRACK_EVENT_SPAN_NAME } from "@langwatch/trace-contract";
import { MAX_PROCESSED_SPANS } from "@langwatch/trace-server";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import {
  createEvaluationTriggerSubscriber,
  detectCausalityLoop,
  type EvaluationTriggerSubscriberDeps,
} from "~/runtime/app/trace-evaluation-trigger.adapter";
import { DEFERRED_ORIGIN_CHECK_DELAY_MS } from "@langwatch/trace-server";

function createFoldState(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
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

function createContext(state: TraceSummaryData): TriggerContext<TraceSummaryData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    state,
  };
}

function createDeps(
  overrides: Partial<EvaluationTriggerSubscriberDeps> = {},
): EvaluationTriggerSubscriberDeps {
  return {
    featureFlags: MemoryFeatureFlagService.create(),
    monitors: {
      getEnabledOnMessageMonitors: vi.fn().mockResolvedValue([
        {
          id: "mon-1",
          checkType: "llm/boolean",
          name: "Test Monitor",
          evaluator: null,
        },
      ]),
    } as unknown as EvaluationTriggerSubscriberDeps["monitors"],
    evaluation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("detectCausalityLoop (pure)", () => {
  /** @scenario Incoming span with causality_depth=1 does not trigger evaluations */
  it("returns 'depth_direct' when inbound span attr has reserved.causality_depth=1", () => {
    const reason = detectCausalityLoop({
      spanAttributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 1 } }],
    });
    expect(reason).toBe("depth_direct");
  });

  /** @scenario Incoming span with causality_depth=0 still triggers evaluations */
  it("returns null when inbound span attr has reserved.causality_depth=0", () => {
    const reason = detectCausalityLoop({
      spanAttributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 0 } }],
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
        {
          key: "langwatch.reserved.causality_depth",
          value: { stringValue: "2" },
        },
      ],
    });
    expect(reason).toBe("depth_direct");
  });

  it("ignores malformed depth values", () => {
    const reason = detectCausalityLoop({
      spanAttributes: [
        {
          key: "langwatch.reserved.causality_depth",
          value: { stringValue: "abc" },
        },
      ],
    });
    expect(reason).toBeNull();
  });
});

describe("evaluationTrigger subscriber", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    delete process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when trace has explicit application origin", () => {
    /** @scenario "Evaluation trigger runs on traces with explicit application origin" */
    it("dispatches evaluation commands", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await subscriber.spec.handler(createOriginEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the event is a derived enrichment (topic assignment)", () => {
    /** @scenario a topic assignment does not re-run evaluations */
    it("does not dispatch evaluations", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await subscriber.spec.handler(createTopicAssignedEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when the trace is older than the evaluation cutoff", () => {
    /** @scenario evaluations do not re-run for a trace older than the cutoff */
    it("does not dispatch even on a genuine new span", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        occurredAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      });

      await subscriber.spec.handler(createSpanEvent(), createContext(state));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });

    /** @scenario a new span on a recent trace re-runs evaluations */
    it("dispatches for a recent trace", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        occurredAt: Date.now(),
      });

      await subscriber.spec.handler(createSpanEvent(), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the trace exceeds the processing cap", () => {
    /** @scenario Evaluations run for a trace under the processing cap */
    it("dispatches evaluations for a trace just under the cap", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        spanCount: MAX_PROCESSED_SPANS - 1,
        occurredAt: Date.now(),
      });

      await subscriber.spec.handler(createSpanEvent(), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });

    /** @scenario Evaluations are skipped for a trace over the processing cap */
    it("skips evaluation dispatch once the trace passes the cap (span still stored elsewhere)", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        spanCount: MAX_PROCESSED_SPANS,
        occurredAt: Date.now(),
      });

      await subscriber.spec.handler(createSpanEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when trace has origin=evaluation (no longer hardcoded skip)", () => {
    /** @scenario "Evaluation trigger dispatches for any known origin (preconditions filter)" */
    it("dispatches normally — preconditions filter, not the subscriber", async () => {
      // Per user direction post-2026-05-11 plan-mode debate: origin is a
      // user-configurable precondition, not a hardcoded subscriber guard.
      // The depth signal (per-span) is the sole hard rule.
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "evaluation" },
      });

      await subscriber.spec.handler(createOriginEvent("evaluation"), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("loop prevention via per-span causality_depth", () => {
    /** @scenario Incoming span with causality_depth=1 does not trigger evaluations */
    it("blocks dispatch when inbound span has causality_depth=1", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({
        attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 1 } }],
      });

      await subscriber.spec.handler(event, createContext(state));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });

    /** @scenario Incoming span with causality_depth=0 still triggers evaluations */
    it("dispatches when inbound span has causality_depth=0", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({
        attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 0 } }],
      });

      await subscriber.spec.handler(event, createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });

    it("operator kill-switch bypasses the depth check", async () => {
      const deps = createDeps();
      await deps.featureFlags.setEnabled({
        key: "ops_es_causality_loop_guard_disabled",
        enabled: true,
        lastEditedBy: null,
      });
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({
        parentSpanId: "S1",
        attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 5 } }],
      });

      await subscriber.spec.handler(event, createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when trace has no origin", () => {
    /** @scenario "Evaluation trigger skips traces with empty origin and no SDK info" */
    it("returns early without dispatching evaluations", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({ attributes: {} });

      await subscriber.spec.handler(createOriginEvent(""), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when trace-level eval is dispatched", () => {
    it("uses 6-minute dedup TTL to outlast deferred origin window", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await subscriber.spec.handler(createOriginEvent(), createContext(state));

      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(options).toBeDefined();
      expect(options!.deduplication).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(DEFERRED_ORIGIN_CHECK_DELAY_MS + 60_000);
      expect(options!.delay).toBeUndefined();
    });

    it("marks the dedup as surviving dispatch so a re-trigger after dispatch is squashed (#3912)", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await subscriber.spec.handler(createOriginEvent(), createContext(state));

      // The subscriber can fire a second time after the command was already
      // dispatched (a late span, then the deferred OriginResolvedEvent). The
      // dedup key outlives dispatch (6-min TTL), so shouldSurviveDispatch must be set
      // for that second dispatch to be squashed instead of re-run as a duplicate.
      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(options!.deduplication!.shouldSurviveDispatch).toBe(true);
    });
  });

  describe("when thread-level eval is dispatched", () => {
    it("also marks the dedup as surviving dispatch (#3912)", async () => {
      const deps = createDeps({
        monitors: {
          getEnabledOnMessageMonitors: vi.fn().mockResolvedValue([
            {
              id: "mon-1",
              checkType: "llm/boolean",
              name: "Test Monitor",
              evaluator: null,
              threadIdleTimeout: 300,
            },
          ]),
        } as unknown as EvaluationTriggerSubscriberDeps["monitors"],
      });
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: {
          "langwatch.origin": "application",
          "gen_ai.conversation.id": "thread-1",
        },
      });

      await subscriber.spec.handler(createOriginEvent(), createContext(state));

      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      // delay == threadIdleTimeout * 1000 confirms the thread-level branch was taken.
      expect(options!.delay).toBe(300 * 1000);
      expect(options!.deduplication!.shouldSurviveDispatch).toBe(true);
    });
  });

  describe("when trace is blocked by guardrail with no output", () => {
    it("skips without dispatching", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
        blockedByGuardrail: true,
        computedOutput: null,
      });

      await subscriber.spec.handler(createOriginEvent(), createContext(state));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when inbound event is a synthetic span (langwatch.track_event)", () => {
    it("does NOT invoke monitor service", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({ spanName: TRACK_EVENT_SPAN_NAME });

      await subscriber.spec.handler(event, createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
    });

    it("does NOT dispatch evaluation commands", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({ spanName: TRACK_EVENT_SPAN_NAME });

      await subscriber.spec.handler(event, createContext(state));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });

  describe("when inbound event is a normal (non-synthetic) span", () => {
    it("dispatches evaluation commands", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      const event = createSpanEvent({ spanName: "openai.chat" });

      await subscriber.spec.handler(event, createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when inbound event has no span data field", () => {
    it("dispatches evaluation commands (non-span events bypass span-only guards)", async () => {
      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await subscriber.spec.handler(createOriginEvent(), createContext(state));

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * The guards below used to live inside `handle`, so every span of a 10k-span
 * trace was serialized, gzipped and blobbed into Redis before the queue's dedup
 * threw the job away. They are pure and read only the payload `handle` receives,
 * so `shouldDispatch` rejects them pre-enqueue instead (ADR-026). See
 * specs/trace-processing/hot-trace-fold-amplification.feature.
 */
describe("evaluationTrigger relevance check", () => {
  const withOrigin = (overrides: Partial<TraceSummaryData> = {}) =>
    createFoldState({
      attributes: { "langwatch.origin": "application" },
      ...overrides,
    });

  const shouldDispatch = ({
    event,
    state,
  }: {
    event: TraceProcessingEvent;
    state: TraceSummaryData;
  }): boolean => {
    const subscriber = createEvaluationTriggerSubscriber(createDeps());
    // The subscriber always declares one.
    return subscriber.spec.when!(event, createContext(state));
  };

  describe("given a trace with a resolved origin", () => {
    /** @scenario "The origin guard admits a genuine message event before enqueue" */
    it("agrees to react to a recent span event", () => {
      expect(shouldDispatch({ event: createSpanEvent(), state: withOrigin() })).toBe(true);
    });

    /** @scenario "The origin guard filters a non-message event before enqueue" */
    it("declines a topic-assigned event", () => {
      expect(
        shouldDispatch({
          event: createTopicAssignedEvent(),
          state: withOrigin(),
        }),
      ).toBe(false);
    });

    /** @scenario "The evaluation trigger declines a synthetic span before enqueue" */
    it("declines a synthetic span", () => {
      const synthetic = createSpanEvent({ spanName: TRACK_EVENT_SPAN_NAME });
      expect(shouldDispatch({ event: synthetic, state: withOrigin() })).toBe(false);
    });

    /** @scenario "The evaluation trigger dispatches nothing past the span processing cap" */
    it("dispatches no evaluation once the span count reaches the processing cap", async () => {
      // The cap guard deliberately lives in handle, not shouldDispatch: shouldDispatch
      // runs once per event of a coalesced batch and would multiply the
      // once-per-crossing warn by the batch size.
      const atCap = withOrigin({ spanCount: MAX_PROCESSED_SPANS });
      expect(shouldDispatch({ event: createSpanEvent(), state: atCap })).toBe(true);

      const deps = createDeps();
      const subscriber = createEvaluationTriggerSubscriber(deps);
      await subscriber.spec.handler(createSpanEvent(), createContext(atCap));
      expect(deps.evaluation).not.toHaveBeenCalled();

      // A coalesced batch can jump the span count clean past the cap without
      // ever landing on it, so the guard is `>=`, not `===`.
      const pastCap = withOrigin({ spanCount: MAX_PROCESSED_SPANS + 1 });
      const depsPast = createDeps();
      const subscriberPast = createEvaluationTriggerSubscriber(depsPast);
      await subscriberPast.spec.handler(createSpanEvent(), createContext(pastCap));
      expect(depsPast.evaluation).not.toHaveBeenCalled();

      const belowCap = withOrigin({ spanCount: MAX_PROCESSED_SPANS - 1 });
      const depsBelow = createDeps();
      const subscriberBelow = createEvaluationTriggerSubscriber(depsBelow);
      await subscriberBelow.spec.handler(createSpanEvent(), createContext(belowCap));
      expect(depsBelow.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a trace whose origin is unresolved", () => {
    /** @scenario "The origin guard filters a trace with no resolved origin before enqueue" */
    it("declines a span event", () => {
      expect(shouldDispatch({ event: createSpanEvent(), state: createFoldState() })).toBe(false);
    });
  });
});
