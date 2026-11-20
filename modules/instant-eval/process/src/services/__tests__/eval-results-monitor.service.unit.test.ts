/**
 * A monitor's Instant Evals judgments: kept as monitor rows on the trace, recalled by the trace,
 * question, judge model and mapped texts, and neither read nor written with the flag off.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import type { InstantEvalMonitorJudgment } from "@langwatch/instant-eval-contract";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { MemoryEvalResultsRepository } from "../../repositories/memory/memory.eval-results.repository.ts";
import {
  EVAL_RESULTS_KEY_VERSION,
  EVAL_RESULTS_MONITOR_JUDGED_COLUMN,
  evalResultsInputHash,
} from "../../rules/eval-results-key.rules.ts";
import { EvalResultsMonitorService } from "../eval-results-monitor.service.ts";

const AT = Date.UTC(2026, 10, 20, 10);
const TRACE_START = AT - 60_000;

const JUDGMENT: InstantEvalMonitorJudgment = {
  projectId: "project-1",
  monitorId: "monitor-1",
  traceId: "trace-1",
  occurredAt: TRACE_START,
  question: {
    id: "judge",
    kind: "boolean",
    instructions: "Is the reply polite?",
    criteria: ["the instructions call for true", "the instructions call for false"],
  },
  inputs: { input: "where is my order?", output: "it ships tomorrow" },
  judgeModel: { kind: "langwatch" },
};

const POLITE = { verdicts: [{ questionId: "judge", probability: 0.9 }] };

function harness({ isReleased = true }: { isReleased?: boolean } = {}) {
  const results = MemoryEvalResultsRepository.create();
  const service = EvalResultsMonitorService.create({
    results,
    peers: { isReleased: async () => isReleased, retentionDaysOf: async () => 30 },
    now: () => AT,
  });
  return { results, service };
}

describe("EvalResultsMonitorService", () => {
  describe("given a monitor's judge answered a trace", () => {
    describe("when its judgment is kept", () => {
      /** @scenario "A monitor's judgment is kept as a monitor row on its trace" */
      it("writes one judged row naming the monitor, on the trace alone", async () => {
        const { results, service } = harness();

        await service.keep({ ...JUDGMENT, judgement: POLITE });

        expect(results.list()).toEqual([
          expect.objectContaining({
            TenantId: "project-1",
            TraceId: "trace-1",
            SpanId: "",
            Question: "Is the reply polite?",
            Kind: "boolean",
            JudgeModel: INSTANT_EVAL_JUDGE_MODEL_ID,
            JudgedColumn: EVAL_RESULTS_MONITOR_JUDGED_COLUMN,
            KeyVersion: EVAL_RESULTS_KEY_VERSION,
            Source: "monitor",
            SourceId: "monitor-1",
            Status: "judged",
            Probability: 0.9,
            OccurredAt: TRACE_START,
            JudgedAt: AT,
            _retention_days: 30,
          }),
        ]);
      });
    });

    describe("when the judge declined it", () => {
      it("keeps a failed row, which no recall reuses", async () => {
        const { results, service } = harness();

        await service.keep({
          ...JUDGMENT,
          judgement: { verdicts: [], skippedReason: "classifier_failed" },
        });

        expect(results.list().map((row) => row.Status)).toEqual(["failed"]);
        expect(await service.findJudgments(JUDGMENT)).toEqual([]);
      });
    });
  });

  describe("given a kept monitor judgment", () => {
    describe("when the same trace, question, judge and mapped texts are asked again", () => {
      /** @scenario "A monitor's kept judgment is recalled by its trace, question, judge and texts" */
      it("answers the kept verdict under the question asked now", async () => {
        const { service } = harness();
        await service.keep({ ...JUDGMENT, judgement: POLITE });

        expect(await service.findJudgments(JUDGMENT)).toEqual([
          { questionId: "judge", probability: 0.9 },
        ]);
      });
    });

    describe("when the mapped output, the judge model or the trace differs", () => {
      it("answers nothing", async () => {
        const { service } = harness();
        await service.keep({ ...JUDGMENT, judgement: POLITE });

        const changed: InstantEvalMonitorJudgment[] = [
          { ...JUDGMENT, inputs: { ...JUDGMENT.inputs, output: "it shipped yesterday" } },
          { ...JUDGMENT, judgeModel: { kind: "own", model: "openai/gpt-5-mini" } },
          { ...JUDGMENT, traceId: "trace-2" },
        ];
        for (const judgment of changed) {
          expect(await service.findJudgments(judgment)).toEqual([]);
        }
      });
    });

    describe("when an ask kept a verdict on the same trace and question", () => {
      it("answers the monitor's own verdict, never the ask's", async () => {
        const { results, service } = harness();
        await service.keep({ ...JUDGMENT, judgement: POLITE });
        const [monitorRow] = results.list();
        if (!monitorRow) throw new Error("the monitor row was not kept");
        await results.insert([
          {
            ...monitorRow,
            InputHash: evalResultsInputHash({
              judgedColumn: "llm_readable_trace",
              text: "where is my order?",
            }),
            JudgedColumn: "llm_readable_trace",
            Source: "ask",
            SourceId: "query-1",
            Probability: 0.1,
          },
        ]);

        expect(await service.findJudgments(JUDGMENT)).toEqual([
          { questionId: "judge", probability: 0.9 },
        ]);
      });
    });
  });

  describe("given a project without release_instant_eval_results", () => {
    describe("when a monitor's judgment is recalled and kept", () => {
      /** @scenario "With release_instant_eval_results off a monitor's judgment is neither read nor written" */
      it("answers empty without reading, and writes nothing", async () => {
        const service = EvalResultsMonitorService.create({
          results: {
            findLatestJudged: () => Promise.reject(new Error("eval_results was read")),
            insert: () => Promise.reject(new Error("eval_results was written")),
          },
          peers: { isReleased: async () => false, retentionDaysOf: async () => 30 },
          now: () => AT,
        });

        expect(await service.findJudgments(JUDGMENT)).toEqual([]);
        await expect(service.keep({ ...JUDGMENT, judgement: POLITE })).resolves.toBeUndefined();
      });
    });
  });
});
