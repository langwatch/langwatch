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
  /**
   * True only when a real `INCR` actually committed to Redis under this call.
   * Read-only `getLangyGithubPrUsage` always returns `false` (no INCR ran).
   * `reserveLangyGithubPrPermit` returns `true` only on the happy path; the
   * Redis-down / Redis-blip / over-cap paths return `false` even when the
   * function fails OPEN on `allowed`. Callers that release reservations
   * (`releasePermitIfUnused`) MUST gate on `reserved`, not on `allowed`:
   * gating on `allowed` would DECR a key that was never INCR'd, walking the
   * shared daily counter into the negative space — the floor at 0 then
   * refunds N free permits to whoever calls reserve next. Sergio caught
   * this as the P2 erosion-via-blip path on 2026-06-30.
   */
  reserved: boolean;
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
      reserved: false,
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
      reserved: false,
    };
  }
  return {
    allowed: count < limit,
    remaining: Math.max(0, limit - count),
    resetAt: resetAtForBucket(bucket),
    reserved: false,
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
      reserved: false,
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
      reserved: false,
    };
  }
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: resetAtForBucket(bucket),
    reserved: true,
  };
}

/**
 * Apply EXTRA increments (beyond the up-front reservation) when a single
 * chat turn opens more PRs than the one permit we held. Lets the daily
 * counter reflect what actually happened on the wire instead of "one bump
 * per turn regardless of PR count" — the previous shape let an injected
 * worker open hundreds of PRs against a single permit. Best-effort: a
 * Redis blip means the counter is briefly under-counted, but the next call
 * will re-tally on top of whatever made it through.
 */
export async function recordExtraLangyGithubPrs({
  userId,
  extra,
}: {
  userId: string;
  extra: number;
}): Promise<void> {
  if (!connection) return;
  if (extra <= 0) return;
  const bucket = dayBucket();
  const key = `langy:gh:prs:${userId}:${bucket}`;
  try {
    await (
      connection as {
        incrby: (k: string, n: number) => Promise<number>;
      }
    ).incrby(key, extra);
  } catch {
    /* best-effort */
  }
}

/**
 * Atomically reserve a per-turn PR permit BEFORE handing the worker the
 * GitHub token. Replaces the prompt-only cap: the previous behaviour added
 * a system note asking the model not to use the token, which is not an
 * authorisation boundary — the worker could ignore it, and N concurrent
 * requests could all observe `allowed=true` and all exceed the cap. Here
 * the permit is granted by INCR (atomic across replicas); a permit that
 * pushes the post-count past `limit` is immediately revoked via DECR and
 * `allowed: false` is returned, so the caller can strip the token from the
 * worker's credentials entirely.
 *
 * A permit reserved here that never produces an actual PR (the turn was
 * read-only, or the worker crashed pre-push) should be released via
 * `releaseLangyGithubPrPermit` once the chat ends so the user isn't
 * silently penalised for asking questions.
 */
export async function reserveLangyGithubPrPermit({
  userId,
  limit = LANGY_GITHUB_PRS_PER_DAY,
}: {
  userId: string;
  limit?: number;
}): Promise<GithubPrLimitResult> {
  if (!connection) {
    // No Redis configured (dev / smaller self-hosters). `allowed: true`
    // keeps GitHub PRs working in those environments; `reserved: false`
    // tells the caller "no INCR happened, do NOT DECR on release".
    return {
      allowed: true,
      remaining: limit,
      resetAt: resetAtForBucket(dayBucket()),
      reserved: false,
    };
  }
  const bucket = dayBucket();
  const key = `langy:gh:prs:${userId}:${bucket}`;
  try {
    const count = await (
      connection as { incr: (k: string) => Promise<number> }
    ).incr(key);
    if (count === 1) {
      await (
        connection as { expire: (k: string, s: number) => Promise<number> }
      ).expire(key, 60 * 60 * 24 * 2);
    }
    if (count > limit) {
      // Over-cap: roll back our INCR so the counter still reflects committed
      // permits (otherwise N concurrent over-cap reservers would each leave
      // the counter inflated by 1, pushing the visible "remaining" further
      // negative without granting anyone access).
      await (connection as { decr: (k: string) => Promise<number> }).decr(key);
      return {
        allowed: false,
        remaining: 0,
        resetAt: resetAtForBucket(bucket),
        // Rolled back — no DECR should happen on release either.
        reserved: false,
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      resetAt: resetAtForBucket(bucket),
      // INCR committed and survived the cap check — caller may release.
      reserved: true,
    };
  } catch {
    // Redis blip — fail OPEN on `allowed` so a transient outage doesn't
    // strip GitHub capability from every connected user (mirrors the
    // project-wide rate-limit convention). But mark `reserved: false`
    // because we don't actually know whether the INCR committed: a
    // successful INCR followed by a failed EXPIRE lands here, and so
    // does a totally-failed INCR. The release-side gates on `reserved`,
    // so the worst case is "counter briefly off by one" rather than
    // "DECR walks the shared counter into negative space and refunds
    // 20+ free permits to the next caller".
    return {
      allowed: true,
      remaining: limit,
      resetAt: resetAtForBucket(bucket),
      reserved: false,
    };
  }
}

/**
 * Release a previously-reserved permit (DECR) when the turn ended without
 * opening any PR. Best-effort: on Redis blip we just drop the call. The
 * reservation will expire with the bucket TTL anyway; releasing is a
 * fairness optimisation, not a correctness boundary.
 */
export async function releaseLangyGithubPrPermit({
  userId,
}: {
  userId: string;
}): Promise<void> {
  if (!connection) return;
  const bucket = dayBucket();
  const key = `langy:gh:prs:${userId}:${bucket}`;
  try {
    // Floor the decrement at 0. A naked DECR can underflow: if `release` is
    // called twice for the same reservation (retry path, double-call from a
    // crashed handler, or any reservation that never INCRed because Redis
    // was up-then-down), the counter goes negative — and a negative count
    // < limit means the next 20+ reservations all `allowed: true`. Lua keeps
    // the check-and-decr atomic.
    const conn = connection as {
      eval?: (
        script: string,
        numKeys: number,
        ...args: string[]
      ) => Promise<number | string | null>;
      decr: (k: string) => Promise<number>;
    };
    if (typeof conn.eval === "function") {
      const script =
        "local n = tonumber(redis.call('GET', KEYS[1]) or '0')\n" +
        "if n <= 0 then return 0 end\n" +
        "return redis.call('DECR', KEYS[1])";
      await conn.eval(script, 1, key);
      return;
    }
    await conn.decr(key);
  } catch {
    /* best-effort */
  }
}
