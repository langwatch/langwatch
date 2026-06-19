/**
 * Per-user daily cap on PRs Langy may open on the user's behalf. A safety net
 * against runaway loops or compromised sessions burning through a user's
 * GitHub goodwill (and triggering abuse detection). Cheap Redis counter,
 * fails open when Redis is absent so dev stays usable.
 *
 * Counting model: the manager doesn't currently parse worker tool calls, so
 * the natural place to bump the counter is the control-plane side AFTER a
 * chat reply that contains a github.com PR URL. See LangyMessageService.
 *
 * Issue #4747. Spec: specs/assistant/langy-github-prs.feature.
 */
import { connection } from "../redis";

export const LANGY_GITHUB_PRS_PER_DAY = 20;

export type GithubPrLimitResult = {
  allowed: boolean;
  remaining: number;
  /** When the day-bucket rolls over (epoch ms). */
  resetAt: number;
};

function dayBucket(now = Date.now()): number {
  return Math.floor(now / (24 * 60 * 60 * 1000));
}

function resetAtForBucket(bucket: number): number {
  return (bucket + 1) * 24 * 60 * 60 * 1000;
}

/**
 * Check-only — does NOT increment. Use this BEFORE the worker starts a PR
 * sequence (e.g. in the chat handler, if you intend to add a pre-gate).
 */
export async function getLangyGithubPrUsage({
  userId,
  limit = LANGY_GITHUB_PRS_PER_DAY,
}: {
  userId: string;
  limit?: number;
}): Promise<GithubPrLimitResult> {
  if (!connection) {
    return {
      allowed: true,
      remaining: limit,
      resetAt: resetAtForBucket(dayBucket()),
    };
  }
  const bucket = dayBucket();
  const key = `langy:gh:prs:${userId}:${bucket}`;
  let count = 0;
  try {
    const raw = await (
      connection as { get: (k: string) => Promise<string | null> }
    ).get(key);
    count = raw ? Number.parseInt(raw, 10) : 0;
  } catch {
    return {
      allowed: true,
      remaining: limit,
      resetAt: resetAtForBucket(bucket),
    };
  }
  return {
    allowed: count < limit,
    remaining: Math.max(0, limit - count),
    resetAt: resetAtForBucket(bucket),
  };
}

/**
 * Increment the counter for one PR. Returns the post-increment usage so the
 * caller can decide whether to soft-warn the user when they're close to the
 * cap.
 *
 * Bumped AFTER a PR is observed in the assistant reply (see
 * LangyMessageService onAssistantReply). At-most-once is preferable to
 * at-least-once here — undercounting briefly is better than blocking a
 * legitimate user because we double-counted a retried message.
 */
export async function recordLangyGithubPr({
  userId,
  limit = LANGY_GITHUB_PRS_PER_DAY,
}: {
  userId: string;
  limit?: number;
}): Promise<GithubPrLimitResult> {
  if (!connection) {
    return {
      allowed: true,
      remaining: limit,
      resetAt: resetAtForBucket(dayBucket()),
    };
  }
  const bucket = dayBucket();
  const key = `langy:gh:prs:${userId}:${bucket}`;
  let count: number;
  try {
    count = await (connection as { incr: (k: string) => Promise<number> }).incr(
      key,
    );
    if (count === 1) {
      // Two-day TTL gives us a margin around clock skew without leaking
      // counters into the next bucket. The bucket key itself rotates daily.
      await (
        connection as { expire: (k: string, s: number) => Promise<number> }
      ).expire(key, 60 * 60 * 24 * 2);
    }
  } catch {
    return {
      allowed: true,
      remaining: limit,
      resetAt: resetAtForBucket(bucket),
    };
  }
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: resetAtForBucket(bucket),
  };
}
