/**
 * Pin relationships between retry-chain constants defined in separate files with no
 * compiler-enforced link; past violations of these invariants led to delivery duplication.
 */
import { HISTOGRAM_BOUNDARIES } from "@langwatch/observability/metrics";
import { describe, expect, it } from "vitest";

import { GROUP_ATTEMPT_TTL_SECONDS, getBackoffMs, JOB_RETRY_CONFIG } from "../groupQueue.ts";

describe("retry chain invariants", () => {
  describe("given the group attempt counter", () => {
    it("outlives the longest single backoff, since it is only refreshed on retry", () => {
      // It is re-set on every retry, so it has to survive one backoff — but the
      // longest one, not a typical one. Equality is not enough: the counter
      // expiring exactly as the retry arrives is the bug this replaces.
      const longestBackoffSeconds = JOB_RETRY_CONFIG.maxBackoffMs / 1000;

      expect(GROUP_ATTEMPT_TTL_SECONDS).toBeGreaterThan(longestBackoffSeconds);
    });

    it("outlives the longest backoff the schedule can actually produce", () => {
      const longestScheduled = Math.max(
        ...Array.from({ length: JOB_RETRY_CONFIG.maxOverloadedAttempts }, (_, index) =>
          getBackoffMs(index + 1),
        ),
      );

      expect(GROUP_ATTEMPT_TTL_SECONDS * 1000).toBeGreaterThan(longestScheduled);
    });
  });

  describe("given the retry histograms", () => {
    const top = (name: keyof typeof HISTOGRAM_BOUNDARIES) => HISTOGRAM_BOUNDARIES[name].at(-1) ?? 0;

    it("buckets the longest backoff the schedule produces below +Inf", () => {
      expect(top("gq_retry_backoff_milliseconds")).toBeGreaterThanOrEqual(
        JOB_RETRY_CONFIG.maxBackoffMs,
      );
    });

    it("buckets every attempt up to the overload budget below +Inf", () => {
      expect(top("gq_retry_attempt")).toBeGreaterThanOrEqual(
        JOB_RETRY_CONFIG.maxOverloadedAttempts,
      );
    });

    it("buckets a job delay of hours below +Inf", () => {
      expect(top("gq_job_delay_milliseconds")).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
    });
  });
});
