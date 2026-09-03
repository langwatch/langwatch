import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { QueueSendOptions, TriggerContext } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import {
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
