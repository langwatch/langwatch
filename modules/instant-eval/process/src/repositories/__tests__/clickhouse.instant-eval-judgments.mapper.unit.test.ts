/**
 * How a judgement is addressed on the way out: the cursor, the split between
 * what a WHERE can read and what only a HAVING can, and the row shape.
 * @see modules/instant-eval/specs/instant-eval-api.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  decodeInstantEvalCursor,
  encodeInstantEvalCursor,
  judgmentsPageRead,
  judgmentsSampleRead,
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
  SpanId: "",
  LatestThreadId: "thread-a",
  LatestKind: "category",
  LatestStatus: "judged",
  LatestPassed: null,
  LatestScore: null,
  LatestLabel: "annoyed",
  LatestProbability: 0.91,
  LatestProbabilities: JSON.stringify({ annoyed: 0.91, calm: 0.09 }),
  LatestError: "",
  LatestOccurredAt: "2026-09-18T10:00:00Z",
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
      const judged = toJudgment(
        row({ LatestKind: "boolean", LatestPassed: 1, LatestLabel: "", LatestError: "" }),
      );

      expect(judged.passed).toBe(true);
      expect(judged.label).toBeNull();
      expect(judged.error).toBeNull();
    });

    it("reads a status the table does not know as failed rather than trusting it", () => {
      expect(toJudgment(row({ LatestStatus: "maybe" })).status).toBe("failed");
      expect(toJudgment(row({ LatestStatus: "skipped" })).status).toBe("skipped");
    });
  });
});

describe("given a narrowed page of judgements", () => {
  describe("when its read is built", () => {
    it("is a single-tenant reader read with the tenant setting", () => {
      const statement = judgmentsPageRead(query({}));

      expect(statement).toMatchObject({
        identity: "reader",
        kind: "tenant",
        tenantId: "project-1",
      });
      expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      expect(statement.sql).toContain(
        "FROM instant_eval_judgments WHERE TenantId = {tenantId:String}",
      );
    });

    it("puts a sort-key filter in the WHERE, where the index reads it", () => {
      const { sql, params } = judgmentsPageRead(
        query({ questionId: "mood", traceIds: ["trace-a"] }),
      );
      const [where] = sql.split(" GROUP BY ");

      expect(where).toMatch(/QuestionId = \{v\d+:String\}/);
      expect(where).toMatch(/TraceId IN \(\{v\d+:Array\(String\)\}\)/);
      expect(sql).not.toContain("HAVING");
      expect(Object.values(params)).toEqual(expect.arrayContaining(["mood", ["trace-a"]]));
    });

    it("puts a verdict filter in the HAVING, because the verdict is the group's", () => {
      const matched = judgmentsPageRead(query({ matched: true, status: "judged" }));
      const unmatched = judgmentsPageRead(query({ matched: false }));

      const [, matchedHaving] = matched.sql.split(" HAVING ");
      expect(matchedHaving).toMatch(/argMax\(Status, UpdatedAt\) = \{v\d+:String\}/);
      expect(matchedHaving).toMatch(
        /\(argMax\(Passed, UpdatedAt\) = \{v\d+:UInt8\} OR \(argMax\(Kind, UpdatedAt\) != \{v\d+:String\} AND argMax\(Status, UpdatedAt\) = \{v\d+:String\}\)\)/,
      );
      const [, unmatchedHaving] = unmatched.sql.split(" HAVING ");
      expect(unmatchedHaving).toMatch(/^\(NOT \(\(argMax\(Passed, UpdatedAt\)/);
    });

    it("carries the cursor as the three-part comparison the sort key orders by", () => {
      const cursor = encodeInstantEvalCursor({
        traceId: "trace-a",
        spanId: "span-1",
        questionId: "mood",
      });

      const { sql, params } = judgmentsPageRead(query({ cursor }));

      expect(sql).toMatch(
        /tuple\(TraceId, SpanId, QuestionId\) > tuple\(\{v\d+:String\}, \{v\d+:String\}, \{v\d+:String\}\)/,
      );
      expect(Object.values(params)).toEqual(expect.arrayContaining(["trace-a", "span-1", "mood"]));
    });

    it("ignores a cursor that is not one of ours rather than refusing the page", () => {
      expect(judgmentsPageRead(query({ cursor: "not-a-cursor" })).sql).not.toContain("tuple(");
    });
  });
});

describe("given a sample of a run's traces", () => {
  describe("when its read is built", () => {
    it("picks the traces by the seeded hash under the same tenant, matched first when asked", () => {
      const statement = judgmentsSampleRead({
        ...WINDOW,
        traces: 3,
        seed: 7,
        shouldPreferMatched: true,
      });

      expect(statement).toMatchObject({
        identity: "reader",
        kind: "tenant",
        tenantId: "project-1",
      });
      expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      const [sample, outer] = statement.sql.split(") SELECT ");
      expect(sample).toContain("WHERE TenantId = {tenantId:String}");
      expect(sample).toMatch(
        /ORDER BY max\(Passed\) DESC, cityHash64\(TraceId, \{v\d+:UInt64\}\) ASC LIMIT 3$/,
      );
      expect(outer).toContain("WHERE TenantId = {tenantId:String}");
      expect(outer).toContain("TraceId IN sampled");
    });
  });
});
