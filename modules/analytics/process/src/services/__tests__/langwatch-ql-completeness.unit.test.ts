/**
 * The completeness report a windowed LangWatchQL result carries, built by one extra aggregate
 * over the same view, window and tenants as the statement.
 * @see modules/analytics/specs/analytics-query-completeness.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const PERIOD =
  "WHERE OccurredAt >= {dashboard_context_period_start:DateTime} " +
  "AND OccurredAt < {dashboard_context_period_end:DateTime}";
const COST_SQL = `SELECT sum(TotalCost) AS cost FROM analytics.traces ${PERIOD}`;
const TOPIC_SQL = `SELECT TopicId, count() AS n FROM analytics.traces ${PERIOD} GROUP BY TopicId`;
const BUCKETED_SQL =
  "SELECT toStartOfInterval(OccurredAt, " +
  "INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND) AS bucket, " +
  `count() AS value FROM analytics.traces ${PERIOD} GROUP BY bucket`;
const UNWINDOWED_SQL = "SELECT count() AS n FROM analytics.traces";
const ROLLUP_SQL =
  "SELECT sum(TraceCount) AS n FROM analytics.trace_metrics_by_minute " +
  "WHERE BucketStart >= {dashboard_context_period_start:DateTime} " +
  "AND BucketStart < {dashboard_context_period_end:DateTime}";

const WINDOW = { start: "2026-02-01T00:00:00.000Z", end: "2026-02-04T00:00:00.000Z" };
const EVERYTHING_VISIBLE = {
  catalogue: EVERY_CATALOGUE_PERMISSION,
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

type Answer = readonly Record<string, unknown>[] | Error;

/** Answers the statement first, then the report, with the rows scripted for each. */
class ScriptedExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  constructor(private readonly answers: readonly Answer[]) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    const answer = this.answers[this.requests.length] ?? [];
    this.requests.push(request);
    if (answer instanceof Error) return Promise.reject(answer);

    return Promise.resolve({
      columns: [{ name: "value", type: "UInt64" }],
      rows: answer,
      statistics: { elapsedMs: 1, rowsRead: 1, bytesRead: 1, rowsReturned: answer.length },
    });
  }
}

function run({
  sql,
  answers,
  granularitySeconds,
  maxResultBytes = 8_000_000,
}: {
  sql: string;
  answers: readonly Answer[];
  granularitySeconds?: number;
  maxResultBytes?: number;
}) {
  const executor = new ScriptedExecutor(answers);
  const service = LangWatchQLService.create({
    executor,
    database: "analytics",
    limits: { maxRows: 1_000, maxResultBytes },
  });
  const result = service.execute({
    project: { id: "project-1", lwqlKey: "key-1" },
    protections: EVERYTHING_VISIBLE,
    sql,
    timeWindow: WINDOW,
    ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
  });

  return { executor, result };
}

function epochSeconds(instant: string): number {
  return Temporal.Instant.from(instant).epochMilliseconds / 1000;
}

