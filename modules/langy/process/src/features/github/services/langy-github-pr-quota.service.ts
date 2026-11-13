import { nowInstant } from "@langwatch/time";

import type { LangyPullRequestRepository } from "../../../repositories/langy-pull-request.repository.ts";

/**
 * Per-user daily cap on PRs Langy may open on the user's behalf.
 * Issue #4747. Spec: specs/langy/langy-github-prs.feature.
 */
export const LANGY_GITHUB_PRS_PER_DAY = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

type GithubPrUsage = {
  allowed: boolean;
  remaining: number;
  /** When the day rolls over (epoch ms, UTC midnight). */
  resetAt: number;
};

/**
 * Counts the pull requests Langy opened for a person today, from the read model of each one
 * opening. The cap is soft (dev/docs/ARCHITECTURE.md §3, "Every limit is soft"): a turn admitted
 * under it may open more than one pull request before its answer is folded, and a sick read allows.
 */
export class LangyGithubPrQuotaService {
  static create(options: {
    pullRequests: Pick<LangyPullRequestRepository, "countOpenedSince">;
  }): LangyGithubPrQuotaService {
    return new LangyGithubPrQuotaService(options.pullRequests);
  }

  private constructor(
    private readonly pullRequests: Pick<LangyPullRequestRepository, "countOpenedSince">,
  ) {}

  /** How many pull requests the person may still open today. Fails open when unreadable. */
  async usage({
    userId,
    limit = LANGY_GITHUB_PRS_PER_DAY,
  }: {
    userId: string;
    limit?: number;
  }): Promise<GithubPrUsage> {
    const dayStart = Math.floor(nowInstant().epochMilliseconds / DAY_MS) * DAY_MS;
    const resetAt = dayStart + DAY_MS;
    let count: number;
    try {
      count = await this.pullRequests.countOpenedSince({ userId, since: dayStart });
    } catch {
      return { allowed: true, remaining: limit, resetAt };
    }
    return { allowed: count < limit, remaining: Math.max(0, limit - count), resetAt };
  }
}
