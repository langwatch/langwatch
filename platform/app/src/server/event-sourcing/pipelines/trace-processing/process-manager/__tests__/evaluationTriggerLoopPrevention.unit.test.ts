/**
 * Online-evaluator infinite-loop prevention, driven through the whole
 * `evaluationTrigger` process manager.
 *
 * See `specs/monitors/online-evaluator-loop-prevention.feature` and the
 * 2026-05-11 incident it records: a monitor configured to run on every trace
 * evaluated the traces its own evaluator emitted, and produced ~500K
 * event-sourcing groups in ninety minutes.
 *
 * The guard used to be one function inside a reactor, so a test could call it
 * directly. Under the process manager it is spread across four real seams, and
 * a test that exercised any one of them alone would prove nothing:
 *
 *   1. `buildProcessEventView` reads the depth off the raw OTLP span.
 *   2. `handleTraceActivity` folds it into the instance's span census.
 *   3. `evaluationTriggerWake` raises the request when the trace goes quiet.
 *   4. `createEvaluationTriggerRequestHandler` reads the kill switch, records
 *      the metric, and decides.
 *
 * So every test here drives all four, against the real feature-flag resolver
 * and the real Prometheus counter — a span goes in as the pipeline would
 * deliver it, and what comes out is whether an `executeEvaluation` was asked
 * for.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import type { MonitorSummary } from "~/server/app-layer/monitors/repositories/monitor.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type {
  IntentContext,
  ProcessHandlerContext,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { evaluatorLoopBlockedCounter } from "~/server/metrics";

import type { ExecuteEvaluationCommandData } from "../../../evaluation-processing/schemas/commands";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  buildProcessEventView,
  evaluationTriggerWake,
  handleTraceActivity,
} from "../evaluationTrigger.process";
import { createEvaluationTriggerRequestHandler } from "../evaluationTriggerIntentHandlers";
import {
  CAUSALITY_DEPTH_ATTRIBUTE,
  type EvaluationTriggerRequestIntent,
  type EvaluationTriggerState,
  INITIAL_EVALUATION_TRIGGER_STATE,
} from "../evaluationTriggerProcess.types";

const TRACE_ID = "trace-loop-1";
const PROJECT_ID = "project-1";
const NOW = 1_700_000_000_000;

/** The metric label the spec pins for a depth-guard block. */
const DEPTH_DIRECT = "depth_direct";

/**
 * The kill switch, both spellings. `ops_es_causality_loop_guard_disabled` is
 * the registered flag; `LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD` is the legacy
 * variable the registry still honours, and the one the spec names.
 */
const PRIMARY_ENV_VAR = "OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED";
const LEGACY_ENV_VAR = "LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD";

function monitor(overrides: Partial<MonitorSummary> = {}): MonitorSummary {
  return {
    id: "monitor-1",
    checkType: "langevals/basic",
    name: "Runs on every message",
    // "No preconditions": an on-message monitor the project enabled with
    // nothing to filter it, which is the configuration the incident ran.
    threadIdleTimeout: null,
    evaluator: null,
    ...overrides,
  };
}

function traceSummary(): TraceSummaryData {
  return {
    traceId: TRACE_ID,
    traceName: "",
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "hello",
    computedOutput: "world",
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    attributes: { "langwatch.origin": "application" },
  } as unknown as TraceSummaryData;
}

/**
 * A span as `recordSpan` commits it: raw OTLP, attributes as a `KeyValue[]`.
 * Building the event rather than the process's view is what puts the real
 * content boundary under test — the depth has to survive being read off the
 * wire before anything can act on it.
 */
function spanEvent(opts: { depth?: unknown } = {}): TraceProcessingEvent {
  const attributes =
    opts.depth === undefined
      ? []
      : [{ key: CAUSALITY_DEPTH_ATTRIBUTE, value: opts.depth }];

  return {
    id: `event-${Math.random()}`,
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    tenantId: PROJECT_ID,
    createdAt: NOW,
    occurredAt: NOW,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {
      span: {
        traceId: TRACE_ID,
        spanId: "span-1",
        parentSpanId: null,
        name: "openai.chat",
        attributes,
      },
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: TRACE_ID },
  } as unknown as TraceProcessingEvent;
}

