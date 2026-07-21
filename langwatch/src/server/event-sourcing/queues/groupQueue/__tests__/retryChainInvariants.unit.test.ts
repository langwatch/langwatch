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
 *   - `MAX_APPLIED_EVENT_IDS` was picked from the fold coalesce ceiling by
 *     eye; nothing stops that ceiling being raised past it, which would
 *     silently start dropping ids that a redelivery still needs.
 *
 * A test that asserted the specific numbers would just restate them. These
 * assert the RELATIONSHIP, so raising one constant fails here rather than in
 * production.
 */
import { describe, expect, it } from "vitest";
import { MAX_APPLIED_EVENT_IDS } from "../../../projections/foldCache/foldCacheEntry";
import { DEFAULT_FOLD_COALESCE_MAX_BATCH } from "../../../projections/projectionRouter";
import { getBackoffMs, JOB_RETRY_CONFIG } from "../../shared";
import { GROUP_ATTEMPT_TTL_SECONDS } from "../groupQueue";

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

  describe("the applied-event-id cap", () => {
    it("covers at least a full coalesced batch", () => {
      // A redelivery re-sends a whole batch. A cap below the coalesce ceiling
      // would drop ids the redelivery still needs, and the fold would re-apply
      // them — silently, because dropping is not an error.
      expect(MAX_APPLIED_EVENT_IDS).toBeGreaterThanOrEqual(
        DEFAULT_FOLD_COALESCE_MAX_BATCH,
      );
    });

    it("leaves headroom for a batch re-formed with new arrivals", () => {
      // A retry does not redeliver the original batch verbatim: siblings are
      // re-staged at their original scores and new events arrive alongside, so
      // the chain's distinct-event count exceeds one batch.
      expect(MAX_APPLIED_EVENT_IDS).toBeGreaterThan(
        DEFAULT_FOLD_COALESCE_MAX_BATCH,
      );
    });
  });
});
