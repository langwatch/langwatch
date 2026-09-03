import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { QueueSendOptions, TriggerContext } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import {
  TOPIC_ASSIGNED_EVENT_TYPE,
  TRACK_EVENT_SPAN_NAME,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { TraceEvaluationDispatchPort } from "../../ports/trace-evaluation-dispatch.port";
import {
  TraceEvaluationLoopMetricsPort,
  type TraceEvaluationLoopBlockReason,
} from "../../ports/trace-evaluation-loop-metrics.port";
import { TraceEvaluationMonitorPort } from "../../ports/trace-evaluation-monitor.port";
import { MAX_PROCESSED_SPANS } from "../../projections/trace-summary.projection";
import {
  createEvaluationTriggerSubscriber,
  detectCausalityLoop,
} from "../evaluation-trigger.subscriber";

/**
 * Spec: packages/features/trace/specs/evaluation-trigger.feature
 *
 * The loop guard is the reason this file is careful. An evaluator's own spans
 * arrive on a trace of their own; if that trace triggers evaluation, the
 * evaluations evaluate evaluations, and the only thing that stops it is the
 * customer's bill. It fired for real on 2026-05-11. Every pin below is written
 * as a literal, because a guard that silently stops guarding looks exactly
 * like a quiet week.
 */

function foldState(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
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
    attributes: { "langwatch.origin": "app" },
    ...overrides,
  } as unknown as TraceSummaryData;
}

function spanEvent(
  options: {
    spanName?: string;
    attributes?: Array<{ key: string; value: unknown }>;
  } = {},
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
    data: {
      span: {
        name: options.spanName ?? "openai.chat",
        spanId: "span-1",
        parentSpanId: null,
        attributes: options.attributes ?? [],
      },
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
  } as unknown as TraceProcessingEvent;
}

function monitor(overrides: Partial<MonitorSummary> = {}): MonitorSummary {
  return {
    id: "check-1",
    checkType: "langevals/basic",
    name: "Monitor One",
    threadIdleTimeout: null,
    evaluator: null,
    ...overrides,
  };
}

class Dispatch extends TraceEvaluationDispatchPort {
  readonly sent: {
    data: ExecuteEvaluationCommandData;
    options?: QueueSendOptions<ExecuteEvaluationCommandData>;
  }[] = [];

  constructor(private readonly behaviour: { throwsFor?: string } = {}) {
    super();
  }

  makeDedupId(data: ExecuteEvaluationCommandData): string {
    return `exec:${data.tenantId}:${data.traceId}:${data.evaluatorId}`;
  }

  async send(
    data: ExecuteEvaluationCommandData,
    options?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ): Promise<void> {
    if (this.behaviour.throwsFor === data.evaluatorId) throw new Error("queue is down");
    this.sent.push({ data, options });
  }
}

class LoopMetrics extends TraceEvaluationLoopMetricsPort {
  readonly blocked: TraceEvaluationLoopBlockReason[] = [];

  loopBlocked(reason: TraceEvaluationLoopBlockReason): void {
    this.blocked.push(reason);
  }
}

function subscriber(options: {
  monitors?: MonitorSummary[];
  guardDisabled?: boolean;
  dispatch?: Dispatch;
}) {
  const dispatch = options.dispatch ?? new Dispatch();
  const metrics = new LoopMetrics();
  const isEnabled = vi.fn(async () => options.guardDisabled ?? false);
  const listMonitors = vi.fn(async (_projectId: string) => options.monitors ?? [monitor()]);
  class Monitors extends TraceEvaluationMonitorPort {
    getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
      return listMonitors(projectId) as Promise<MonitorSummary[]>;
    }
  }
  const built = createEvaluationTriggerSubscriber({
    featureFlags: { isEnabled } as unknown as FeatureFlagService,
    monitors: new Monitors(),
    evaluation: dispatch,
    metrics,
  });
  return { built, dispatch, metrics, isEnabled, listMonitors };
}

async function run(
  built: ReturnType<typeof createEvaluationTriggerSubscriber>,
  event: TraceProcessingEvent,
  state: TraceSummaryData,
): Promise<void> {
  const context: TriggerContext<TraceSummaryData> = {
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    state,
  };
  await built.spec.handler(event, context);
}