type RaisedIntent = {
  messageKey: string;
  payload: EvaluationTriggerRequestIntent;
};

function handlerContext(): ProcessHandlerContext<never> {
  return {
    at: NOW,
    now: NOW,
    key: TRACE_ID,
    projectId: PROJECT_ID,
    intents: {
      requestEvaluations: (messageKey: string, payload: unknown) => ({
        messageKey,
        intentType: "requestEvaluations",
        payload,
      }),
    },
  } as unknown as ProcessHandlerContext<never>;
}

function intentContext(messageKey: string): IntentContext {
  return {
    processName: "evaluationTrigger",
    projectId: PROJECT_ID,
    processKey: TRACE_ID,
    tenantId: PROJECT_ID,
    messageKey,
    attempt: 1,
  };
}

/**
 * One trace, driven the way the runtime drives it: spans land, the trace goes
 * quiet, the wake worker fires, and the outbox executes whatever intent came
 * out. Nothing here is a stand-in for the guard — the only fakes are the
 * monitor lookup, the trace read-back and the evaluation queue.
 */
function traceUnderTest({
  monitors = [monitor()],
}: {
  monitors?: MonitorSummary[];
} = {}) {
  let state: EvaluationTriggerState = INITIAL_EVALUATION_TRIGGER_STATE;
  let armedAt: number | null = null;
  let clock = NOW;

  const dispatched: ExecuteEvaluationCommandData[] = [];
  const evaluation = vi.fn(async (data: ExecuteEvaluationCommandData) => {
    dispatched.push(data);
  });

  const execute = createEvaluationTriggerRequestHandler({
    monitors: {
      getEnabledOnMessageMonitors: vi.fn(async () => monitors),
    } as unknown as MonitorService,
    readTraceSummary: vi.fn(async () => traceSummary()),
    evaluation,
  });

  function ctx(): ProcessHandlerContext<never> {
    return { ...handlerContext(), at: clock, now: clock };
  }

  return {
    dispatched,

    /** A span lands on the trace. */
    receives(span: TraceProcessingEvent): void {
      const evolution = handleTraceActivity(
        state,
        buildProcessEventView(span),
        ctx(),
      );
      state = evolution.state;
      armedAt = evolution.nextWakeAt;
    },

    /** Time passes without another span, and the wake worker finds the row. */
    async goesQuiet(): Promise<void> {
      if (armedAt === null) return;
      clock = armedAt;

      const woken = evaluationTriggerWake(state, ctx());
      state = woken.state;
      armedAt = woken.nextWakeAt;

      for (const raised of (woken.intents ?? []) as unknown as RaisedIntent[]) {
        await execute(raised.payload, intentContext(raised.messageKey));
      }
    },

    /** More application activity, later on the same trace. */
    advance(ms: number): void {
      clock += ms;
    },
  };
}

/** The counter is process-wide, so every assertion here is a delta. */
async function loopBlockedFor(reason: string): Promise<number> {
  const metric = await evaluatorLoopBlockedCounter.get();
  return (
    metric.values.find((value) => value.labels.reason === reason)?.value ?? 0
  );
}

