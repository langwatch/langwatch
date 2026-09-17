import { describe, expect, it, vi } from "vitest";
import type { MonitorSummary } from "~/server/app-layer/monitors/repositories/monitor.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { evaluatorLoopBlockedCounter } from "~/server/metrics";
import type { TriggerContext } from "../../../../pipeline/processManagerDefinition";
import { TraceAttributeAccumulationService } from "../../projections/services/trace-attribute-accumulation.service";
import { TraceOriginService } from "../../projections/services/trace-origin.service";
import type { TraceProcessingEvent } from "../../schemas/events";
import type { NormalizedSpan } from "../../schemas/spans";
import {
  createEvaluationTriggerSubscriber,
  type EvaluationTriggerSubscriberDeps,
} from "../evaluationTrigger.subscriber";
import {
  DEFERRED_CHECK_DELAY_MS,
  needsOriginResolution,
} from "../originGate.subscriber";

/**
 * Reads the prom-client counter so assertions stay delta-based and isolated
 * from whatever else in the suite has already incremented it.
 */
async function readBlockedCounter(reason: string): Promise<number> {
  const metric = await (evaluatorLoopBlockedCounter as any).get();
  for (const v of metric.values ?? []) {
    if (v.labels?.reason === reason) return v.value as number;
  }
  return 0;
}

function makeEvent(
  overrides: Partial<TraceProcessingEvent> = {},
): TraceProcessingEvent {
  return {
    id: "evt-1",
    type: "lw.obs.trace.span_received",
    version: 1,
    aggregateType: "trace",
    aggregateId: "trace-1",
    tenantId: "project-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    data: {
      span: {
        name: "openai.chat",
        spanId: "span-1",
        parentSpanId: null,
        attributes: [],
      },
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
    ...overrides,
  } as unknown as TraceProcessingEvent;
}

function makeContext(
  overrides: Partial<TriggerContext<TraceSummaryData>> = {},
  attributeOverrides: Record<string, string> = {
    "langwatch.origin": "application",
  },
): TriggerContext<TraceSummaryData> {
  return {
    tenantId: "project-1",
    aggregateId: "trace-1",
    state: {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "2025-12-18",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      models: [],
      totalCost: null,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      occurredAt: Date.now(),
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      attributes: attributeOverrides,
      labels: [],
    } as unknown as TraceSummaryData,
    ...overrides,
  };
}