describe("createEvaluationTriggerSubscriber", () => {
  describe("given an evaluator's own span", () => {
    describe("when the causality depth says the span came from an evaluation", () => {
      /**
       * @scenario "A span emitted by an evaluator never triggers another evaluation"
       * @scenario "Incoming span with causality_depth=1 does not trigger evaluations"
       *
       * This is the money loop. An online evaluator's workflow emits spans;
       * those spans land on a trace; that trace would trigger the same
       * monitors, whose spans would trigger them again, forever.
       */
      it("blocks the dispatch and records the reason", async () => {
        const { built, dispatch, metrics } = subscriber({});

        await run(
          built,
          spanEvent({
            attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 1 } }],
          }),
          foldState(),
        );

        expect(dispatch.sent).toEqual([]);
        expect(metrics.blocked).toEqual(["depth_direct"]);
      });

      /** @scenario "A depth of zero is a fresh trace and still dispatches" */
      it("dispatches when the depth attribute is zero", async () => {
        const { built, dispatch, metrics } = subscriber({});

        await run(
          built,
          spanEvent({
            attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 0 } }],
          }),
          foldState(),
        );

        expect(dispatch.sent).toHaveLength(1);
        expect(metrics.blocked).toEqual([]);
      });
    });

    describe("when the operator has thrown the kill switch", () => {
      /**
       * @scenario "The loop guard has a system kill switch"
       *
       * The flag key is the one an operator types into the Ops UI, and its
       * uppercased form is the legacy environment override. A different
       * spelling is a switch that silently does nothing during an incident.
       */
      it("bypasses the guard for the system-scoped flag", async () => {
        const { built, dispatch, metrics, isEnabled } = subscriber({ guardDisabled: true });

        await run(
          built,
          spanEvent({
            attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 3 } }],
          }),
          foldState(),
        );

        expect(isEnabled).toHaveBeenCalledWith("ops_es_causality_loop_guard_disabled", {
          kind: "system",
        });
        expect(dispatch.sent).toHaveLength(1);
        expect(metrics.blocked).toEqual([]);
      });
    });
  });

  describe("given the depth attribute in each OTLP encoding", () => {
    describe("when the guard reads it", () => {
      /**
       * @scenario "The depth is read from any OTLP encoding"
       *
       * `AnyValue` is a union and the emitter picks the arm. A guard that only
       * understood `intValue` would let every string-encoded depth through,
       * which is the same as having no guard for that emitter.
       */
      it.each([
        ["intValue", { intValue: 2 }, "depth_direct"],
        ["stringValue", { stringValue: "1" }, "depth_direct"],
        ["doubleValue", { doubleValue: 4 }, "depth_direct"],
        ["a bare number", 7, "depth_direct"],
        ["a bare string", "3", "depth_direct"],
        ["zero", { intValue: 0 }, null],
        ["a negative depth", { intValue: -1 }, null],
        ["a non-numeric string", { stringValue: "deep" }, null],
      ])("reads %s", (_encoding, value, expected) => {
        expect(
          detectCausalityLoop({
            spanAttributes: [{ key: "langwatch.reserved.causality_depth", value }],
          }),
        ).toBe(expected);
      });

      /** @scenario "A span with no depth attribute is depth zero" */
      it.each([
        ["no attributes", []],
        ["a different attribute", [{ key: "gen_ai.request.model", value: { stringValue: "x" } }]],
        ["a null attribute list", null],
        ["an undefined attribute list", undefined],
      ])("treats %s as depth zero", (_shape, spanAttributes) => {
        expect(
          detectCausalityLoop({
            spanAttributes: spanAttributes as Array<{ key: string; value: unknown }> | null,
          }),
        ).toBeNull();
      });

      /**
       * @scenario "The depth attribute key is a wire format"
       *
       * nlpgo stamps this exact key on every span it starts, from one baggage
       * entry. A rename on either side removes the guard without removing a
       * line of guard code.
       */
      it("reads only langwatch.reserved.causality_depth", () => {
        expect(
          detectCausalityLoop({
            spanAttributes: [{ key: "langwatch.causality_depth", value: { intValue: 5 } }],
          }),
        ).toBeNull();
      });
    });
  });

  describe("given a runaway trace", () => {
    describe("when the span count has reached the fold's processing cap", () => {
      /** @scenario "A trace past the processing cap stops being evaluated" */
      it("skips the dispatch at the cap and keeps dispatching below it", async () => {
        const atCap = subscriber({});
        await run(atCap.built, spanEvent(), foldState({ spanCount: MAX_PROCESSED_SPANS }));
        expect(atCap.dispatch.sent).toEqual([]);

        const belowCap = subscriber({});
        await run(belowCap.built, spanEvent(), foldState({ spanCount: MAX_PROCESSED_SPANS - 1 }));
        expect(belowCap.dispatch.sent).toHaveLength(1);
      });

      /** @scenario "The processing cap is the fold's own cap" */
      it("uses 512, the same number the summary fold stops deriving at", () => {
        expect(MAX_PROCESSED_SPANS).toBe(512);
      });
    });
  });

  describe("given a synthetic feedback span", () => {
    describe("when the relevance guard runs", () => {
      /**
       * @scenario "A synthetic event span never re-triggers evaluation"
       *
       * A thumbs-up posted through /api/track_event adds a span to the trace
       * but no new message content. Re-running every monitor for it charges a
       * customer for evaluating their own feedback.
       */
      it("refuses the event before it is enqueued", () => {
        const { built } = subscriber({});
        const context: TriggerContext<TraceSummaryData> = {
          tenantId: "tenant-1",
          aggregateId: "trace-1",
          state: foldState(),
        };

        expect(built.spec.when?.(spanEvent({ spanName: TRACK_EVENT_SPAN_NAME }), context)).toBe(
          false,
        );
        expect(TRACK_EVENT_SPAN_NAME).toBe("langwatch.track_event");
        expect(built.spec.when?.(spanEvent(), context)).toBe(true);
      });
    });
  });

  describe("given a project with enabled on-message monitors", () => {
    describe("when a trace is dispatched", () => {
      /** @scenario "One evaluation command is sent per monitor" */
      it("sends a command per monitor with the monitor's own identity", async () => {
        const { built, dispatch } = subscriber({
          monitors: [
            monitor({ id: "check-1", name: "Monitor One" }),
            monitor({ id: "check-2", name: "Monitor Two", evaluator: { name: "Custom" } }),
          ],
        });

        await run(built, spanEvent(), foldState());

        expect(dispatch.sent.map((sent) => sent.data.evaluatorId)).toEqual(["check-1", "check-2"]);
        expect(dispatch.sent.map((sent) => sent.data.evaluatorName)).toEqual([
          "Monitor One",
          "Custom",
        ]);
        expect(dispatch.sent.every((sent) => sent.data.isGuardrail === false)).toBe(true);
      });

      /**
       * @scenario "Each evaluation gets its own identifier"
       *
       * The prefix is the application's `KSUID_RESOURCES.EVALUATION`, and it is
       * part of every evaluation id ever written.
       */
      it("mints an eval-prefixed id per command", async () => {
        const { built, dispatch } = subscriber({
          monitors: [monitor({ id: "check-1" }), monitor({ id: "check-2" })],
        });

        await run(built, spanEvent(), foldState());

        const ids = dispatch.sent.map((sent) => sent.data.evaluationId);
        expect(ids.every((id) => id.startsWith("eval_"))).toBe(true);
        expect(new Set(ids).size).toBe(2);
      });

      /**
       * @scenario "A trace-level dispatch is deduplicated for six minutes"
       *
       * The window outlasts the five-minute deferred origin resolution, so a
       * subscriber that fires twice — once for a late span, once for the
       * deferred origin event — sends one evaluation, not two.
       */
      it("uses a six-minute TTL that survives dispatch", async () => {
        const { built, dispatch } = subscriber({});

        await run(built, spanEvent(), foldState());

        expect(dispatch.sent[0]!.options).toEqual({
          deduplication: {
            makeId: expect.any(Function),
            ttlMs: 360_000,
            shouldSurviveDispatch: true,
          },
        });
      });

      /** @scenario "The dedup id comes from the evaluation command itself" */
      it("asks the dispatch port for the key rather than spelling one", async () => {
        const { built, dispatch } = subscriber({});

        await run(built, spanEvent(), foldState());

        const sent = dispatch.sent[0]!;
        expect(sent.options?.deduplication?.makeId(sent.data)).toBe(
          "exec:tenant-1:trace-1:check-1",
        );
      });

      /**
       * @scenario "A thread-level monitor waits for the thread to go idle"
       *
       * The delay and the dedup TTL are both the monitor's idle timeout in
       * milliseconds, so the evaluation runs once, after the conversation
       * stops.
       */
      it("delays by the idle timeout and dedups for the same window", async () => {
        const { built, dispatch } = subscriber({
          monitors: [monitor({ threadIdleTimeout: 90 })],
        });

        await run(
          built,
          spanEvent(),
          foldState({ attributes: { "langwatch.origin": "app", "gen_ai.conversation.id": "t-1" } }),
        );

        expect(dispatch.sent[0]!.options).toEqual({
          delay: 90_000,
          deduplication: {
            makeId: expect.any(Function),
            ttlMs: 90_000,
            shouldSurviveDispatch: true,
          },
        });
      });

      /**
       * @scenario "A thread-level monitor with no thread falls back to the trace window"
       *
       * Without a conversation id there is no thread to wait for, and a
       * delayed evaluation would simply never be grouped with anything.
       */
      it("uses the trace-level window when the trace has no thread id", async () => {
        const { built, dispatch } = subscriber({
          monitors: [monitor({ threadIdleTimeout: 90 })],
        });

        await run(built, spanEvent(), foldState());

        expect(dispatch.sent[0]!.options?.delay).toBeUndefined();
        expect(dispatch.sent[0]!.options?.deduplication?.ttlMs).toBe(360_000);
      });

      /** @scenario "The command carries the trace fields preconditions match on" */
      it("copies the fold state's metadata onto every command", async () => {
        const { built, dispatch } = subscriber({});

        await run(
          built,
          spanEvent(),
          foldState({
            containsErrorStatus: true,
            models: ["gpt-5-mini"],
            topicId: "topic-1",
            subTopicId: "subtopic-1",
            attributes: {
              "langwatch.origin": "app",
              "gen_ai.conversation.id": "thread-1",
              "langwatch.user_id": "user-1",
              "langwatch.customer_id": "customer-1",
              "langwatch.labels": '["a","b",3]',
              "langwatch.prompt_ids": "not json",
              "metadata.tier": "gold",
              "metadata.user_id": "reserved",
              "metadata.sdk_version": "reserved",
            },
          }),
        );

        expect(dispatch.sent[0]!.data).toMatchObject({
          tenantId: "tenant-1",
          traceId: "trace-1",
          threadId: "thread-1",
          userId: "user-1",
          customerId: "customer-1",
          labels: ["a", "b"],
          origin: "app",
          hasError: true,
          topicId: "topic-1",
          subTopicId: "subtopic-1",
          spanModels: ["gpt-5-mini"],
          customMetadata: { tier: "gold" },
          computedInput: "hello",
          computedOutput: "world",
        });
        expect(dispatch.sent[0]!.data.promptIds).toBeUndefined();
      });

      /**
       * @scenario "One monitor's failed send does not stop the others"
       *
       * Each command is independent; a queue error for one evaluator must not
       * silently cancel every evaluator after it in the list.
       */
      it("keeps dispatching after a send throws", async () => {
        const dispatch = new Dispatch({ throwsFor: "check-1" });
        const { built } = subscriber({
          dispatch,
          monitors: [monitor({ id: "check-1" }), monitor({ id: "check-2" })],
        });

        await run(built, spanEvent(), foldState());

        expect(dispatch.sent.map((sent) => sent.data.evaluatorId)).toEqual(["check-2"]);
      });
    });
  });

  describe("given a project with no enabled monitors", () => {
    describe("when a trace is dispatched", () => {
      /** @scenario "A project with no monitors sends nothing" */
      it("sends no command", async () => {
        const { built, dispatch } = subscriber({ monitors: [] });

        await run(built, spanEvent(), foldState());

        expect(dispatch.sent).toEqual([]);
      });
    });
  });

  describe("given the subscriber's registration", () => {
    describe("when the pipeline reads it", () => {
      /**
       * @scenario "The subscriber keeps its registered name"
       *
       * The name is the queue's lane and the dedup prefix, so renaming it
       * orphans every job already staged under the old one.
       */
      it("registers as evaluationTrigger on the trace summary fold", () => {
        const { built } = subscriber({});

        expect(built.name).toBe("evaluationTrigger");
        expect(built.spec.fold).toBe("traceSummary");
      });
    });
  });
});

