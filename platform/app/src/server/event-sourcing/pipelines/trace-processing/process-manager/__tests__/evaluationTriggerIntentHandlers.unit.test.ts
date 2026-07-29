import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import type { MonitorSummary } from "~/server/app-layer/monitors/repositories/monitor.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { evaluatorLoopBlockedCounter } from "~/server/metrics";

import type { ExecuteEvaluationCommandData } from "../../../evaluation-processing/schemas/commands";
import { MAX_PROCESSED_SPANS } from "../../projections/traceSummary.foldProjection";
import {
  createEvaluationTriggerRequestHandler,
  type EvaluationTriggerDispatchDeps,
} from "../evaluationTriggerIntentHandlers";
import {
  EVALUATION_REQUEST_DEDUP_TTL_MS,
  type EvaluationTriggerRequestIntent,
} from "../evaluationTriggerProcess.types";

const TRACE_ID = "trace-1";
const PROJECT_ID = "project-1";
const NOW = 1_700_000_000_000;

const CTX: IntentContext = {
  processName: "evaluationTrigger",
  projectId: PROJECT_ID,
  processKey: TRACE_ID,
  tenantId: PROJECT_ID,
  messageKey: `process:${TRACE_ID}:evaluate:${TRACE_ID}:0`,
  attempt: 1,
};

function intent(
  overrides: Partial<EvaluationTriggerRequestIntent> = {},
): EvaluationTriggerRequestIntent {
  return {
    tenantId: PROJECT_ID,
    traceId: TRACE_ID,
    occurredAt: NOW,
    requestGeneration: 0,
    pendingEligibleSpanCount: 1,
    evaluatorEmittedSpanCount: 0,
    ...overrides,
  };
}

function monitor(overrides: Partial<MonitorSummary> = {}): MonitorSummary {
  return {
    id: "monitor-1",
    checkType: "langevals/basic",
    name: "Basic check",
    threadIdleTimeout: null,
    evaluator: null,
    ...overrides,
  };
}

function traceSummary(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: TRACE_ID,
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
    attributes: { "langwatch.origin": "application" },
    ...overrides,
  } as unknown as TraceSummaryData;
}

function makeDeps(
  overrides: {
    monitors?: MonitorSummary[];
    summary?: TraceSummaryData | null;
    evaluation?: EvaluationTriggerDispatchDeps["evaluation"];
  } = {},
) {
  const evaluation = vi.fn(overrides.evaluation ?? (async () => undefined));
  // `in` rather than `??`: an explicit null is "the trace could not be read",
  // which is the case the retry contract turns on.
  const summary = "summary" in overrides ? overrides.summary : traceSummary();
  const readTraceSummary = vi.fn(async () => summary ?? null);
  const getEnabledOnMessageMonitors = vi.fn(
    async () => overrides.monitors ?? [monitor()],
  );

  return {
    deps: {
      monitors: { getEnabledOnMessageMonitors } as unknown as MonitorService,
      readTraceSummary,
      evaluation,
    } satisfies EvaluationTriggerDispatchDeps,
    evaluation,
    readTraceSummary,
    getEnabledOnMessageMonitors,
  };
}

async function loopBlockedTotal(): Promise<number> {
  const metric = await evaluatorLoopBlockedCounter.get();
  return metric.values.reduce((sum, value) => sum + value.value, 0);
}

