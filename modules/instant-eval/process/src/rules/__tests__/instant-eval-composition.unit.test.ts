/**
 * The run's own share of its reads: the parameter names it reserves, the key
 * columns it pages by, and how wide a sample is spread.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import {
  LWQL_PASS_AFTER_SPAN_PARAMETER,
  LWQL_PASS_AFTER_TRACE_PARAMETER,
  LWQL_PASS_SAMPLE_BUCKET_PARAMETER,
} from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_PAGE_PARAMETER,
  instantEvalSampleBuckets,
  isInstantEvalReservedParameter,
} from "../instant-eval-composition.rules.ts";

describe("given a selection to sample", () => {
  describe("when the bucket count is chosen", () => {
    it("draws one row in every total-over-limit", () => {
      expect(instantEvalSampleBuckets({ total: 10_000, limit: 50 })).toBe(200);
      expect(instantEvalSampleBuckets({ total: 500, limit: 50 })).toBe(10);
    });

    /** @scenario "A selection only just larger than the sample is still spread" */
    it("never uses one bucket for a selection larger than the sample", () => {
      expect(instantEvalSampleBuckets({ total: 75, limit: 50 })).toBe(2);
      expect(instantEvalSampleBuckets({ total: 51, limit: 50 })).toBe(2);
      expect(instantEvalSampleBuckets({ total: 99, limit: 50 })).toBe(2);
      expect(instantEvalSampleBuckets({ total: 100, limit: 50 })).toBe(2);
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
});

describe("given a parameter name", () => {
  describe("when the run is asked whether it owns it", () => {
    /** @scenario "A request supplying a reserved run parameter is refused" */
    it("owns the page, cursor and bucket parameters", () => {
      expect(isInstantEvalReservedParameter(INSTANT_EVAL_PAGE_PARAMETER)).toBe(true);
      expect(isInstantEvalReservedParameter(LWQL_PASS_AFTER_TRACE_PARAMETER)).toBe(true);
      expect(isInstantEvalReservedParameter(LWQL_PASS_AFTER_SPAN_PARAMETER)).toBe(true);
      expect(isInstantEvalReservedParameter(LWQL_PASS_SAMPLE_BUCKET_PARAMETER)).toBe(true);
    });

    it("owns nothing else", () => {
      expect(isInstantEvalReservedParameter("customer_id")).toBe(false);
      expect(isInstantEvalReservedParameter("dashboard_context_period_start")).toBe(false);
    });
  });
});
