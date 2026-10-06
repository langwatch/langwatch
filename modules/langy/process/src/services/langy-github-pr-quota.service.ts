import { nowInstant } from "@langwatch/time";

import type { LangyGithubPrCountRepository } from "../repositories/langy-github-pr-count.repository.ts";

/**
 * Per-user daily cap on PRs Langy may open on the user's behalf.
 * Issue #4747. Spec: specs/langy/langy-github-prs.feature.
 */
export const LANGY_GITHUB_PRS_PER_DAY = 20;

export type GithubPrLimitResult = {
  allowed: boolean;
  remaining: number;
  /** When the day-bucket rolls over (epoch ms). */
  resetAt: number;
  /**
   * True only when a real `INCR` actually committed to Redis under this call. Read-only
   * `getLangyGithubPrUsage` always returns `false` (no INCR ran).
   */
  reserved: boolean;
};

function dayBucket(now = nowInstant().epochMilliseconds): number {
  return Math.floor(now / (24 * 60 * 60 * 1000));
}

function resetAtForBucket(bucket: number): number {
  return (bucket + 1) * 24 * 60 * 60 * 1000;
}

const bucketKey = (userId: string, bucket: number) => `langy:gh:prs:${userId}:${bucket}`;

/** The answer where there is no counter, or the counter could not be read: allowed, untouched. */
function openResult(limit: number, bucket = dayBucket()): GithubPrLimitResult {
  return { allowed: true, remaining: limit, resetAt: resetAtForBucket(bucket), reserved: false };
}

/** Spends and refunds the per-user daily GitHub PR permit. */
export class LangyGithubPrQuotaService {
  static create(options: { counts: LangyGithubPrCountRepository }): LangyGithubPrQuotaService {
    return new LangyGithubPrQuotaService(options.counts);
  }

  private constructor(private readonly counts: LangyGithubPrCountRepository) {}

  /** Check-only — does NOT increment. Fails open when the counter cannot be read. */
  async usage({
    userId,
    limit = LANGY_GITHUB_PRS_PER_DAY,
  }: {
    userId: string;
    limit?: number;
  }): Promise<GithubPrLimitResult> {
    const bucket = dayBucket();
    let count: number;
    try {
      count = await this.counts.count(bucketKey(userId, bucket));
    } catch {
      return openResult(limit, bucket);
    }
    return {
      allowed: count < limit,
      remaining: Math.max(0, limit - count),
      resetAt: resetAtForBucket(bucket),
      reserved: false,
    };
  }

  /**
   * Counts one PR after it is observed in the assistant reply, answering the post-increment usage
   * so the caller can soft-warn near the cap. Fails open: chat must not break on a sick counter.
   */
  async record({
    userId,
    limit = LANGY_GITHUB_PRS_PER_DAY,
  }: {
    userId: string;
    limit?: number;
  }): Promise<GithubPrLimitResult> {
    const bucket = dayBucket();
    let count: number;
    try {
      count = await this.counts.add({ key: bucketKey(userId, bucket), amount: 1 });
    } catch {
      return openResult(limit, bucket);
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: resetAtForBucket(bucket),
      reserved: true,
    };
  }

  /** EXTRA increments when one turn opens more PRs than the one permit it held. Best-effort. */
  async recordExtra({ userId, extra }: { userId: string; extra: number }): Promise<void> {
    if (extra <= 0) return;
    await this.counts
      .add({ key: bucketKey(userId, dayBucket()), amount: extra })
      .catch(() => undefined);
  }

  /**
   * Atomically reserve a per-turn PR permit BEFORE handing the worker the GitHub token. An
   * increment that never committed has nothing to undo; one past the cap is taken back (a failed
   * take-back leaves the count inflated for the day, which still denies correctly).
   */
  async reservePermit({
    userId,
    limit = LANGY_GITHUB_PRS_PER_DAY,
  }: {
    userId: string;
    limit?: number;
  }): Promise<GithubPrLimitResult> {
    const bucket = dayBucket();
    // No counter: allowing keeps GitHub PRs working, and no reservation means none to release.
    const key = bucketKey(userId, bucket);
    let count: number;
    try {
      count = await this.counts.add({ key, amount: 1 });
    } catch {
      return openResult(limit, bucket);
    }
    if (count > limit) {
      await this.counts.takeBack(key).catch(() => undefined);
      return { allowed: false, remaining: 0, resetAt: resetAtForBucket(bucket), reserved: false };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      resetAt: resetAtForBucket(bucket),
      reserved: true,
    };
  }

  /**
   * Release a reserved permit when the turn opened no PR. Best-effort fairness, not a correctness
   * boundary: the reservation expires with its bucket anyway.
   */
  async releasePermit({ userId }: { userId: string }): Promise<void> {
    if (!this.counts) return;
    await this.counts.release(bucketKey(userId, dayBucket())).catch(() => undefined);
  }
}
