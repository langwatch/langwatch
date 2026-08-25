/**
 * Retry-chain invariants.
 *
 * These do not test a behaviour so much as pin relationships BETWEEN constants
 * that are defined in different files and have no compiler-enforced link. Each
 * one here has already been violated in practice:
 *
 *   - the group attempt counter's TTL was derived from `activeTtlSec * 2`,
 *     which happens to equal `maxBackoffMs`, so from roughly attempt 12 the
 *     counter expired during the backoff, the retry read as a fresh delivery,
 *     and the fold re-applied the batch it had already folded.
 * A test that asserted the specific numbers would just restate them. These
 * assert the RELATIONSHIP, so raising one constant fails here rather than in
 * production.
 */
import { describe, expect, it } from "vitest";
import { GROUP_ATTEMPT_TTL_SECONDS } from "../groupQueue";
import { getBackoffMs, JOB_RETRY_CONFIG } from "../retry";

describe("retry chain invariants", () => {
  describe("the group attempt counter", () => {
    it("outlives the longest single backoff, since it is only refreshed on retry", () => {
      // It is re-set on every retry, so it has to survive one backoff — but the
      // longest one, not a typical one. Equality is not enough: the counter
      // expiring exactly as the retry arrives is the bug this replaces.
      const longestBackoffSeconds = JOB_RETRY_CONFIG.maxBackoffMs / 1000;

      expect(GROUP_ATTEMPT_TTL_SECONDS).toBeGreaterThan(longestBackoffSeconds);
    });

    it("outlives the longest backoff the schedule can actually produce", () => {
      const longestScheduled = Math.max(
        ...Array.from({ length: JOB_RETRY_CONFIG.maxAttempts }, (_, index) =>
          getBackoffMs(index + 1),
        ),
      );

      expect(GROUP_ATTEMPT_TTL_SECONDS * 1000).toBeGreaterThan(longestScheduled);
    });
  });
});
