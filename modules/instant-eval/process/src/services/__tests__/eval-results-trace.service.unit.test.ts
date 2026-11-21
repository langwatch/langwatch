/**
 * A trace's kept results for its drawer: read only with release_instant_eval_results on, over
 * the trace's window padded as recall's is, and answered as the wire carries them.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import { INSTANT_EVAL_TRACE_RESULTS_MAX_WINDOW_MS } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import type { EvalResultRecord } from "../../repositories/eval-results.repository.ts";
import { MemoryEvalResultsRepository } from "../../repositories/memory/memory.eval-results.repository.ts";
import {
  EVAL_RESULTS_KEY_VERSION,
  EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
} from "../../rules/eval-results-key.rules.ts";
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

  describe("given a released project and a read asked over a window wider than seven days", () => {
    describe("when the trace's results are read", () => {
      /** @scenario "A trace's read spans at most seven days from the trace's start" */
      it("reads seven padded days from the trace's start and answers no row past", async () => {
        const widestUntil =
          TRACE_START +
          INSTANT_EVAL_TRACE_RESULTS_MAX_WINDOW_MS +
          EVAL_RESULTS_RECALL_WINDOW_PADDING_MS;
        const results = MemoryEvalResultsRepository.create();
        await results.insert([
          record({ SpanId: "span-within", OccurredAt: widestUntil }),
          record({ SpanId: "span-past", OccurredAt: widestUntil + 1 }),
        ]);
        const service = EvalResultsTraceService.create({
          results,
          peers: { isReleased: async () => true },
        });

        const answered = await service.findResultsByTrace({
          ...TRACE,
          occurredUntil: TRACE_START + 52 * INSTANT_EVAL_TRACE_RESULTS_MAX_WINDOW_MS,
        });

        expect(answered.map((result) => result.spanId)).toEqual(["span-within"]);
      });
    });
  });

  describe("given a released project with several results kept on a span of its trace", () => {
    describe("when the trace's results are read", () => {
      /** @scenario "A trace's results are the latest per span, question and judged column" */
      it("answers each cell's latest judged row, else its failed one, newest first", async () => {
        const judgedAt = TRACE_END + 60_000;
        const results = MemoryEvalResultsRepository.create();
        await results.insert([
          record({ SpanId: "span-1", SourceId: "widget-1", JudgedAt: judgedAt - 30_000 }),
          record({
            SpanId: "span-1",
            SourceId: "widget-2",
            JudgedAt: judgedAt,
            Probability: 0.7,
            // A span statement keys a row by the span's time, which may sit outside the trace's.
            OccurredAt: TRACE_START - EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
          }),
          record({
            SpanId: "span-1",
            JudgedColumn: "output",
            SourceId: "widget-1",
            JudgedAt: judgedAt - 10_000,
            Probability: 0.4,
          }),
          record({
            SpanId: "span-1",
            JudgedColumn: "output",
            SourceId: "widget-3",
            JudgedAt: judgedAt + 10_000,
            Status: "failed",
            Probability: null,
            Error: "classifier_failed",
          }),
          record({
            SpanId: "span-1",
            JudgedColumn: "input",
            SourceId: "widget-4",
            JudgedAt: judgedAt - 20_000,
            Status: "failed",
            Probability: null,
            Error: "classifier_failed",
          }),
        ]);
        const service = EvalResultsTraceService.create({
          results,
          peers: { isReleased: async () => true },
        });

        const kept = {
          spanId: "span-1",
          question: "Is the customer annoyed?",
          kind: "boolean",
          score: null,
          label: null,
          judgeModel: "langwatch/instant-evals",
          source: "dashboard",
        };
        await expect(service.findResultsByTrace(TRACE)).resolves.toEqual([
          {
            ...kept,
            judgedColumn: "llm_readable_trace",
            status: "judged",
            probability: 0.7,
            judgedAt,
            sourceId: "widget-2",
          },
          {
            ...kept,
            judgedColumn: "output",
            status: "judged",
            probability: 0.4,
            judgedAt: judgedAt - 10_000,
            sourceId: "widget-1",
          },
          {
            ...kept,
            judgedColumn: "input",
            status: "failed",
            probability: null,
            judgedAt: judgedAt - 20_000,
            sourceId: "widget-4",
          },
        ]);
      });
    });
  });
});