describe("evaluationTrigger causality-loop guard", () => {
  let savedPrimary: string | undefined;
  let savedLegacy: string | undefined;

  beforeEach(() => {
    savedPrimary = process.env[PRIMARY_ENV_VAR];
    savedLegacy = process.env[LEGACY_ENV_VAR];
    delete process.env[PRIMARY_ENV_VAR];
    delete process.env[LEGACY_ENV_VAR];
  });

  afterEach(() => {
    restoreEnv(PRIMARY_ENV_VAR, savedPrimary);
    restoreEnv(LEGACY_ENV_VAR, savedLegacy);
  });

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  describe("given a project whose enabled on-message monitor has no preconditions", () => {
    describe("when every span the trace received came out of an evaluator", () => {
      /** @scenario Incoming span with causality_depth=1 does not trigger evaluations */
      it("asks for no evaluation", async () => {
        const trace = traceUnderTest();

        trace.receives(spanEvent({ depth: { intValue: 1 } }));
        await trace.goesQuiet();

        expect(trace.dispatched).toHaveLength(0);
      });

      it("counts the loop it blocked under reason depth_direct", async () => {
        const before = await loopBlockedFor(DEPTH_DIRECT);
        const trace = traceUnderTest();

        trace.receives(spanEvent({ depth: { intValue: 1 } }));
        await trace.goesQuiet();

        // A healthy fleet sees this counter at ~zero, so it is the signal the
        // incident is recurring rather than decoration.
        expect(await loopBlockedFor(DEPTH_DIRECT)).toBe(before + 1);
      });

      it("blocks a span further down the evaluator's own call chain too", async () => {
        const trace = traceUnderTest();

        // Depth increments at every evaluator-workflow boundary, so an
        // evaluator that itself triggers one emits at depth two and beyond.
        trace.receives(spanEvent({ depth: { intValue: 3 } }));
        await trace.goesQuiet();

        expect(trace.dispatched).toHaveLength(0);
      });

      it("blocks it whichever way the SDK encoded the depth", async () => {
        for (const depth of [
          { intValue: "1" },
          { stringValue: "1" },
          { doubleValue: 1 },
        ]) {
          const trace = traceUnderTest();

          trace.receives(spanEvent({ depth }));
          await trace.goesQuiet();

          expect(trace.dispatched).toHaveLength(0);
        }
      });
    });

    describe("when the span is application execution at causality depth zero", () => {
      /** @scenario Incoming span with causality_depth=0 still triggers evaluations */
      it("asks for one evaluation per monitor", async () => {
        const trace = traceUnderTest({
          monitors: [monitor(), monitor({ id: "monitor-2" })],
        });

        trace.receives(spanEvent({ depth: { intValue: 0 } }));
        await trace.goesQuiet();

        expect(trace.dispatched.map((data) => data.evaluatorId)).toEqual([
          "monitor-1",
          "monitor-2",
        ]);
      });

      it("counts no loop", async () => {
        const before = await loopBlockedFor(DEPTH_DIRECT);
        const trace = traceUnderTest();

        trace.receives(spanEvent({ depth: { intValue: 0 } }));
        await trace.goesQuiet();

        expect(await loopBlockedFor(DEPTH_DIRECT)).toBe(before);
      });
    });

    describe("when the span carries no causality depth at all", () => {
      /** @scenario Incoming span with no causality_depth attribute is treated as depth 0 */
      it("asks for one evaluation per monitor", async () => {
        const trace = traceUnderTest({
          monitors: [monitor(), monitor({ id: "monitor-2" })],
        });

        // Every SDK that predates the baggage processor sends this shape, so
        // reading an absent attribute as anything but depth zero would stop
        // the whole fleet's monitors.
        trace.receives(spanEvent());
        await trace.goesQuiet();

        expect(trace.dispatched.map((data) => data.evaluatorId)).toEqual([
          "monitor-1",
          "monitor-2",
        ]);
      });
    });

    describe("when the depth attribute cannot be read as a number", () => {
      it("treats the span as ordinary application activity", async () => {
        const trace = traceUnderTest();

        // The boundary is total in the fail-open direction: a misread costs
        // one request the handler declines, the opposite misread costs a
        // customer their evaluation, silently.
        trace.receives(spanEvent({ depth: { stringValue: "abc" } }));
        await trace.goesQuiet();

        expect(trace.dispatched).toHaveLength(1);
      });
    });
  });

  describe("given fresh application activity follows the evaluator's own spans", () => {
    /** @scenario Causality guard is per-span — fresh app activity still re-triggers */
    it("asks for the trace's evaluations again", async () => {
      const trace = traceUnderTest();

      trace.receives(spanEvent({ depth: { intValue: 0 } }));
      await trace.goesQuiet();
      const afterFirst = trace.dispatched.length;
      expect(afterFirst).toBe(1);

      trace.advance(60_000);
      trace.receives(spanEvent({ depth: { intValue: 1 } }));
      await trace.goesQuiet();

      trace.advance(60_000);
      trace.receives(spanEvent({ depth: { intValue: 0 } }));
      await trace.goesQuiet();

      // The guard must not pin a trace forever. Legitimate new activity on an
      // already-evaluated trace is a genuine re-run, and gets its own
      // evaluation rather than collapsing onto the first.
      const latest = trace.dispatched.at(-1);
      expect(trace.dispatched.length).toBeGreaterThan(afterFirst);
      expect(latest?.evaluationId).not.toBe(trace.dispatched[0]?.evaluationId);
    });
  });

  describe("given the evaluator's own spans land on a trace already evaluated", () => {
    /** @scenario Incoming span with causality_depth=1 does not trigger evaluations */
    it("withholds the request for the evaluator's own span even though the trace had real ones", async () => {
      const trace = traceUnderTest();

      trace.receives(spanEvent({ depth: { intValue: 0 } }));
      await trace.goesQuiet();

      trace.advance(60_000);
      trace.receives(spanEvent({ depth: { intValue: 1 } }));
      await trace.goesQuiet();

      // The guarantee the reactor had structurally, and the reason it matters
      // here: this feature's own traceparent propagation makes nlpgo's
      // evaluator spans children of the trace being evaluated. A guard that
      // reads the trace's WHOLE span census answers "not a loop" for every one
      // of them, so an evaluation slower than the command queue's dedup TTL
      // re-arms the quiet period and asks again under a fresh generation —
      // a new evaluationId, a new charge, and a loop the dedup key cannot
      // collapse, bounded only by the 24h trace-age cutoff.
      expect(trace.dispatched).toHaveLength(1);
    });

    it("counts that block, so a recurrence is visible to the fleet", async () => {
      const before = await loopBlockedFor(DEPTH_DIRECT);
      const trace = traceUnderTest();

      trace.receives(spanEvent({ depth: { intValue: 0 } }));
      await trace.goesQuiet();

      trace.advance(60_000);
      trace.receives(spanEvent({ depth: { intValue: 1 } }));
      await trace.goesQuiet();

      expect(await loopBlockedFor(DEPTH_DIRECT)).toBe(before + 1);
    });

    it("keeps withholding it however long the evaluator keeps emitting", async () => {
      const trace = traceUnderTest();

      trace.receives(spanEvent({ depth: { intValue: 0 } }));
      await trace.goesQuiet();

      // The self-sustaining shape: each evaluation's spans arrive after the
      // last dedup key expired, so nothing downstream collapses them.
      for (let round = 0; round < 5; round++) {
        trace.advance(10 * 60_000);
        trace.receives(spanEvent({ depth: { intValue: 1 } }));
        await trace.goesQuiet();
      }

      expect(trace.dispatched).toHaveLength(1);
    });
  });

  describe("given the causality loop guard has been switched off", () => {
    /** @scenario LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD bypasses depth check */
    it("asks for the evaluation of an evaluator-emitted trace anyway", async () => {
      process.env[LEGACY_ENV_VAR] = "1";
      const trace = traceUnderTest();

      trace.receives(spanEvent({ depth: { intValue: 5 } }));
      await trace.goesQuiet();

      // The flag is read through the real registry, so this also pins the
      // legacy variable name as the emergency rollback an operator can reach
      // for without a redeploy.
      expect(trace.dispatched).toHaveLength(1);
    });

    it("counts no block while it is off", async () => {
      process.env[LEGACY_ENV_VAR] = "1";
      const before = await loopBlockedFor(DEPTH_DIRECT);
      const trace = traceUnderTest();

      trace.receives(spanEvent({ depth: { intValue: 1 } }));
      await trace.goesQuiet();

      // A bypassed guard blocked nothing, so counting one would make the
      // fleet-health signal read as if the incident were recurring.
      expect(await loopBlockedFor(DEPTH_DIRECT)).toBe(before);
    });

    it("leaves the guard armed when the switch is off", async () => {
      process.env[LEGACY_ENV_VAR] = "0";
      const trace = traceUnderTest();

      trace.receives(spanEvent({ depth: { intValue: 1 } }));
      await trace.goesQuiet();

      expect(trace.dispatched).toHaveLength(0);
    });
  });
});
