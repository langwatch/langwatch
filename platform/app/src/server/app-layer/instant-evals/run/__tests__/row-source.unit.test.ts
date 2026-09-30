/**
 * The two things the row source does to a result before anyone reads it.
 *
 * It refuses a truncated one, because every read here is a read whose length
 * is part of the answer; and it drops the rows a page does not own, because
 * the page predicate can only name a trace while the page may be keyed by the
 * trace and the span.
 *
 * @see ../row-source.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { LangWatchQLExecutionResult } from "~/server/analytics/lwql";
import {
  createInstantEvalRowSource,
  InstantEvalResultTruncatedError,
  type InstantEvalRowKey,
} from "../row-source";
import { instantEvalOwnedRows } from "../row-source.passes";

const CALLER = { id: "project-1", lwqlKey: "lwql-secret" };
const SQL = "SELECT TraceId, eval(x, 'y') AS annoyed FROM analytics.traces";

function execution(
  overrides: Partial<LangWatchQLExecutionResult> = {},
): LangWatchQLExecutionResult {
  return {
    columns: [{ name: "TraceId", type: "String" }],
    rows: [{ TraceId: "t1" }],
    statistics: { elapsedMs: 1, rowsRead: 1, bytesRead: 1, rowsReturned: 1 },
    ...overrides,
  };
}

function sourceOver(result: LangWatchQLExecutionResult) {
  return createInstantEvalRowSource({
    executor: { execute: vi.fn(async () => result) },
    traceSource: {} as never,
  });
}

function key(traceId: string, spanId = ""): InstantEvalRowKey {
  return { traceId, threadId: "", spanId, occurredAt: null };
}

describe("given a read that came back longer than the pass bounded it to", () => {
  describe("when the count pass reads it", () => {
    /** @scenario "A read that came back truncated fails the step" */
    it("refuses it rather than reporting a smaller total", async () => {
      // The count pass asks for one row; two means the bound did not hold.
      const source = sourceOver(
        execution({ rows: [{ total: 12 }, { total: 13 }] }),
      );

      await expect(
        source.count({ caller: CALLER, sql: SQL, limit: 10_001 }),
      ).rejects.toBeInstanceOf(InstantEvalResultTruncatedError);
    });
  });

  describe("when the key pass reads it", () => {
    /** @scenario "A read that came back truncated fails the step" */
    it("refuses it rather than serving a shorter page", async () => {
      // The key pass asks for one row past the page so it can see whether
      // another follows; more than that means the read outgrew its bound.
      const source = sourceOver(
        execution({
          rows: [...Array(502).keys()].map((index) => ({
            TraceId: `t${index}`,
          })),
        }),
      );

      await expect(
        source.keys({
          caller: CALLER,
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
      const source = sourceOver(execution({ rows: [{ total: "4211" }] }));

      await expect(
        source.count({ caller: CALLER, sql: SQL, limit: 10_001 }),
      ).resolves.toBe(4211);
    });
  });

  describe("when the selection is empty", () => {
    it("reads zero rather than refusing", async () => {
      const source = sourceOver(execution({ rows: [] }));

      await expect(
        source.count({ caller: CALLER, sql: SQL, limit: 10_001 }),
      ).resolves.toBe(0);
    });
  });
});

describe("given a page read that brought back a neighbour's rows", () => {
  describe("when the page is keyed by the trace and the span", () => {
    /** @scenario "A page drops the rows of a trace it shares with the next page" */
    it("keeps only the pairs the page owns", () => {
      const owned = instantEvalOwnedRows({
        rows: [
          { TraceId: "t1", SpanId: "s1" },
          { TraceId: "t1", SpanId: "s2" },
          // The same trace, a span the next page owns: the predicate could
          // only name the trace, so this row arrived and is not ours.
          { TraceId: "t1", SpanId: "s3" },
        ],
        keys: [key("t1", "s1"), key("t1", "s2")],
      });

      expect(owned).toEqual([
        { TraceId: "t1", SpanId: "s1" },
        { TraceId: "t1", SpanId: "s2" },
      ]);
    });
  });

  describe("when the page is keyed by the trace alone", () => {
    it("keeps every row of a named trace", () => {
      const owned = instantEvalOwnedRows({
        rows: [
          { TraceId: "t1", annoyed: 0.9 },
          { TraceId: "t2", annoyed: 0.1 },
          { TraceId: "t3", annoyed: 0.5 },
        ],
        keys: [key("t1"), key("t2")],
      });

      expect(owned.map((row) => row.TraceId)).toEqual(["t1", "t2"]);
    });
  });
});