function topicAssignedEvent(): TraceProcessingEvent {
  return {
    id: "event-topic",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: TOPIC_ASSIGNED_EVENT_TYPE,
    version: 1,
    data: {},
    metadata: {},
  } as unknown as TraceProcessingEvent;
}

describe("createEvaluationTriggerSubscriber — origin, cutoff and processing-cap dispatch", () => {
  describe("when trace has explicit application origin", () => {
    /** @scenario "Evaluation trigger runs on traces with explicit application origin" */
    it("dispatches evaluation commands", async () => {
      const { built, dispatch, listMonitors } = subscriber({});

      await run(
        built,
        spanEvent(),
        foldState({ attributes: { "langwatch.origin": "application" } }),
      );

      expect(listMonitors).toHaveBeenCalledWith("tenant-1");
      expect(dispatch.sent).toHaveLength(1);
    });
  });

  describe("when trace has origin=evaluation (no longer hardcoded skip)", () => {
    /** @scenario "Evaluation trigger dispatches for any known origin (preconditions filter)" */
    it("dispatches normally — preconditions filter, not the subscriber", async () => {
      // Per user direction post-2026-05-11 plan-mode debate: origin is a
      // user-configurable precondition, not a hardcoded subscriber guard.
      // The depth signal (per-span) is the sole hard rule.
      const { built, dispatch } = subscriber({});

      await run(
        built,
        spanEvent(),
        foldState({ attributes: { "langwatch.origin": "evaluation" } }),
      );

      expect(dispatch.sent).toHaveLength(1);
    });
  });

  describe("when trace has no origin", () => {
    /** @scenario "Evaluation trigger skips traces with empty origin and no SDK info" */
    it("returns early without dispatching evaluations", async () => {
      const { built, dispatch, listMonitors } = subscriber({});

      await run(built, spanEvent(), foldState({ attributes: {} }));

      expect(listMonitors).not.toHaveBeenCalled();
      expect(dispatch.sent).toEqual([]);
    });
  });

  describe("when the event is a derived enrichment (topic assignment)", () => {
    /** @scenario a topic assignment does not re-run evaluations */
    it("does not dispatch evaluations", async () => {
      const { built, dispatch, listMonitors } = subscriber({});

      await run(
        built,
        topicAssignedEvent(),
        foldState({ attributes: { "langwatch.origin": "application" } }),
      );

      expect(listMonitors).not.toHaveBeenCalled();
      expect(dispatch.sent).toEqual([]);
    });
  });

  describe("when the trace is older than the evaluation cutoff", () => {
    /** @scenario evaluations do not re-run for a trace older than the cutoff */
    it("does not dispatch even on a genuine new span", async () => {
      const { built, dispatch } = subscriber({});
      const state = foldState({
        attributes: { "langwatch.origin": "application" },
        occurredAt: Date.now() - 25 * 60 * 60 * 1000,
      });

      await run(built, spanEvent(), state);

      expect(dispatch.sent).toEqual([]);
    });

    /** @scenario a new span on a recent trace re-runs evaluations */
    it("dispatches for a recent trace", async () => {
      const { built, dispatch } = subscriber({});
      const state = foldState({
        attributes: { "langwatch.origin": "application" },
        occurredAt: Date.now(),
      });

      await run(built, spanEvent(), state);

      expect(dispatch.sent).toHaveLength(1);
    });
  });

  describe("when the trace exceeds the processing cap", () => {
    /** @scenario Evaluations run for a trace under the processing cap */
    it("dispatches evaluations for a trace just under the cap", async () => {
      const { built, dispatch } = subscriber({});
      const state = foldState({
        attributes: { "langwatch.origin": "application" },
        spanCount: MAX_PROCESSED_SPANS - 1,
        occurredAt: Date.now(),
      });

      await run(built, spanEvent(), state);

      expect(dispatch.sent).toHaveLength(1);
    });

    /** @scenario Evaluations are skipped for a trace over the processing cap */
    it("skips evaluation dispatch once the trace passes the cap (span still stored elsewhere)", async () => {
      const { built, dispatch, listMonitors } = subscriber({});
      const state = foldState({
        attributes: { "langwatch.origin": "application" },
        spanCount: MAX_PROCESSED_SPANS,
        occurredAt: Date.now(),
      });

      await run(built, spanEvent(), state);

      expect(listMonitors).not.toHaveBeenCalled();
      expect(dispatch.sent).toEqual([]);
    });
  });
});

