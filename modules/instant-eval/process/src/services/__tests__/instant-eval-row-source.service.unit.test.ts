/**
 * What the row source does to a result before anyone reads it: it refuses a
 * truncated one, because every read here is a read whose length is part of
 * the answer. @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type {
  LangWatchQLExecuteInput,
  LangWatchQLQueryResult,
} from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { instantEvalKeyColumns } from "../../rules/instant-eval-composition.rules.ts";
import {
  InstantEvalResultTruncatedError,
  InstantEvalRowSourceService,
  type InstantEvalStatementRunner,
} from "../instant-eval-row-source.service.ts";

const CALLER = { id: "project-1", lwqlKey: "lwql-secret" };
const PROTECTIONS = { canSeeCapturedInput: true, canSeeCapturedOutput: true };
const SQL = "SELECT TraceId, eval(x, 'y') AS annoyed FROM analytics.traces";

function result(overrides: Partial<LangWatchQLQueryResult> = {}): LangWatchQLQueryResult {
  return {
    columns: [{ name: "TraceId", type: "String" }],
    rows: [{ TraceId: "t1" }],
    statistics: { elapsedMs: 1, rowsRead: 1, bytesRead: 1, rowsReturned: 1 },
    diagnostics: [],
    followsTimeWindow: true,
    followsGranularity: true,
    ...overrides,
  };
}

/** An Analytics peer that records what it was asked and answers one result. */
class RecordingRunner implements InstantEvalStatementRunner {
  readonly asked: LangWatchQLExecuteInput[] = [];

  constructor(private readonly answer: LangWatchQLQueryResult) {}

  async executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> {
    this.asked.push(input);
    return this.answer;
  }
}

function sourceOver(answer: LangWatchQLQueryResult): {
  source: InstantEvalRowSourceService;
  analytics: RecordingRunner;
} {
  const analytics = new RecordingRunner(answer);
  return { source: InstantEvalRowSourceService.create({ analytics }), analytics };
}

describe("given a statement a run is about to read", () => {
  describe("when it is probed", () => {
    /** @scenario "The missing-column check runs the statement for no rows at all" */
    it("asks for the projection without reading a row", async () => {
      const { source, analytics } = sourceOver(result({ rows: [] }));

      const columns = await source.probe({ caller: CALLER, protections: PROTECTIONS, sql: SQL });

      expect(columns).toEqual([{ name: "TraceId", type: "String" }]);
      expect(analytics.asked[0]?.sql).toContain("LIMIT 0");
      expect(analytics.asked[0]?.project).toEqual(CALLER);
    });
  });

  describe("when its key columns are read off the projection", () => {
    it("names only the optional columns the statement projects", () => {
      expect(
        instantEvalKeyColumns([
          { name: "TraceId", type: "String" },
          { name: "SpanId", type: "String" },
          { name: "annoyed", type: "Float64" },
        ]),
      ).toEqual(["SpanId"]);
    });
  });
});

describe("given a read that came back longer than the pass bounded it to", () => {
  describe("when the count pass reads it", () => {
    /** @scenario "A read that came back truncated fails the step" */
    it("refuses it rather than reporting a smaller total", async () => {
      // The count pass asks for one row; two means the bound did not hold.
      const { source } = sourceOver(result({ rows: [{ total: 12 }, { total: 13 }] }));

      await expect(
        source.count({ caller: CALLER, protections: PROTECTIONS, sql: SQL, limit: 10_001 }),
      ).rejects.toBeInstanceOf(InstantEvalResultTruncatedError);
    });
  });

  describe("when the key pass reads it", () => {
    /** @scenario "A read that came back truncated fails the step" */
    it("refuses it rather than serving a shorter page", async () => {
      // The key pass asks for one row past the page so it can see whether
      // another follows; more than that means the read outgrew its bound.
      const { source } = sourceOver(
        result({ rows: [...Array(502).keys()].map((index) => ({ TraceId: `t${index}` })) }),
      );

      await expect(
        source.keys({
          caller: CALLER,
          protections: PROTECTIONS,
          sql: SQL,
          keyColumns: [],
          limit: 500,
        }),
      ).rejects.toBeInstanceOf(InstantEvalResultTruncatedError);
    });
  });
});

describe("given a count that came back whole", () => {
  describe("when ClickHouse rendered it as a string", () => {
    it("reads it as a number", async () => {
      const { source } = sourceOver(result({ rows: [{ total: "4211" }] }));

      await expect(
        source.count({ caller: CALLER, protections: PROTECTIONS, sql: SQL, limit: 10_001 }),
      ).resolves.toBe(4211);
    });
  });

  describe("when the selection is empty", () => {
    it("reads zero rather than refusing", async () => {
      const { source } = sourceOver(result({ rows: [] }));

      await expect(
        source.count({ caller: CALLER, protections: PROTECTIONS, sql: SQL, limit: 10_001 }),
      ).resolves.toBe(0);
    });
  });
});

describe("given a page of keys", () => {
  describe("when the page after a cursor is read", () => {
    /** @scenario "Pass one selects the keys and nothing else" */
    it("binds the cursor and reports that another page follows", async () => {
      const { source, analytics } = sourceOver(
        result({
          rows: [
            { TraceId: "t1", ThreadId: "c1", SpanId: "s1", OccurredAt: "2026-09-18 10:00:00" },
            { TraceId: "t2", ThreadId: "c2", SpanId: "s2", OccurredAt: 1_758_190_000_000 },
          ],
        }),
      );

      const page = await source.keys({
        caller: CALLER,
        protections: PROTECTIONS,
        sql: SQL,
        keyColumns: ["ThreadId", "SpanId", "OccurredAt"],
        limit: 1,
        after: { traceId: "t0", spanId: "s0" },
      });

      expect(page.keys).toEqual([
        {
          traceId: "t1",
          threadId: "c1",
          spanId: "s1",
          occurredAt: Date.parse("2026-09-18T10:00:00Z"),
        },
      ]);
      expect(page.hasMore).toBe(true);
      expect(analytics.asked[0]?.parameters).toMatchObject({
        instant_eval_after_trace_id: "t0",
        instant_eval_after_span_id: "s0",
      });
    });
  });

  describe("when a sample of the selection is read", () => {
    /** @scenario "The sampled rows are spread across the selection, not taken from its start" */
    it("spreads it over buckets rather than taking the head", async () => {
      const { source, analytics } = sourceOver(result({ rows: [{ TraceId: "t1" }] }));

      const keys = await source.sampleKeys({
        caller: CALLER,
        protections: PROTECTIONS,
        sql: SQL,
        keyColumns: [],
        limit: 50,
        total: 5_000,
      });

      expect(keys).toEqual([{ traceId: "t1", threadId: "", spanId: "", occurredAt: null }]);
      expect(analytics.asked[0]?.parameters).toMatchObject({ instant_eval_buckets: 100 });
    });
  });
});
