/**
 * How a judgement is addressed on the way out: the cursor, the split between
 * what a WHERE can read and what only a HAVING can, and the row shape.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  buildFilters,
  decodeInstantEvalCursor,
  encodeInstantEvalCursor,
  type JudgmentRow,
  parseProbabilities,
  toJudgment,
} from "../clickhouse/clickhouse.instant-eval-judgments.mapper.ts";
import type { InstantEvalJudgmentQuery } from "../instant-eval-judgments.repository.ts";

const WINDOW: InstantEvalJudgmentQuery = {
  projectId: "project-1",
  runId: "instanteval_1",
  writtenFrom: Temporal.Instant.from("2026-09-18T09:00:00Z"),
  writtenUntil: Temporal.Instant.from("2026-09-18T11:00:00Z"),
  limit: 100,
};

const query = (overrides: Partial<InstantEvalJudgmentQuery>): InstantEvalJudgmentQuery => ({
  ...WINDOW,
  ...overrides,
});

const row = (overrides: Partial<JudgmentRow> = {}): JudgmentRow => ({
  TraceId: "trace-a",
  QuestionId: "mood",
  ThreadId: "thread-a",
  SpanId: "",
  Kind: "category",
  Status: "judged",
  Passed: null,
  Score: null,
  Label: "annoyed",
  Probability: 0.91,
  Probabilities: JSON.stringify({ annoyed: 0.91, calm: 0.09 }),
  Error: "",
  OccurredAt: "2026-09-18T10:00:00Z",
  ...overrides,
});

describe("given a page's last row", () => {
  describe("when the cursor is written and read back", () => {
    it("carries the three parts of the sort key", () => {
      const cursor = encodeInstantEvalCursor({
        traceId: "trace-a",
        spanId: "span-1",
        questionId: "mood",
      });

      expect(decodeInstantEvalCursor(cursor)).toEqual({
        traceId: "trace-a",
        spanId: "span-1",
        questionId: "mood",
      });
    });

    /** @scenario "Half of the list's cursor is refused, naming the missing half" */
    it("answers with none for a token that is not one of ours", () => {
      expect(decodeInstantEvalCursor("not-a-cursor")).toBeNull();
      expect(
        decodeInstantEvalCursor(Buffer.from('["only","two"]').toString("base64url")),
      ).toBeNull();
    });
  });
});

describe("given the column a category's distribution is stored in", () => {
  describe("when it is read back", () => {
    it("answers numbers, and none for anything that is not a map of them", () => {
      expect(parseProbabilities('{"annoyed":0.91}')).toEqual({ annoyed: 0.91 });
      expect(parseProbabilities("")).toBeNull();
      expect(parseProbabilities("[0.9]")).toBeNull();
      expect(parseProbabilities('{"annoyed":"high"}')).toBeNull();
      expect(parseProbabilities('{"annoyed":')).toBeNull();
    });
  });
});

describe("given a judgement row ClickHouse answered", () => {
  describe("when it is read", () => {
    it("reads the boolean columns as booleans and the empty strings as none", () => {
      const judged = toJudgment(row({ Kind: "boolean", Passed: 1, Label: "", Error: "" }));

      expect(judged.passed).toBe(true);
      expect(judged.label).toBeNull();
      expect(judged.error).toBeNull();
    });

    it("reads a status the table does not know as failed rather than trusting it", () => {
      expect(toJudgment(row({ Status: "maybe" })).status).toBe("failed");
      expect(toJudgment(row({ Status: "skipped" })).status).toBe("skipped");
    });
  });
});

describe("given a narrowed page of judgements", () => {
  describe("when its predicates are built", () => {
    it("puts a sort-key filter in the WHERE, where the index reads it", () => {
      const { where, having, parameters } = buildFilters(
        query({ questionId: "mood", traceIds: ["trace-a"] }),
      );

      expect(where).toEqual([
        "QuestionId = {questionId:String}",
        "TraceId IN ({traceIds:Array(String)})",
      ]);
      expect(having).toEqual([]);
      expect(parameters).toMatchObject({ questionId: "mood", traceIds: ["trace-a"] });
    });

    it("puts a verdict filter in the HAVING, because the verdict is the group's", () => {
      const matched = buildFilters(query({ matched: true, status: "judged" }));
      const unmatched = buildFilters(query({ matched: false }));

      expect(matched.where).toEqual([]);
      expect(matched.having).toEqual([
        "Status = {status:String}",
        "(Passed = 1 OR (Kind != 'boolean' AND Status = 'judged'))",
      ]);
      expect(unmatched.having).toEqual([
        "NOT (Passed = 1 OR (Kind != 'boolean' AND Status = 'judged'))",
      ]);
    });

    it("carries the cursor as the three-part comparison the sort key orders by", () => {
      const cursor = encodeInstantEvalCursor({
        traceId: "trace-a",
        spanId: "span-1",
        questionId: "mood",
      });

      const { where, parameters } = buildFilters(query({ cursor }));

      expect(where).toEqual([
        "(TraceId, SpanId, QuestionId) > ({after:String}, {afterS:String}, {afterQ:String})",
      ]);
      expect(parameters).toMatchObject({ after: "trace-a", afterS: "span-1", afterQ: "mood" });
    });

    it("ignores a cursor that is not one of ours rather than refusing the page", () => {
      expect(buildFilters(query({ cursor: "not-a-cursor" })).where).toEqual([]);
    });
  });
});
