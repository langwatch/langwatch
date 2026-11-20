/**
 * `eval_results` rows on the way in and out: the inserts a batch is split into, the recalled
 * and the trace read's row shapes, and both reads' bound parameters.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import { describe, expect, it } from "vitest";

import {
  EVAL_RESULTS_MAX_WEEKS_PER_INSERT,
  evalResultsInsertBatches,
  evalResultsRecallParameters,
  evalResultsTraceParameters,
  evalResultsWeekOf,
  evalTraceResultRowSchema,
  toEvalResultValues,
  toEvalTraceResult,
  toRecalledEvalResult,
} from "../clickhouse/clickhouse.eval-results.mapper.ts";
import type { EvalResultRecord } from "../eval-results.repository.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SUNDAY = Date.UTC(2026, 10, 1);

function record(overrides: Partial<EvalResultRecord> = {}): EvalResultRecord {
  return {
    TenantId: "project-1",
    TraceId: "trace-1",
    SpanId: "",
    QuestionHash: "question-hash",
    Question: "Is the customer annoyed?",
    Kind: "boolean",
    JudgeModel: "langwatch/instant-evals",
    InputHash: "input-hash",
    JudgedColumn: "llm_readable_trace",
    KeyVersion: 1,
    Source: "ask",
    SourceId: "query:1",
    Status: "judged",
    Score: null,
    Label: "",
    Probability: 0.9,
    Probabilities: "",
    Error: "",
    OccurredAt: SUNDAY,
    JudgedAt: SUNDAY + 1_000,
    UpdatedAt: SUNDAY + 1_000,
    _retention_days: 30,
    ...overrides,
  };
}

describe("evalResultsWeekOf", () => {
  it("starts a week on Sunday, as toYearWeek does", () => {
    const saturday = SUNDAY - 1;

    expect(evalResultsWeekOf(SUNDAY)).toBe(evalResultsWeekOf(SUNDAY + 6 * 24 * 60 * 60 * 1000));
    expect(evalResultsWeekOf(saturday)).toBe(evalResultsWeekOf(SUNDAY) - 1);
  });
});

describe("evalResultsInsertBatches", () => {
  describe("given results on traces from more than one hundred different weeks", () => {
    /** @scenario "One insert spans at most one hundred trace weeks" */
    it("splits them into inserts of at most one hundred weeks each, keeping every row", () => {
      const weeks = EVAL_RESULTS_MAX_WEEKS_PER_INSERT + 5;
      const records = Array.from({ length: weeks }, (_, index) =>
        record({ TraceId: `trace-${index}`, OccurredAt: SUNDAY - index * WEEK_MS }),
      );

      const batches = evalResultsInsertBatches([...records, record({ TraceId: "same-week" })]);

      expect(batches.map((batch) => batch.length)).toEqual([EVAL_RESULTS_MAX_WEEKS_PER_INSERT, 6]);
      for (const batch of batches) {
        const spanned = new Set(batch.map((row) => evalResultsWeekOf(row.OccurredAt)));
        expect(spanned.size).toBeLessThanOrEqual(EVAL_RESULTS_MAX_WEEKS_PER_INSERT);
      }
    });

    it("sends nothing for no rows", () => {
      expect(evalResultsInsertBatches([])).toEqual([]);
    });
  });
});

describe("toEvalResultValues", () => {
  it("hands the driver dates for every time column and keeps the rest as written", () => {
    const values = toEvalResultValues(record());

    expect(values.OccurredAt).toEqual(new Date(SUNDAY));
    expect(values.JudgedAt).toEqual(new Date(SUNDAY + 1_000));
    expect(values).toMatchObject({ Probability: 0.9, KeyVersion: 1, _retention_days: 30 });
  });
});