describe("evaluationTrigger requestEvaluations intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a trace the project's monitors should evaluate", () => {
    it("asks for one evaluation per monitor", async () => {
      const { deps, evaluation } = makeDeps({
        monitors: [monitor(), monitor({ id: "monitor-2" })],
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      expect(evaluation).toHaveBeenCalledTimes(2);
    });

    it("carries the trace's own metadata on the command", async () => {
      const { deps, evaluation } = makeDeps({
        summary: traceSummary({
          attributes: {
            "langwatch.origin": "application",
            "gen_ai.conversation.id": "thread-9",
            "langwatch.user_id": "user-3",
            "langwatch.labels": '["prod","beta"]',
            "metadata.tier": "gold",
          },
          topicId: "topic-1",
          models: ["gpt-5-mini"],
          containsErrorStatus: true,
        }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      const [data] = evaluation.mock.calls[0] as [ExecuteEvaluationCommandData];
      expect(data).toMatchObject({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
        threadId: "thread-9",
        userId: "user-3",
        labels: ["prod", "beta"],
        origin: "application",
        hasError: true,
        topicId: "topic-1",
        spanModels: ["gpt-5-mini"],
        customMetadata: { tier: "gold" },
        computedInput: "hello",
        computedOutput: "world",
      });
    });

    it("stamps the instant the trace last spoke", async () => {
      const { deps, evaluation } = makeDeps();

      await createEvaluationTriggerRequestHandler(deps)(
        intent({ occurredAt: NOW - 4_000 }),
        CTX,
      );

      const [data] = evaluation.mock.calls[0] as [ExecuteEvaluationCommandData];
      expect(data.occurredAt).toBe(NOW - 4_000);
    });

    it("reads the trace back at dispatch time rather than trusting the ask", async () => {
      const { deps, readTraceSummary } = makeDeps();

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      // Everything the command carries is the trace as it stands now, not a
      // snapshot taken when its first span landed.
      expect(readTraceSummary).toHaveBeenCalledWith({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
        occurredAtMs: NOW,
      });
    });
  });

  describe("given a monitor that waits for a conversation to go idle", () => {
    it("keys its evaluation on the thread so sibling traces collapse", async () => {
      const { deps, evaluation } = makeDeps({
        monitors: [monitor({ threadIdleTimeout: 120 })],
        summary: traceSummary({
          attributes: {
            "langwatch.origin": "application",
            "gen_ai.conversation.id": "thread-9",
          },
        }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      const [, options] = evaluation.mock.calls[0] as [
        ExecuteEvaluationCommandData,
        { delay?: number; deduplication?: { ttlMs?: number } },
      ];
      expect(options.delay).toBe(120_000);
      expect(options.deduplication?.ttlMs).toBe(120_000);
    });

    it("collapses sibling traces of one conversation onto a single dedup key", async () => {
      const { deps, evaluation } = makeDeps({
        monitors: [monitor({ threadIdleTimeout: 120 })],
        summary: traceSummary({
          attributes: {
            "langwatch.origin": "application",
            "gen_ai.conversation.id": "thread-9",
          },
        }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      const [data, options] = evaluation.mock.calls[0] as [
        ExecuteEvaluationCommandData,
        {
          deduplication?: {
            makeId?: (d: ExecuteEvaluationCommandData) => string;
          };
        },
      ];
      // The one thing the trace-keyed process cannot express itself: its
      // process key is the trace's aggregate id, so the conversation-level
      // collapse has to happen on the queue's key instead.
      const dedupId = options.deduplication?.makeId?.(data);
      expect(dedupId).toContain("thread:thread-9");
      expect(dedupId).not.toContain(TRACE_ID);
    });

    it("waits for nothing when the trace is not part of a conversation", async () => {
      const { deps, evaluation } = makeDeps({
        monitors: [monitor({ threadIdleTimeout: 120 })],
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      const [, options] = evaluation.mock.calls[0] as [
        ExecuteEvaluationCommandData,
        { delay?: number; deduplication?: { ttlMs?: number } },
      ];
      expect(options.delay).toBeUndefined();
      expect(options.deduplication?.ttlMs).toBe(
        EVALUATION_REQUEST_DEDUP_TTL_MS,
      );
    });

    it("waits for nothing when the idle timeout is zero", async () => {
      const { deps, evaluation } = makeDeps({
        monitors: [monitor({ threadIdleTimeout: 0 })],
        summary: traceSummary({
          attributes: {
            "langwatch.origin": "application",
            "gen_ai.conversation.id": "thread-9",
          },
        }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      // Zero is "no idle wait configured", not "wait for zero seconds" — a
      // delay of 0 with a 0ms dedup TTL would dedup nothing at all.
      const [, options] = evaluation.mock.calls[0] as [
        ExecuteEvaluationCommandData,
        { delay?: number; deduplication?: { ttlMs?: number } },
      ];
      expect(options.delay).toBeUndefined();
      expect(options.deduplication?.ttlMs).toBe(
        EVALUATION_REQUEST_DEDUP_TTL_MS,
      );
    });
  });

  describe("given a monitor built on a linked evaluator", () => {
    it("names the evaluation after the evaluator", async () => {
      const { deps, evaluation } = makeDeps({
        monitors: [
          monitor({
            name: "Monitor name",
            evaluator: { name: "Evaluator name" },
          }),
        ],
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      const [data] = evaluation.mock.calls[0] as [ExecuteEvaluationCommandData];
      expect(data.evaluatorName).toBe("Evaluator name");
    });

    it("falls back to the monitor's own name when nothing is linked", async () => {
      const { deps, evaluation } = makeDeps({
        monitors: [monitor({ name: "Legacy monitor", evaluator: null })],
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      const [data] = evaluation.mock.calls[0] as [ExecuteEvaluationCommandData];
      expect(data.evaluatorName).toBe("Legacy monitor");
    });
  });

  describe("given the trace says it came from the customer's application", () => {
    /** @scenario Evaluation trigger runs on traces with explicit application origin */
    it("asks for the project's monitors to run", async () => {
      const { deps, evaluation, getEnabledOnMessageMonitors } = makeDeps({
        summary: traceSummary({
          attributes: { "langwatch.origin": "application" },
        }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      expect(getEnabledOnMessageMonitors).toHaveBeenCalledWith(PROJECT_ID);
      expect(evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the trace came from somewhere other than the application", () => {
    /** @scenario Evaluation trigger dispatches for any known origin (preconditions filter) */
    it("asks for the project's monitors to run anyway", async () => {
      const { deps, evaluation } = makeDeps({
        summary: traceSummary({
          attributes: { "langwatch.origin": "evaluation" },
        }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      // Origin is a user-configurable precondition, not a hardcoded rule here:
      // the monitors' own precondition matchers filter by it, so deciding it
      // in this handler would overrule what the customer configured.
      expect(evaluation).toHaveBeenCalledTimes(1);
      const [data] = evaluation.mock.calls[0] as [ExecuteEvaluationCommandData];
      expect(data.origin).toBe("evaluation");
    });
  });

  describe("given a trace under the span processing cap", () => {
    /** @scenario Evaluations run for a trace under the processing cap */
    it("asks for the project's monitors to run", async () => {
      const { deps, evaluation } = makeDeps({
        summary: traceSummary({ spanCount: MAX_PROCESSED_SPANS - 1 }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      expect(evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a runaway trace past the span processing cap", () => {
    /** @scenario Evaluations are skipped for a trace over the processing cap */
    it("asks for nothing, and never looks the project's monitors up", async () => {
      const { deps, evaluation, getEnabledOnMessageMonitors } = makeDeps({
        summary: traceSummary({ spanCount: MAX_PROCESSED_SPANS }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      // Past the cap the fold has stopped deriving the summary, so re-running
      // every monitor buys no added signal. The WORK is refused; the spans are
      // stored by a different projection and are untouched by this.
      expect(evaluation).not.toHaveBeenCalled();
      expect(getEnabledOnMessageMonitors).not.toHaveBeenCalled();
    });

    it("asks for nothing when a coalesced batch jumped clean past the cap", async () => {
      const { deps, evaluation } = makeDeps({
        summary: traceSummary({ spanCount: MAX_PROCESSED_SPANS + 4_000 }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      expect(evaluation).not.toHaveBeenCalled();
    });
  });

  describe("given the trace's origin has not resolved yet", () => {
    /** @scenario Evaluation trigger skips traces with empty origin and no SDK info */
    it("asks for nothing", async () => {
      const { deps, evaluation } = makeDeps({
        summary: traceSummary({ attributes: {} }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      expect(evaluation).not.toHaveBeenCalled();
    });

    it("declines rather than failing, so the gate's origin can ask again", async () => {
      const { deps } = makeDeps({ summary: traceSummary({ attributes: {} }) });

      await expect(
        createEvaluationTriggerRequestHandler(deps)(intent(), CTX),
      ).resolves.toBeUndefined();
    });
  });

  describe("given a guardrail blocked the trace with nothing to show", () => {
    it("asks for nothing", async () => {
      const { deps, evaluation } = makeDeps({
        summary: traceSummary({
          blockedByGuardrail: true,
          computedOutput: null,
        }),
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      expect(evaluation).not.toHaveBeenCalled();
    });
  });

  describe("given the project has no on-message monitors", () => {
    it("asks for nothing", async () => {
      const { deps, evaluation } = makeDeps({ monitors: [] });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      expect(evaluation).not.toHaveBeenCalled();
    });
  });

  describe("given nothing this request is asking about was real execution", () => {
    it("asks for nothing", async () => {
      const { deps, evaluation } = makeDeps();

      await createEvaluationTriggerRequestHandler(deps)(
        intent({ pendingEligibleSpanCount: 0, evaluatorEmittedSpanCount: 3 }),
        CTX,
      );

      expect(evaluation).not.toHaveBeenCalled();
    });

    it("counts the loop it blocked", async () => {
      const { deps } = makeDeps();
      const before = await loopBlockedTotal();

      await createEvaluationTriggerRequestHandler(deps)(
        intent({ pendingEligibleSpanCount: 0, evaluatorEmittedSpanCount: 1 }),
        CTX,
      );

      expect(await loopBlockedTotal()).toBe(before + 1);
    });

    it("still evaluates a request that carries a real span of its own", async () => {
      const { deps, evaluation } = makeDeps();

      await createEvaluationTriggerRequestHandler(deps)(
        intent({ pendingEligibleSpanCount: 1, evaluatorEmittedSpanCount: 2 }),
        CTX,
      );

      // Re-runs are allowed; only evaluation output is blocked.
      expect(evaluation).toHaveBeenCalledTimes(1);
    });

    it("blocks it even on a trace that has already had real spans evaluated", async () => {
      const { deps, evaluation } = makeDeps();

      // The generation is what says the trace has been round this loop before:
      // its real spans were carried away by an earlier request, so nothing is
      // pending and this ask is the evaluator's own output coming back. This
      // is the shape the feature's own traceparent propagation creates, and
      // reading a cumulative census here would wave it straight through.
      await createEvaluationTriggerRequestHandler(deps)(
        intent({
          requestGeneration: 4,
          pendingEligibleSpanCount: 0,
          evaluatorEmittedSpanCount: 1,
        }),
        CTX,
      );

      expect(evaluation).not.toHaveBeenCalled();
    });
  });

  describe("given a trace with no spans of its own yet", () => {
    it("is not counted as a loop", async () => {
      const { deps } = makeDeps();
      const before = await loopBlockedTotal();

      await createEvaluationTriggerRequestHandler(deps)(
        intent({ pendingEligibleSpanCount: 0, evaluatorEmittedSpanCount: 0 }),
        CTX,
      );

      expect(await loopBlockedTotal()).toBe(before);
    });
  });

  describe("given the trace cannot be read", () => {
    it("throws so the outbox asks again", async () => {
      const { deps } = makeDeps({ summary: null });

      // "We could not find out" is not "this trace has nothing to evaluate".
      // Swallowing it would reinstate the silent skip this process removes.
      await expect(
        createEvaluationTriggerRequestHandler(deps)(intent(), CTX),
      ).rejects.toThrow(/Trace summary not found/);
    });
  });

  describe("when a monitor's evaluation cannot be requested", () => {
    /** @scenario "A failure to request an evaluation is retried" */
    it("throws so the outbox asks again", async () => {
      const { deps } = makeDeps({
        monitors: [monitor()],
        evaluation: async () => {
          throw new Error("queue down");
        },
      });

      // Its predecessor logged this and carried on, which lost that monitor's
      // evaluation for that trace permanently, with nothing surfaced anywhere.
      await expect(
        createEvaluationTriggerRequestHandler(deps)(intent(), CTX),
      ).rejects.toThrow("queue down");
    });

    it("asks the project's other monitors before giving up", async () => {
      const { deps, evaluation } = makeDeps({
        monitors: [monitor(), monitor({ id: "monitor-2" })],
        evaluation: async (data) => {
          if (data.evaluatorId === "monitor-1") throw new Error("queue down");
        },
      });

      await expect(
        createEvaluationTriggerRequestHandler(deps)(intent(), CTX),
      ).rejects.toThrow("queue down");

      expect(evaluation).toHaveBeenCalledTimes(2);
      expect(
        (evaluation.mock.calls as [ExecuteEvaluationCommandData][]).map(
          ([data]) => data.evaluatorId,
        ),
      ).toEqual(["monitor-1", "monitor-2"]);
    });

    /** @scenario "An evaluation that could not be requested is visible" */
    it("reports the failure once every monitor has been attempted", async () => {
      const attempted: string[] = [];
      const { deps } = makeDeps({
        monitors: [monitor(), monitor({ id: "monitor-2" })],
        evaluation: async (data) => {
          attempted.push(data.evaluatorId);
          throw new Error(`${data.evaluatorId} unreachable`);
        },
      });

      await expect(
        createEvaluationTriggerRequestHandler(deps)(intent(), CTX),
      ).rejects.toThrow("monitor-1 unreachable");

      expect(attempted).toEqual(["monitor-1", "monitor-2"]);
    });
  });

  describe("when the outbox retries a request that partly succeeded", () => {
    /** @scenario "A trace is not evaluated twice by the same monitor" */
    it("asks for the same evaluation, not a second chargeable one", async () => {
      const succeed = makeDeps({ monitors: [monitor()] });
      await createEvaluationTriggerRequestHandler(succeed.deps)(intent(), CTX);

      const retry = makeDeps({ monitors: [monitor()] });
      await createEvaluationTriggerRequestHandler(retry.deps)(intent(), {
        ...CTX,
        attempt: 2,
      });

      // The evaluation aggregate is keyed by this id, so a redelivery lands on
      // the same evaluation. A minted id would leave that to the command
      // queue's dedup window, which on the thread-level branch can be shorter
      // than the outbox's own 1s/2s/4s backoff.
      const [first] = succeed.evaluation.mock.calls[0] as [
        ExecuteEvaluationCommandData,
      ];
      const [second] = retry.evaluation.mock.calls[0] as [
        ExecuteEvaluationCommandData,
      ];
      expect(second.evaluationId).toBe(first.evaluationId);
    });

    it("gives a monitor its own evaluation apart from the others", async () => {
      const { deps, evaluation } = makeDeps({
        monitors: [monitor(), monitor({ id: "monitor-2" })],
      });

      await createEvaluationTriggerRequestHandler(deps)(intent(), CTX);

      const ids = (
        evaluation.mock.calls as [ExecuteEvaluationCommandData][]
      ).map(([data]) => data.evaluationId);
      expect(new Set(ids).size).toBe(2);
    });

    it("still re-runs when the trace asks again later", async () => {
      const first = makeDeps({ monitors: [monitor()] });
      await createEvaluationTriggerRequestHandler(first.deps)(
        intent({ requestGeneration: 0 }),
        CTX,
      );

      const later = makeDeps({ monitors: [monitor()] });
      await createEvaluationTriggerRequestHandler(later.deps)(
        intent({ requestGeneration: 1 }),
        CTX,
      );

      // A trace that resumes, or that only became evaluable once its origin
      // resolved, is a genuine re-run rather than the same evaluation.
      const [firstData] = first.evaluation.mock.calls[0] as [
        ExecuteEvaluationCommandData,
      ];
      const [laterData] = later.evaluation.mock.calls[0] as [
        ExecuteEvaluationCommandData,
      ];
      expect(laterData.evaluationId).not.toBe(firstData.evaluationId);
    });
  });
});
