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
 * Issue #4747. Spec: specs/langy/langy-github-prs.feature.
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
  // Track each step's outcome explicitly so a Redis blip MID-flow doesn't
  // collapse two different states into the same fail-open shape. The N1/N2
  // adversarial findings (goated-review round 4): the previous catch-all
  // could send back `allowed: true, reserved: false` even when the count
  // had ALREADY gone over the limit (DECR throw on over-cap), letting a
  // 21st request squeak past while the counter stayed inflated. Now the
  // over-cap path is detected up front; if DECR fails best-effort, the
  // result is still `allowed: false` because we honour what the kernel
  // already told us about the count.
  let count: number | null = null;
  try {
    count = await (connection as { incr: (k: string) => Promise<number> }).incr(
      key,
    );
  } catch {
    // INCR itself never committed — no side effect to undo.
    return {
      allowed: true,
      remaining: limit,
      resetAt: resetAtForBucket(bucket),
      reserved: false,
    };
  }
  if (count === 1) {
    // EXPIRE failures used to leak through the catch as `allowed: true`
    // PLUS leave the key without a TTL. Retry once in a tail-call; if
    // the retry also fails, log and proceed — the key will outlive the
    // bucket but cap enforcement still works (the count starts correct).
    try {
      await (
        connection as { expire: (k: string, s: number) => Promise<number> }
      ).expire(key, 60 * 60 * 24 * 2);
    } catch {
      // Best-effort retry; on persistent EXPIRE failure the key has no
      // TTL — operator-visible via redis monitoring of `langy:gh:prs:*`
      // keys older than 2 days. Documented residual; cap still works.
      try {
        await (
          connection as { expire: (k: string, s: number) => Promise<number> }
        ).expire(key, 60 * 60 * 24 * 2);
      } catch {
        /* TTL-less key; cap enforcement unaffected this bucket */
      }
    }
  }
  if (count > limit) {
    // Over-cap: count already past the limit before any DECR attempt. Even
    // if the DECR throws below, the right answer is `allowed: false`.
    try {
      await (connection as { decr: (k: string) => Promise<number> }).decr(key);
    } catch {
      // DECR throw on the over-cap path: the counter stays inflated at
      // `count` for the day, but the caller is correctly denied. Sergio's
      // SR2/SR3 floor-at-0 release path covers the inverse case
      // (release without matching INCR). The cap still holds; future
      // reservations on this user/day see the inflated count and deny.
    }
    return {
      allowed: false,
      remaining: 0,
      resetAt: resetAtForBucket(bucket),
      reserved: false,
    };
  }
  // INCR committed AND count is within cap — caller holds the permit.
  return {
    allowed: true,
    remaining: Math.max(0, limit - count),
    resetAt: resetAtForBucket(bucket),
    reserved: true,
  };
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
    const script =
      "local n = tonumber(redis.call('GET', KEYS[1]) or '0')\n" +
      "if n <= 0 then return 0 end\n" +
      "return redis.call('DECR', KEYS[1])";
    if (typeof conn.eval === "function") {
      await conn.eval(script, 1, key);
      return;
    }
    // Pre-Redis-6.2 or mock-Redis fallback: no eval, so guard with a
    // read-before-decrement. Not atomic, but the decrement is best-effort
    // anyway (a race here yields a slightly under-counted cap, not an
    // underflow to negative that would grant unlimited permits).
    const raw = await (
      connection as unknown as { get: (k: string) => Promise<string | null> }
    ).get(key);
    const n = parseInt(raw ?? "0", 10);
    if (n > 0) {
      await conn.decr(key);
    }
  } catch {
    /* best-effort */
  }
}