describe("detectCausalityLoop (pure) — verbatim spec titles", () => {
  /** @scenario Incoming span with no causality_depth attribute is treated as depth 0 */
  it("returns null when no causality_depth attribute is present", () => {
    const reason = detectCausalityLoop({
      spanAttributes: [{ key: "service.name", value: { stringValue: "x" } }],
    });
    expect(reason).toBeNull();
  });
});

describe("createEvaluationTriggerSubscriber — causality depth (handler-level)", () => {
  describe("loop prevention via per-span causality_depth", () => {
    /** @scenario Incoming span with causality_depth=0 still triggers evaluations */
    it("dispatches when inbound span has causality_depth=0", async () => {
      const { built, dispatch } = subscriber({});
      const state = foldState({ attributes: { "langwatch.origin": "application" } });
      const event = spanEvent({
        attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 0 } }],
      });

      await run(built, event, state);

      expect(dispatch.sent).toHaveLength(1);
    });

    /** @scenario LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD bypasses depth check */
    it("bypasses the depth check when the kill-switch flag is enabled", async () => {
      const { built, dispatch } = subscriber({ guardDisabled: true });
      const state = foldState({ attributes: { "langwatch.origin": "application" } });
      const event = spanEvent({
        attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: 5 } }],
      });

      await run(built, event, state);

      expect(dispatch.sent).toHaveLength(1);
    });
  });
});

