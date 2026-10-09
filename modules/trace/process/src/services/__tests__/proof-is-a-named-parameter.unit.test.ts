/**
 * @vitest-environment node
 * ADR-175: the proof travels as a named parameter, never ambient. Each call below sits behind
 * `@ts-expect-error`, so the package typecheck fails the moment one starts to compile; the
 * bodies never run. The store-call gate in architecture-enforcer is the run-time half.
 */
import type { Authorization } from "@langwatch/authorization";
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
declare const authorization: Authorization;

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
            sort: { columnId: "time", direction: "desc" },
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
          // @ts-expect-error the evaluation runs read needs the proof by name
          evaluationRuns.findRunsByTraceId({ traceId: "trace" }),
      ];

      expect(withoutTheProof).toHaveLength(5);
    });

    it("compiles the same calls once the proof is named, so the only error above is its absence", () => {
      const withTheProof = [
        () =>
          list.getList({
            authorization,
            timeRange,
            sort: { columnId: "time", direction: "desc" },
            pageSize: 1,
          }),
        () =>
          listRepository.listAll({
            authorization,
            timeRange,
            sort: { column: "OccurredAt", direction: "desc" },
            limit: 1,
          }),
        () => summary.getByTraceId({ authorization, traceId: "trace" }),
        () => spans.getSpansByTraceId({ authorization, traceId: "trace" }),
        () => evaluationRuns.findRunsByTraceId({ authorization, traceId: "trace" }),
      ];

      expect(withTheProof).toHaveLength(5);
    });

    it("refuses a project id handed over where the proof goes", () => {
      const byTenant = [
        () =>
          // @ts-expect-error a tenant named in the proof's place is not a proof
          evaluationRuns.findRunsByTraceId({ tenantId: "project", traceId: "trace" }),
        () =>
          // @ts-expect-error a tenant named in the proof's place is not a proof
          summary.getByTraceId({ tenantId: "project", traceId: "trace" }),
      ];

      expect(byTenant).toHaveLength(2);
    });
  });
});
