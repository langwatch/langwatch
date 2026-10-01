/**
 * Pin relationships between retry-chain constants defined in separate files with no
 * compiler-enforced link; past violations of these invariants led to delivery duplication.
 */
import { describe, expect, it } from "vitest";

import { GROUP_ATTEMPT_TTL_SECONDS } from "../groupQueue.ts";
import { getBackoffMs, JOB_RETRY_CONFIG } from "../retry.ts";

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
        ...Array.from({ length: JOB_RETRY_CONFIG.maxAttempts }, (_, index) =>
          getBackoffMs(index + 1),
        ),
      );

      expect(GROUP_ATTEMPT_TTL_SECONDS * 1000).toBeGreaterThan(longestScheduled);
    });
  });
});