/**
 * The guards below used to live inside `handle`, so every span of a 10k-span
 * trace was serialized, gzipped and blobbed into Redis before the queue's dedup
 * threw the job away. They are pure and read only the payload `handle` receives,
 * so `shouldDispatch` rejects them pre-enqueue instead (ADR-026).
 */
describe("evaluationTrigger relevance check", () => {
  const withOrigin = (overrides: Partial<TraceSummaryData> = {}) =>
    foldState({ attributes: { "langwatch.origin": "application" }, ...overrides });

  const shouldDispatch = ({
    event,
    state,
  }: {
    event: TraceProcessingEvent;
    state: TraceSummaryData;
  }): boolean => {
    const { built } = subscriber({});
    const context: TriggerContext<TraceSummaryData> = {
      tenantId: "tenant-1",
      aggregateId: "trace-1",
      state,
    };
    // The subscriber always declares one.
    return built.spec.when!(event, context);
  };

  describe("given a trace with a resolved origin", () => {
    /** @scenario "The origin guard admits a genuine message event before enqueue" */
    it("agrees to react to a recent span event", () => {
      expect(shouldDispatch({ event: spanEvent(), state: withOrigin() })).toBe(true);
    });

    /** @scenario "The origin guard filters a non-message event before enqueue" */
    it("declines a topic-assigned event", () => {
      expect(shouldDispatch({ event: topicAssignedEvent(), state: withOrigin() })).toBe(false);
    });

    /** @scenario "The evaluation trigger declines a synthetic span before enqueue" */
    it("declines a synthetic span", () => {
      const synthetic = spanEvent({ spanName: TRACK_EVENT_SPAN_NAME });
      expect(shouldDispatch({ event: synthetic, state: withOrigin() })).toBe(false);
    });

    /** @scenario "The evaluation trigger dispatches nothing past the span processing cap" */
    it("dispatches no evaluation once the span count reaches the processing cap", async () => {
      // The cap guard deliberately lives in the handler, not the pre-enqueue
      // guard: the pre-enqueue guard runs once per event of a coalesced
      // batch and would multiply the once-per-crossing warn by the batch size.
      const atCap = withOrigin({ spanCount: MAX_PROCESSED_SPANS });
      expect(shouldDispatch({ event: spanEvent(), state: atCap })).toBe(true);

      const { built, dispatch } = subscriber({});
      await run(built, spanEvent(), atCap);
      expect(dispatch.sent).toEqual([]);

      // A coalesced batch can jump the span count clean past the cap without
      // ever landing on it, so the guard is `>=`, not `===`.
      const pastCap = withOrigin({ spanCount: MAX_PROCESSED_SPANS + 1 });
      const { built: builtPast, dispatch: dispatchPast } = subscriber({});
      await run(builtPast, spanEvent(), pastCap);
      expect(dispatchPast.sent).toEqual([]);

      const belowCap = withOrigin({ spanCount: MAX_PROCESSED_SPANS - 1 });
      const { built: builtBelow, dispatch: dispatchBelow } = subscriber({});
      await run(builtBelow, spanEvent(), belowCap);
      expect(dispatchBelow.sent).toHaveLength(1);
    });
  });

  describe("given a trace whose origin is unresolved", () => {
    /** @scenario "The origin guard filters a trace with no resolved origin before enqueue" */
    it("declines a span event", () => {
      expect(shouldDispatch({ event: spanEvent(), state: foldState({ attributes: {} }) })).toBe(
        false,
      );
    });
  });
});
