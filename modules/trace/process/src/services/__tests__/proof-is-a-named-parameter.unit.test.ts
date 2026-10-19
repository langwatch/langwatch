/**
 * @vitest-environment node
 * @unit
 * ADR-177 block B: the proof travels as a named parameter, never ambient. Each call sits behind
 * `@ts-expect-error`, so typecheck fails the moment one compiles; the bodies are never run.
 */
import type { TraceListRead } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import type { SpanStorageService } from "../../features/read/services/trace-span-storage-read.service.ts";
import type { TraceSummaryService } from "../../features/read/services/trace-summary-read.service.ts";
import type { TraceEvaluationRunsReadRepository } from "../../repositories/trace-evaluation-runs.repository.ts";

declare const list: TraceListService;
declare const listRepository: TraceListRead;
declare const summary: TraceSummaryService;
declare const spans: SpanStorageService;
declare const evaluationRuns: TraceEvaluationRunsReadRepository;

const timeRange = { from: 0, to: 1 };

describe("a trace read and its proof", () => {
  describe("when a service or repository that reads traces is called without the authorization parameter", () => {
    /** @scenario "The proof travels as a named parameter" */
    it("fails to type-check", () => {
      const withoutTheProof = [
        () =>
          // @ts-expect-error the trace list service needs the proof by name
          list.getList({
            timeRange,
            sort: { columnId: "timestamp", direction: "desc" },
            pageSize: 1,
          }),
        () =>
          // @ts-expect-error the list repository needs the proof by name
          listRepository.listAll({
            timeRange,
            sort: { column: "OccurredAt", direction: "desc" },
            limit: 1,
          }),
        () =>
          // @ts-expect-error the summary service needs the proof by name
          summary.getByTraceId({ traceId: "trace" }),
        () =>
          // @ts-expect-error the span service needs the proof by name
          spans.getSpansByTraceId({ traceId: "trace" }),
        () =>
          // @ts-expect-error the evaluations read needs the proof by name
          evaluationRuns.findSummariesByTraceIds({ traceIds: ["trace"], since: 0 }),
      ];

      expect(withoutTheProof).toHaveLength(5);
    });

    it("refuses a project id handed over where the proof goes", () => {
      const byPosition = [
        () =>
          // @ts-expect-error a positional tenant id is not a proof
          evaluationRuns.findSummariesByTraceIds("project", ["trace"]),
        () =>
          // @ts-expect-error a tenant named in the proof's place is not a proof
          summary.getByTraceId({ tenantId: "project", traceId: "trace" }),
      ];

      expect(byPosition).toHaveLength(2);
    });
  });
});