function makeMonitor(overrides: Partial<MonitorSummary> = {}): MonitorSummary {
  return {
    id: "mon-1",
    checkType: "custom/basic",
    name: "Test Monitor",
    threadIdleTimeout: null,
    evaluator: null,
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<EvaluationTriggerSubscriberDeps> = {},
): EvaluationTriggerSubscriberDeps {
  return {
    monitors: {
      getEnabledOnMessageMonitors: vi.fn().mockResolvedValue([]),
    } as any,
    evaluation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("evaluationTrigger subscriber", () => {
  describe("when monitor is trace-level (no threadIdleTimeout)", () => {
    it("sends with dedup TTL outlasting deferred origin window", async () => {
      const monitor = makeMonitor({ threadIdleTimeout: null });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        monitor,
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      const event = makeEvent();
      const context = makeContext();

      await subscriber.spec.handler(event, context);

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(options).toBeDefined();
      expect(options!.deduplication).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(
        DEFERRED_CHECK_DELAY_MS + 60_000,
      );
      expect(options!.delay).toBeUndefined();
    });
  });

  describe("when monitor is thread-level with threadId present", () => {
    it("sends with dynamic delay and dedup based on threadIdleTimeout", async () => {
      const monitor = makeMonitor({ threadIdleTimeout: 300 });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        monitor,
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      const event = makeEvent();
      const context = makeContext(
        {},
        {
          "langwatch.origin": "application",
          "gen_ai.conversation.id": "thread-abc",
        },
      );

      await subscriber.spec.handler(event, context);

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(payload.threadId).toBe("thread-abc");
      expect(payload.threadIdleTimeout).toBe(300);
      expect(options).toBeDefined();
      expect(options!.delay).toBe(300_000);
      expect(options!.deduplication).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(300_000);
      // Verify makeId produces thread-scoped dedup key
      const dedupId = options!.deduplication!.makeId(payload);
      expect(dedupId).toContain("thread:thread-abc");
      expect(dedupId).toContain("mon-1");
    });
  });

  describe("when monitor has threadIdleTimeout but no threadId on trace", () => {
    it("falls back to trace-level dedup (6-min TTL, no delay override)", async () => {
      const monitor = makeMonitor({ threadIdleTimeout: 300 });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        monitor,
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      const event = makeEvent();
      const context = makeContext(); // no threadId in attributes

      await subscriber.spec.handler(event, context);

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(options).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(
        DEFERRED_CHECK_DELAY_MS + 60_000,
      );
      expect(options!.delay).toBeUndefined();
    });
  });

  describe("when monitor has threadIdleTimeout of 0", () => {
    it("falls back to trace-level dedup (6-min TTL, no delay override)", async () => {
      const monitor = makeMonitor({ threadIdleTimeout: 0 });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        monitor,
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      const event = makeEvent();
      const context = makeContext(
        {},
        {
          "langwatch.origin": "application",
          "gen_ai.conversation.id": "thread-abc",
        },
      );

      await subscriber.spec.handler(event, context);

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [_payload, options] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(options).toBeDefined();
      expect(options!.deduplication!.ttlMs).toBe(
        DEFERRED_CHECK_DELAY_MS + 60_000,
      );
      expect(options!.delay).toBeUndefined();
    });
  });

  describe("when monitor has a linked evaluator", () => {
    it("uses evaluator name instead of monitor name", async () => {
      const monitor = makeMonitor({
        name: "Monitor Name",
        evaluator: { name: "Evaluator Name" },
      });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        monitor,
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      await subscriber.spec.handler(makeEvent(), makeContext());

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [payload] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(payload.evaluatorName).toBe("Evaluator Name");
    });
  });

  describe("when monitor has no linked evaluator", () => {
    it("falls back to monitor name", async () => {
      const monitor = makeMonitor({
        name: "Legacy Monitor",
        evaluator: null,
      });
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        monitor,
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      await subscriber.spec.handler(makeEvent(), makeContext());

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      const [payload] = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(payload.evaluatorName).toBe("Legacy Monitor");
    });
  });

  describe("when an evaluator-origin trace dispatches via origin_resolved", () => {
    /**
     * A trace's origin is normally settled from its spans, non-root ones
     * included. When no span has carried an origin yet, the originGate
     * subscriber settles it later and emits origin_resolved. That event
     * carries no span payload, so the causality loop guard — which only
     * inspected the span — reported "no loop" and the trace was evaluated,
     * producing another evaluator trace. Guard the deferred path off the
     * accumulated trace state instead.
     *
     * How much real traffic takes this path is not established: it needs a
     * trace whose depth-bearing spans arrive before any origin-bearing span.
     * These tests define the path's behaviour, not its frequency.
     */
    /** @scenario "A trace already produced by the evaluator does not start another evaluation round" */
    it("does not dispatch evaluations", async () => {
      const monitor = makeMonitor();
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        monitor,
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      const event = makeEvent({
        id: "evt-origin-resolved",
        type: "lw.obs.trace.origin_resolved",
        data: { origin: "evaluation" },
      } as unknown as Partial<TraceProcessingEvent>);
      const context = makeContext(
        {},
        {
          "langwatch.origin": "evaluation",
          "langwatch.reserved.causality_depth": "1",
        },
      );

      const before = await readBlockedCounter("depth_fold");

      await subscriber.spec.handler(event, context);

      expect(deps.evaluation).not.toHaveBeenCalled();
      expect(await readBlockedCounter("depth_fold")).toBe(before + 1);
    });

    /** @scenario "An ordinary trace still starts its evaluations when its origin settles late" */
    it("still dispatches for an application-origin trace", async () => {
      const monitor = makeMonitor();
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        monitor,
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      const event = makeEvent({
        id: "evt-origin-resolved",
        type: "lw.obs.trace.origin_resolved",
        data: { origin: "application" },
      } as unknown as Partial<TraceProcessingEvent>);
      const context = makeContext();

      await subscriber.spec.handler(event, context);

      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A manual evaluation run marks the customer trace it ran against" */
    it("skips a customer trace that a manual evaluation run marked", async () => {
      const monitor = makeMonitor();
      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        monitor,
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      const event = makeEvent({
        id: "evt-origin-resolved",
        type: "lw.obs.trace.origin_resolved",
        data: { origin: "evaluation" },
      } as unknown as Partial<TraceProcessingEvent>);
      // A manual evaluation run against a customer trace whose origin has not
      // settled lands the evaluator's own spans on that trace. Those spans
      // carry BOTH an evaluation origin and a depth, so the trace resolves as
      // evaluator-produced on its own — this guard is not what relabels it.
      // A monitor filtering on an application origin already skips the trace;
      // the guard only changes the outcome for a monitor with no origin
      // filter. Pinned as an accepted tradeoff, not desired behaviour: see the
      // @known-limitation scenario for the reasoning and the way out.
      const context = makeContext(
        {},
        {
          "langwatch.origin": "evaluation",
          "langwatch.reserved.causality_depth": "1",
        },
      );

      await subscriber.spec.handler(event, context);

      expect(deps.evaluation).not.toHaveBeenCalled();
    });

    /**
     * The two tests above hand the subscriber an already-accumulated depth,
     * and the accumulation tests exercise the service on its own. Neither
     * would catch the depth being dropped BETWEEN them — which is the whole
     * mechanism this fix depends on. So run the real accumulation service on
     * a real evaluator span and feed its output straight into the real
     * subscriber, with nothing hand-written in between.
     */
    it("carries the depth from the span through accumulation into the guard", async () => {
      // The real TraceOriginService, not a stub: hoistOrigin is what decides
      // whether this trace ever reaches the deferred path, so stubbing it out
      // would remove the very code the assertion depends on.
      const accumulation = new TraceAttributeAccumulationService(
        new TraceOriginService(),
      );

      const accumulated = accumulation.accumulateAttributes({
        state: { attributes: {} } as unknown as TraceSummaryData,
        span: {
          spanAttributes: {
            "langwatch.origin": "evaluation",
            "langwatch.reserved.causality_depth": 1,
          },
          resourceAttributes: {},
        } as unknown as NormalizedSpan,
        outputSource: "span",
        inputIsFallback: false,
        outputIsFallback: false,
        inputMediaRefs: null,
        outputMediaRefs: null,
      });

      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        makeMonitor(),
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      const event = makeEvent({
        id: "evt-origin-resolved",
        type: "lw.obs.trace.origin_resolved",
        data: { origin: "evaluation" },
      } as unknown as Partial<TraceProcessingEvent>);

      await subscriber.spec.handler(event, makeContext({}, accumulated));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });

    /**
     * Pins that this path is reachable at all, which every other test here
     * assumes by handing the subscriber an origin_resolved event directly.
     *
     * nlpgo stamps the causality depth on EVERY span it emits, through a span
     * processor reading baggage on start (see the "Every span emitted during
     * an nlpgo evaluator run carries causality_depth via SpanProcessor"
     * scenario in services/nlpgo/tests/integration/causality_propagation_test.go).
     * It stamps langwatch.origin on strictly fewer: only the spans it builds
     * itself, the studio request span (adapters/httpapi/tracing.go:143-162)
     * and the workflow node spans (app/engine/tracing.go:92-115). A span
     * started by any other instrumentation inside that run — an HTTP client,
     * a model SDK — therefore carries a depth and no origin.
     *
     * A trace holding only such spans folds to a depth with no origin, so
     * needsOriginResolution stays true, no origin_resolved has fired yet, and
     * the span-level check cannot see across spans. This path is what covers
     * it.
     */
    it("guards a trace whose spans carry a depth but no origin", async () => {
      const accumulation = new TraceAttributeAccumulationService(
        new TraceOriginService(),
      );

      const accumulated = accumulation.accumulateAttributes({
        state: { attributes: {} } as unknown as TraceSummaryData,
        span: {
          spanAttributes: {
            // No langwatch.origin: the shape a non-nlpgo-built span has.
            "langwatch.reserved.causality_depth": 1,
          },
          resourceAttributes: {},
        } as unknown as NormalizedSpan,
        outputSource: "span",
        inputIsFallback: false,
        outputIsFallback: false,
        inputMediaRefs: null,
        outputMediaRefs: null,
      });

      // The trace reaches the deferred path precisely because no span settled
      // an origin for it.
      expect(accumulated["langwatch.origin"]).toBeUndefined();
      expect(
        needsOriginResolution({
          event: makeEvent({ occurredAt: Date.now() }),
          foldState: { attributes: accumulated } as unknown as TraceSummaryData,
        }),
      ).toBe(true);

      const deps = createDeps();
      vi.mocked(deps.monitors.getEnabledOnMessageMonitors).mockResolvedValue([
        makeMonitor(),
      ]);

      const subscriber = createEvaluationTriggerSubscriber(deps);
      const event = makeEvent({
        id: "evt-origin-resolved",
        type: "lw.obs.trace.origin_resolved",
        data: { origin: "evaluation" },
      } as unknown as Partial<TraceProcessingEvent>);

      await subscriber.spec.handler(event, makeContext({}, accumulated));

      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });
});
