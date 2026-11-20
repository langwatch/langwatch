/**
 * A monitor on the Instant Evals judge recalls from eval_results and keeps what it judged, behind
 * the flag and never failing the run; through the real command, receipt and execution services.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  INSTANT_EVAL_RESULTS_FLAG,
  type InstantEvalMonitorJudgementAnswer,
  type InstantEvalMonitorJudgment,
} from "@langwatch/instant-eval-contract";
import type {
  InstantEvalJudgeApi,
  InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { EvaluationInstantEvalResults } from "../channels/evaluation-instant-eval-results.channel.ts";
import { MemoryEvaluationInstantEvalResultsChannel } from "../channels/memory/memory.evaluation-instant-eval-results.channel.ts";
import { EvaluationJudgeRoutingService } from "../features/execution/services/evaluation-judge-routing.service.ts";
import { EvaluationMonitorJudgmentsService } from "../features/execution/services/evaluation-monitor-judgments.service.ts";
import { buildExecuteCommand } from "./support/evaluation-execution.fixtures.ts";
import { buildInstantEvalMonitor, reportedOf } from "./support/instant-eval-monitor.fixtures.ts";

const politeJudge: InstantEvalJudgeApi["judge"] = async () => ({
  outcome: "judged",
  judgement: {
    verdicts: [{ questionId: "judge", probability: 0.9 }],
    inputTokens: 500,
    isTextTruncated: false,
  },
  priceUsd: 0.0004,
});

/** Instant-eval's kept results as a test scripts them: a recall that hangs, a write that fails. */
class ScriptedInstantEvalResults implements EvaluationInstantEvalResults {
  readonly kept: InstantEvalMonitorJudgment[] = [];

  constructor(private readonly script: { isRecallHanging?: boolean; isKeepFailing?: boolean }) {}

  findMonitorJudgments(_input: InstantEvalMonitorJudgment): Promise<InstantEvalVerdict[]> {
    if (this.script.isRecallHanging) return new Promise(() => undefined);
    return Promise.resolve([]);
  }

  async keepMonitorJudgment({
    judgement: _judgement,
    ...judgment
  }: InstantEvalMonitorJudgment & { judgement: InstantEvalMonitorJudgementAnswer }): Promise<void> {
    if (this.script.isKeepFailing) throw new Error("eval_results is unreachable");
    this.kept.push(judgment);
  }
}

/**
 * The real gate over a results channel. The kept-results flag answers as the test says; every
 * other flag (the judge router's) reads off. `flags` is shared so the router can read it too.
 */
