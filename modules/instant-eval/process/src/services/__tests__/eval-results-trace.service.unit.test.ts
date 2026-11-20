/**
 * A trace's kept results for its drawer: read only with release_instant_eval_results on, over
 * the trace's window padded as recall's is, and answered as the wire carries them.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import { describe, expect, it } from "vitest";

import type { EvalResultRecord } from "../../repositories/eval-results.repository.ts";
import { MemoryEvalResultsRepository } from "../../repositories/memory/memory.eval-results.repository.ts";
import { EVAL_RESULTS_KEY_VERSION } from "../../rules/eval-results-key.rules.ts";
import { EVAL_RESULTS_RECALL_WINDOW_PADDING_MS } from "../eval-results-recall.service.ts";
import { EvalResultsTraceService } from "../eval-results-trace.service.ts";

const TRACE_START = Date.UTC(2026, 10, 2, 10);
const TRACE_END = TRACE_START + 5_000;

function record(overrides: Partial<EvalResultRecord> = {}): EvalResultRecord {
  return {
    TenantId: "project-1",
    TraceId: "trace-1",
    SpanId: "",
    QuestionHash: "question",
    Question: "Is the customer annoyed?",
    Kind: "boolean",
    JudgeModel: "langwatch/instant-evals",
    InputHash: "input",
    JudgedColumn: "llm_readable_trace",
    KeyVersion: EVAL_RESULTS_KEY_VERSION,
    Source: "dashboard",
    SourceId: "widget-1",
    Status: "judged",
    Score: null,
    Label: "",
    Probability: 0.9,
    Probabilities: "",
    Error: "",
    OccurredAt: TRACE_START,
    JudgedAt: TRACE_END + 60_000,
    UpdatedAt: TRACE_END + 60_000,
    _retention_days: 30,
    ...overrides,
  };
}

const TRACE = {
  projectId: "project-1",
  traceId: "trace-1",
  occurredFrom: TRACE_START,
  occurredUntil: TRACE_END,
};

describe("EvalResultsTraceService", () => {
  describe("given a project without release_instant_eval_results", () => {
    describe("when its trace's results are read", () => {
      /** @scenario "With release_instant_eval_results off a trace's read reads nothing" */
      it("answers empty and never reads eval_results", async () => {
        const service = EvalResultsTraceService.create({
          results: {
            findLatestByTrace: () => Promise.reject(new Error("eval_results was read")),
          },
          peers: { isReleased: async () => false },
        });

        await expect(service.findResultsByTrace(TRACE)).resolves.toEqual([]);
      });
    });
  });

  describe("given a released project with a result kept on a span of its trace", () => {
    describe("when the trace's results are read", () => {
      /** @scenario "A trace's results are the latest per span, question and judged column" */
      it("answers the result with its source, judge and judged time, as the wire carries it", async () => {
        const results = MemoryEvalResultsRepository.create();
        await results.insert([
          record({
            SpanId: "span-1",
            // A span statement keys a row by the span's time, which may sit outside the trace's.
            OccurredAt: TRACE_START - EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
          }),
        ]);
        const service = EvalResultsTraceService.create({
          results,
          peers: { isReleased: async () => true },
        });

        await expect(service.findResultsByTrace(TRACE)).resolves.toEqual([
          {
            spanId: "span-1",
            judgedColumn: "llm_readable_trace",
            question: "Is the customer annoyed?",
            kind: "boolean",
            status: "judged",
            probability: 0.9,
            score: null,
            label: null,
            judgeModel: "langwatch/instant-evals",
            judgedAt: TRACE_END + 60_000,
            source: "dashboard",
            sourceId: "widget-1",
          },
        ]);
      });
    });
  });
});
