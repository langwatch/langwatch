import { nowInstant } from "@langwatch/time";

import type { LangyGithubPrCountRepository } from "../../../repositories/langy-github-pr-count.repository.ts";

/**
 * Per-user daily cap on PRs Langy may open on the user's behalf.
 * Issue #4747. Spec: specs/langy/langy-github-prs.feature.
 */
export const LANGY_GITHUB_PRS_PER_DAY = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

type GithubPrUsage = {
  allowed: boolean;
  remaining: number;
  /** When the day bucket rolls over (epoch ms). */
  resetAt: number;
};

function dayBucket(at: number): number {
  return Math.floor(at / DAY_MS);
}

function resetAtForBucket(bucket: number): number {
  return (bucket + 1) * DAY_MS;
}

const bucketKey = (userId: string, bucket: number) => `langy:gh:prs-opened:${userId}:${bucket}`;

/**
 * Counts the pull requests Langy opened per person and day, from the fact of each one opening.
 * The cap is soft (dev/docs/ARCHITECTURE.md §3, "Every limit is soft"): a turn admitted under it
 * may open more than one pull request before its answer is counted, and a sick counter allows.
 */
export class LangyGithubPrQuotaService {
  static create(options: { counts: LangyGithubPrCountRepository }): LangyGithubPrQuotaService {
    return new LangyGithubPrQuotaService(options.counts);
  }

  private constructor(private readonly counts: LangyGithubPrCountRepository) {}

  /** How many pull requests the person may still open today. Fails open when unreadable. */
  async usage({
    userId,
    limit = LANGY_GITHUB_PRS_PER_DAY,
  }: {
    userId: string;
    limit?: number;
  }): Promise<GithubPrUsage> {
    const bucket = dayBucket(nowInstant().epochMilliseconds);
    const resetAt = resetAtForBucket(bucket);
    let count: number;
    try {
      count = await this.counts.count(bucketKey(userId, bucket));
    } catch {
      return { allowed: true, remaining: limit, resetAt };
    }
    return { allowed: count < limit, remaining: Math.max(0, limit - count), resetAt };
  }

  /**
   * Counts pull requests a turn opened, in the day they opened. Counting one again is a no-op,
   * so a redelivered answer never counts twice.
   */
  async recordOpened({
    userId,
    pullRequests,
    at,
  }: {
    userId: string;
    pullRequests: readonly string[];
    at: number;
  }): Promise<void> {
    await this.counts.add({ key: bucketKey(userId, dayBucket(at)), pullRequests });
  }
}
