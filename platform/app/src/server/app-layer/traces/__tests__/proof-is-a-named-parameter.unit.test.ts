/**
 * @vitest-environment node
 * @unit
 *
 * ADR-166 / ADR-144 block B: the proof travels as a named parameter, never
 * ambient. A trace read called without it, or handed a project id where the
 * proof goes, does not compile. Each call below sits behind
 * `@ts-expect-error`, so `pnpm typecheck:tests` fails the moment one of them
 * starts to compile: the test's assertions are the compiler's. The bodies
 * are never run. The lint gate's positional-call check
 * (`clients/clickhouse/__tests__/store-call-carries-authorization.unit.test.ts`)
 * is the run-time half of the same rule for the trace routers.
 */
import { describe, expect, it } from "vitest";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { TraceListRepository } from "../repositories/trace-list.repository";
import type { SpanStorageService } from "../span-storage.service";
import type { TraceListService } from "../trace-list.service";
import type { TraceSummaryService } from "../trace-summary.service";

declare const list: TraceListService;
declare const listRepository: TraceListRepository;
declare const summary: TraceSummaryService;
declare const spans: SpanStorageService;
declare const evaluationRuns: EvaluationRunService;

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
          listRepository.findAll({
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
          evaluationRuns.findByTraceId({ traceId: "trace" }),
      ];

      expect(withoutTheProof).toHaveLength(5);
    });

    it("refuses a project id handed over where the proof goes", () => {
      const byPosition = [
        () =>
          // @ts-expect-error a positional tenant id is not a proof
          evaluationRuns.findByTraceId("project", "trace"),
        () =>
          // @ts-expect-error a tenant named in the proof's place is not a proof
          summary.getByTraceId({ tenantId: "project", traceId: "trace" }),
      ];

      expect(byPosition).toHaveLength(2);
    });
  });
});
