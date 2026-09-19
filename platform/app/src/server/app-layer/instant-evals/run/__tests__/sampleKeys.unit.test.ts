/**
 * The spread sample: how the estimate and the plan choose which rows to measure.
 *
 * What every case here protects is one property: the fifty rows measured are
 * drawn from across the selection rather than from its start. A head sample
 * priced a real ten thousand conversation run at a fifth of its cost, because
 * a statement's own order correlates with row length.
 *
 * @see ../composition.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER,
  instantEvalSampleBuckets,
  instantEvalSampleKeysSql,
  isInstantEvalReservedParameter,
} from "../composition";

const SQL = `SELECT ConversationId AS ThreadId, argMax(TraceId, OccurredAt) AS TraceId, eval(conversation_bounded(ConversationId, 8000, ''), 'annoyed') AS annoyed
FROM analytics.trace_metrics
GROUP BY ConversationId
ORDER BY ThreadId`;

describe("given a selection to sample", () => {
  describe("when the sample statement is composed", () => {
    /** @scenario "The sampled rows are spread across the selection, not taken from its start" */
    it("draws its rows from across the whole selection", () => {
      const sql = instantEvalSampleKeysSql({
        sql: SQL,
        keyColumns: ["ThreadId"],
        limit: 50,
      });

      // A bucket predicate over a hash of the key, which is what spreads the
      // sample: the alternative, reading the whole key list to take every Nth,
      // is the read the count pass exists to avoid.
      expect(sql).toContain(
        `cityHash64(q.TraceId) % {${INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER}:UInt64} = 0`,
      );
      expect(sql).toContain("LIMIT 50");
    });

    /** @scenario "The sampled rows are spread across the selection, not taken from its start" */
    it("is not the first rows the statement returns", () => {
      const sample = instantEvalSampleKeysSql({
        sql: SQL,
        keyColumns: ["ThreadId"],
        limit: 50,
      });

      // The distinguishing feature against a head read: a predicate that
      // rejects rows. Ordering alone would hand back the lowest keys.
      expect(sample).toContain("WHERE");
      expect(sample).toContain("cityHash64");
    });

    it("leaves the caller's statement character for character", () => {
      const sql = instantEvalSampleKeysSql({
        sql: SQL,
        keyColumns: ["ThreadId"],
        limit: 50,
      });

      expect(sql).toContain(SQL);
    });

    it("projects only the key columns the statement offers", () => {
      const sql = instantEvalSampleKeysSql({
        sql: SQL,
        keyColumns: ["ThreadId"],
        limit: 50,
      });

      expect(sql).toContain("q.TraceId AS TraceId");
      expect(sql).toContain("q.ThreadId AS ThreadId");
      expect(sql).not.toContain("SpanId");
    });
  });

  describe("when the bucket count is chosen", () => {
    it("draws one row in every total-over-limit", () => {
      expect(instantEvalSampleBuckets({ total: 10_000, limit: 50 })).toBe(200);
      expect(instantEvalSampleBuckets({ total: 500, limit: 50 })).toBe(10);
    });

    /** @scenario "A selection smaller than the sample has every row sampled" */
    it("takes every row when the selection is no larger than the sample", () => {
      expect(instantEvalSampleBuckets({ total: 10, limit: 50 })).toBe(1);
      expect(instantEvalSampleBuckets({ total: 50, limit: 50 })).toBe(1);
      expect(instantEvalSampleBuckets({ total: 0, limit: 50 })).toBe(1);
    });

    it("never divides by zero buckets", () => {
      expect(instantEvalSampleBuckets({ total: 10_000, limit: 0 })).toBe(1);
    });
  });

  describe("when the run is asked whether it owns the bucket parameter", () => {
    it("owns it, so a caller's own parameter cannot collide with it", () => {
      expect(
        isInstantEvalReservedParameter(INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER),
      ).toBe(true);
    });
  });
});