function monitorJudgmentsWith({
  results,
  isFlagOn = true,
  isFlagHanging = false,
  timeoutMs,
}: {
  results: EvaluationInstantEvalResults;
  isFlagOn?: boolean;
  isFlagHanging?: boolean;
  timeoutMs?: number;
}) {
  const flagReads: string[] = [];
  const flags = createApiFixture<FeatureFlagApi>({
    isEnabled: (flagKey) => {
      flagReads.push(flagKey);
      if (flagKey !== INSTANT_EVAL_RESULTS_FLAG) return Promise.resolve(false);
      return isFlagHanging ? new Promise<boolean>(() => undefined) : Promise.resolve(isFlagOn);
    },
  });
  const judgments = EvaluationMonitorJudgmentsService.create({
    results,
    flags,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { judgments, flags, flagReads };
}

/** The project's organization, counting every lookup. */
function countedProjects() {
  const lookups: string[] = [];
  const projects = createApiFixture<ProjectApi>({
    findOrganizationId: async (projectId) => {
      lookups.push(projectId);
      return "organization-1";
    },
  });
  return { projects, lookups };
}

function monitorCommand({
  evaluationId,
  isGuardrail,
}: {
  evaluationId: string;
  isGuardrail?: boolean;
}) {
  return buildExecuteCommand({
    evaluationId,
    evaluatorType: "langevals/llm_boolean",
    ...(isGuardrail === undefined ? {} : { isGuardrail }),
  });
}

describe("Instant Evals judge on a monitor, with kept results", () => {
  describe("given a project without release_instant_eval_results", () => {
    describe("when the monitor evaluates a trace", () => {
      /** @scenario "A monitor with release_instant_eval_results off makes no eval_results call" */
      it("asks instant-eval nothing and reports what it reports today", async () => {
        const results = MemoryEvaluationInstantEvalResultsChannel.create();
        const { judgments } = monitorJudgmentsWith({ results, isFlagOn: false });
        const flagged = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
        });
        const today = buildInstantEvalMonitor({ judge: politeJudge });

        const events = await flagged.handler.handle(monitorCommand({ evaluationId: "eval-1" }));
        const again = await flagged.handler.handle(monitorCommand({ evaluationId: "eval-2" }));
        const todays = await today.handler.handle(monitorCommand({ evaluationId: "eval-1" }));

        expect(results.calls).toEqual([]);
        expect(flagged.calls).toHaveLength(2);
        expect(reportedOf(again).passed).toBe(true);
        expect(reportedOf(events)).toEqual(reportedOf(todays));
      });
    });
  });

  describe("given a monitor on LangWatch's judge, whose router reads its flags too", () => {
    describe("when it evaluates a trace with release_instant_eval_results on", () => {
      /** @scenario "A monitor's judge call looks up its organization once for every flag it reads" */
      it("reads the router and kept-results flags from one organization lookup", async () => {
        const results = MemoryEvaluationInstantEvalResultsChannel.create();
        const { judgments, flags, flagReads } = monitorJudgmentsWith({ results });
        const { projects, lookups } = countedProjects();
        const { handler, calls } = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
          judgeRouting: EvaluationJudgeRoutingService.create({ flags }),
          projects,
        });

        await handler.handle(monitorCommand({ evaluationId: "eval-1" }));

        expect(lookups).toEqual(["project-evaluation-test"]);
        expect(flagReads).toEqual([
          "instant_evals_hosted_disabled",
          INSTANT_EVAL_RESULTS_FLAG,
          "release_instant_evals_judge_router",
        ]);
        expect(calls).toHaveLength(1);
        expect(results.calls.map((call) => call.operation)).toEqual(["find", "keep"]);
      });
    });

    describe("when it evaluates a trace with release_instant_eval_results off", () => {
      it("adds no lookup to the router's and asks instant-eval nothing", async () => {
        const results = MemoryEvaluationInstantEvalResultsChannel.create();
        const { judgments, flags } = monitorJudgmentsWith({ results, isFlagOn: false });
        const { projects, lookups } = countedProjects();
        const { handler, calls } = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
          judgeRouting: EvaluationJudgeRoutingService.create({ flags }),
          projects,
        });

        await handler.handle(monitorCommand({ evaluationId: "eval-1" }));

        expect(lookups).toHaveLength(1);
        expect(calls).toHaveLength(1);
        expect(results.calls).toEqual([]);
      });
    });
  });

  describe("given a flag read that never answers", () => {
    describe("when the monitor evaluates a trace", () => {
      /** @scenario "A monitor whose flag read times out is judged as today" */
      it("gives up on the flag in time, asks nothing more and reports as today", async () => {
        const results = MemoryEvaluationInstantEvalResultsChannel.create();
        const { judgments, flagReads } = monitorJudgmentsWith({
          results,
          isFlagHanging: true,
          timeoutMs: 10,
        });
        const flagged = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
        });
        const today = buildInstantEvalMonitor({ judge: politeJudge });

        const startedAt = Date.now();
        const events = await flagged.handler.handle(monitorCommand({ evaluationId: "eval-1" }));
        const elapsedMs = Date.now() - startedAt;
        const todays = await today.handler.handle(monitorCommand({ evaluationId: "eval-1" }));

        expect(flagReads).toHaveLength(1);
        expect(results.calls).toEqual([]);
        expect(flagged.calls).toHaveLength(1);
        expect(reportedOf(events)).toEqual(reportedOf(todays));
        expect(elapsedMs).toBeLessThan(1_000);
      });
    });
  });

  describe("given a thread-level monitor", () => {
    describe("when its judge call is recalled", () => {
      /** @scenario "A thread-level monitor's judge call never reads or writes eval_results" */
      it("is not kept, and asks neither the flag nor instant-eval", async () => {
        const results = MemoryEvaluationInstantEvalResultsChannel.create();
        const { judgments, flagReads } = monitorJudgmentsWith({ results });

        const recall = await judgments.recall({
          projectId: "project-evaluation-test",
          organizationOf: async () => "organization-1",
          monitor: { id: "monitor-test", isGuardrail: false, isThreadLevel: true },
          traceId: "trace-evaluation-test",
          occurredAt: 0,
          question: { id: "judge", kind: "boolean", instructions: "Is the reply polite?" },
          inputs: { input: "where is my order?", output: "it ships tomorrow" },
          judgeModel: { kind: "langwatch" },
        });

        expect(recall).toEqual({ kind: "not_kept" });
        expect(flagReads).toEqual([]);
        expect(results.calls).toEqual([]);
      });
    });
  });

  describe("given a monitor that already judged a trace", () => {
    describe("when it evaluates the same trace again with the same question and judge", () => {
      /** @scenario "A monitor's repeat judgment of a trace is recalled, not judged" */
      it("reports the kept verdict without a judge call or a cost row", async () => {
        const results = MemoryEvaluationInstantEvalResultsChannel.create();
        const { judgments } = monitorJudgmentsWith({ results });
        const { handler, calls, costRecorder } = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
        });

        const first = await handler.handle(monitorCommand({ evaluationId: "eval-1" }));
        const second = await handler.handle(monitorCommand({ evaluationId: "eval-2" }));

        expect(calls).toHaveLength(1);
        expect(reportedOf(second)).toMatchObject({
          status: "processed",
          passed: true,
          score: 1,
          details: reportedOf(first).details,
          costId: null,
        });
        expect(costRecorder.created).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a monitor that never judged a trace", () => {
    describe("when it evaluates the trace", () => {
      /** @scenario "A monitor's missed judgment is judged, then kept under the monitor" */
      it("judges once, then keeps the answer under the monitor's id", async () => {
        const results = MemoryEvaluationInstantEvalResultsChannel.create();
        const { judgments } = monitorJudgmentsWith({ results });
        const { handler, calls } = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
        });

        const events = await handler.handle(monitorCommand({ evaluationId: "eval-1" }));

        expect(calls).toHaveLength(1);
        expect(results.calls).toEqual([
          { operation: "find", monitorId: "monitor-test" },
          { operation: "keep", monitorId: "monitor-test" },
        ]);
        expect(reportedOf(events).passed).toBe(true);
      });
    });
  });

  describe("given a recall that does not answer in time", () => {
    describe("when the monitor evaluates a trace", () => {
      /** @scenario "A monitor's recall that times out is judged as today" */
      it("judges the trace and reports its verdict", async () => {
        const results = new ScriptedInstantEvalResults({ isRecallHanging: true });
        const { judgments } = monitorJudgmentsWith({ results, timeoutMs: 5 });
        const { handler, calls } = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
        });

        const events = await handler.handle(monitorCommand({ evaluationId: "eval-1" }));

        expect(calls).toHaveLength(1);
        expect(reportedOf(events)).toMatchObject({ status: "processed", passed: true });
        expect(results.kept).toHaveLength(1);
      });
    });
  });

  describe("given a write to eval_results that fails", () => {
    describe("when the monitor evaluates a trace", () => {
      /** @scenario "A monitor's result is delivered when keeping it fails" */
      it("still reports the judged verdict and its cost", async () => {
        const results = new ScriptedInstantEvalResults({ isKeepFailing: true });
        const { judgments } = monitorJudgmentsWith({ results });
        const { handler, costRecorder } = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
        });

        const events = await handler.handle(monitorCommand({ evaluationId: "eval-1" }));

        expect(reportedOf(events)).toMatchObject({ status: "processed", passed: true });
        expect(costRecorder.created).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a guardrail monitor", () => {
    describe("when it evaluates a trace", () => {
      /** @scenario "A guardrail's judge call never reads or writes eval_results" */
      it("judges as today and asks neither the flag nor instant-eval", async () => {
        const results = MemoryEvaluationInstantEvalResultsChannel.create();
        const { judgments, flagReads } = monitorJudgmentsWith({ results });
        const { handler, calls } = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
        });

        await handler.handle(monitorCommand({ evaluationId: "eval-1", isGuardrail: true }));

        expect(calls).toHaveLength(1);
        expect(results.calls).toEqual([]);
        expect(flagReads).toEqual([]);
      });
    });
  });

  describe("given a trace read back with no trace id", () => {
    describe("when the monitor evaluates it", () => {
      /** @scenario "A monitor's judge call with no trace id never reads or writes eval_results" */
      it("judges as today and asks neither the flag nor instant-eval", async () => {
        const results = MemoryEvaluationInstantEvalResultsChannel.create();
        const { judgments, flagReads } = monitorJudgmentsWith({ results });
        const { handler, calls } = buildInstantEvalMonitor({
          judge: politeJudge,
          monitorJudgments: judgments,
          traceId: "",
        });

        await handler.handle(monitorCommand({ evaluationId: "eval-1" }));

        expect(calls).toHaveLength(1);
        expect(results.calls).toEqual([]);
        expect(flagReads).toEqual([]);
      });
    });
  });
});