describe("LangWatchQLService completeness", () => {
  describe("given a windowed statement over traces that reads TotalCost", () => {
    /** @scenario "A windowed query over traces reports how many traces carry each field it reads" */
    it("reports the traces in the window and how many carry a cost", async () => {
      const { result } = run({
        sql: COST_SQL,
        answers: [
          [{ cost: 4.2 }],
          [{ n: "10", f0: "4", unpriced_count: "0", unpriced_models: [] }],
        ],
      });

      const { completeness } = await result;

      expect(completeness).toMatchObject({
        state: "partial",
        unit: "traces",
        total: 10,
        fields: [{ field: "TotalCost", label: "total cost", present: 4 }],
      });
      expect(completeness).not.toHaveProperty("buckets");
    });

    /** @scenario "Every field present on every row is complete" */
    it("is complete when every trace carries the field and nothing is unpriced", async () => {
      const { result } = run({
        sql: COST_SQL,
        answers: [[{ cost: 1 }], [{ n: 3, f0: 3, unpriced_count: 0, unpriced_models: [] }]],
      });

      expect((await result).completeness?.state).toBe("complete");
    });

    /** @scenario "A query reading cost reports traces with unpriced spans and their models" */
    it("counts the traces with unpriced spans and names their models, sorted", async () => {
      const { result } = run({
        sql: COST_SQL,
        answers: [
          [{ cost: 1 }],
          [{ n: 5, f0: 5, unpriced_count: "2", unpriced_models: ["my-finetune", "acme-llm"] }],
        ],
      });

      const { completeness } = await result;

      expect(completeness?.unpriced).toEqual({ count: 2, models: ["acme-llm", "my-finetune"] });
      expect(completeness?.state).toBe("partial");
    });

    /** @scenario "The report reads under the same tenant capability as the statement" */
    it("sends the report with the statement's tenant capability and the period bounds", async () => {
      const { executor, result } = run({ sql: COST_SQL, answers: [[], [{ n: 0 }]] });
      await result;

      const [statement, report] = executor.requests;
      expect(report?.tenantCapability).toBe(statement?.tenantCapability);
      expect(report?.sql).toContain("FROM analytics.traces");
      expect(report?.sql).toContain("countIf(`TotalCost` IS NOT NULL)");
      expect(report?.parameters).toMatchObject({
        completeness_window_start: "2026-02-01 00:00:00",
        completeness_window_end: "2026-02-04 00:00:00",
      });
    });
  });

  /** @scenario "No rows in the period is no traffic" */
  it("is no_traffic when the window holds no traces", async () => {
    const { result } = run({ sql: COST_SQL, answers: [[], [{ n: "0", f0: "0" }]] });

    expect((await result).completeness).toMatchObject({ state: "no_traffic", total: 0 });
  });

  /** @scenario "A field the query reads that no row carries is missing" */
  it("is missing when no trace carries a field the query reads", async () => {
    const { result } = run({ sql: TOPIC_SQL, answers: [[], [{ n: 8, f0: 0 }]] });

    expect((await result).completeness).toMatchObject({
      state: "missing",
      fields: [{ field: "TopicId", label: "topic", present: 0 }],
    });
  });

  /** @scenario "Empty buckets at the start and end of the window are listed with n 0" */
  it("lists every bucket of the window, empty ones at either end with n 0", async () => {
    const middleDay = epochSeconds("2026-02-02T00:00:00Z");
    const { executor, result } = run({
      sql: BUCKETED_SQL,
      granularitySeconds: 86_400,
      answers: [[{ bucket: "2026-02-02 00:00:00", value: 7 }], [{ bucket: middleDay, n: "7" }]],
    });

    const { completeness } = await result;

    expect(executor.requests[1]?.sql).toContain("GROUP BY bucket");
    expect(completeness?.buckets).toEqual([
      { start: "2026-02-01T00:00:00Z", n: 0 },
      { start: "2026-02-02T00:00:00Z", n: 7 },
      { start: "2026-02-03T00:00:00Z", n: 0 },
    ]);
    expect(completeness).toMatchObject({ state: "complete", total: 7 });
  });

  /** @scenario "A query with no window gets no report" */
  it("sends no report for a statement that does not follow the period", async () => {
    const { executor, result } = run({ sql: UNWINDOWED_SQL, answers: [[{ n: 1 }]] });

    expect(await result).not.toHaveProperty("completeness");
    expect(executor.requests).toHaveLength(1);
  });

  /** @scenario "A query over a rollup view gets no report" */
  it("sends no report for a statement over a rollup view", async () => {
    const { executor, result } = run({ sql: ROLLUP_SQL, answers: [[{ n: 1 }]] });

    expect(await result).not.toHaveProperty("completeness");
    expect(executor.requests).toHaveLength(1);
  });

  /** @scenario "A failed report leaves the result without completeness" */
  it("returns the rows without completeness when the report fails", async () => {
    const { result } = run({
      sql: COST_SQL,
      answers: [[{ cost: 2 }], new Error("report timed out")],
    });

    const answer = await result;

    expect(answer.rows).toEqual([{ cost: 2 }]);
    expect(answer).not.toHaveProperty("completeness");
  });

  /** @scenario "A refused statement sends no report query" */
  it("sends no report when the statement's result is refused", async () => {
    const { executor, result } = run({
      sql: COST_SQL,
      maxResultBytes: 4,
      answers: [[{ cost: 123_456 }]],
    });

    await expect(result).rejects.toMatchObject({ code: "lwql_result_too_large" });
    expect(executor.requests).toHaveLength(1);
  });
});