describe("toRecalledEvalResult", () => {
  it("reads quoted epoch milliseconds, an empty label as none, and a distribution", () => {
    expect(
      toRecalledEvalResult({
        TraceId: "trace-1",
        SpanId: "",
        QuestionHash: "question-hash",
        InputHash: "input-hash",
        LatestSourceId: "run-1",
        Score: null,
        Label: "",
        Probability: null,
        Probabilities: JSON.stringify({ refund: 0.7, billing: 0.3 }),
        LatestJudgedAt: "1762000000000",
        LatestUpdatedAt: 1762000000001,
      }),
    ).toEqual({
      traceId: "trace-1",
      spanId: "",
      questionHash: "question-hash",
      inputHash: "input-hash",
      sourceId: "run-1",
      score: null,
      label: null,
      probability: null,
      probabilities: { refund: 0.7, billing: 0.3 },
      judgedAt: 1762000000000,
      updatedAt: 1762000000001,
    });
  });
});

describe("evalResultsRecallParameters", () => {
  it("binds the tenant, the window and each key column as a distinct set, judged rows only", () => {
    const key = { traceId: "trace-1", spanId: "", questionHash: "q", inputHash: "i" };

    expect(
      evalResultsRecallParameters({
        tenantId: "project-1",
        judgeModel: "langwatch/instant-evals",
        keyVersion: 1,
        keys: [key, { ...key, inputHash: "j" }],
        occurredFrom: SUNDAY,
        occurredUntil: SUNDAY + WEEK_MS,
      }),
    ).toEqual({
      tenantId: "project-1",
      occurredFrom: new Date(SUNDAY),
      occurredUntil: new Date(SUNDAY + WEEK_MS),
      traceIds: ["trace-1"],
      spanIds: [""],
      questionHashes: ["q"],
      inputHashes: ["i", "j"],
      judgeModel: "langwatch/instant-evals",
      keyVersion: 1,
      status: "judged",
    });
  });
});

describe("toEvalTraceResult", () => {
  const row = {
    SpanId: "span-1",
    QuestionHash: "question-hash",
    JudgedColumn: "output",
    LatestQuestion: "Is the customer annoyed?",
    LatestKind: "boolean",
    LatestStatus: "judged",
    LatestProbability: 0.8,
    LatestScore: null,
    LatestLabel: "",
    LatestJudgeModel: "langwatch/instant-evals",
    LatestSource: "dashboard",
    LatestSourceId: "widget-1",
    LatestJudgedAt: "1762000000000",
    LatestUpdatedAt: 1762000000001,
  };

  it("reads quoted epoch milliseconds and an empty label as none", () => {
    expect(toEvalTraceResult(evalTraceResultRowSchema.parse(row))).toEqual({
      spanId: "span-1",
      questionHash: "question-hash",
      judgedColumn: "output",
      question: "Is the customer annoyed?",
      kind: "boolean",
      status: "judged",
      probability: 0.8,
      score: null,
      label: null,
      judgeModel: "langwatch/instant-evals",
      source: "dashboard",
      sourceId: "widget-1",
      judgedAt: 1762000000000,
      updatedAt: 1762000000001,
    });
  });

  it("refuses a row whose status or source the table does not know", () => {
    expect(() => evalTraceResultRowSchema.parse({ ...row, LatestStatus: "maybe" })).toThrow();
    expect(() => evalTraceResultRowSchema.parse({ ...row, LatestSource: "cron" })).toThrow();
  });
});

describe("evalResultsTraceParameters", () => {
  it("binds the tenant, the trace, the window and the key version, leaving monitors out", () => {
    expect(
      evalResultsTraceParameters({
        tenantId: "project-1",
        traceId: "trace-1",
        keyVersion: 1,
        occurredFrom: SUNDAY,
        occurredUntil: SUNDAY + WEEK_MS,
      }),
    ).toEqual({
      tenantId: "project-1",
      traceId: "trace-1",
      occurredFrom: new Date(SUNDAY),
      occurredUntil: new Date(SUNDAY + WEEK_MS),
      keyVersion: 1,
      judged: "judged",
      monitor: "monitor",
    });
  });
});
