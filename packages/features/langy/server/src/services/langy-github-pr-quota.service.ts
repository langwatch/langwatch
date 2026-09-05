/**
 * Per-user daily cap on PRs Langy may open on the user's behalf.
 * Issue #4747. Spec: specs/langy/langy-github-prs.feature.
 */
export abstract class LangyGithubPrCounterPort {
  abstract tryGet(key: string): Promise<string | null>;
  abstract incr(key: string): Promise<number>;
  abstract decr(key: string): Promise<number>;
  abstract incrby(key: string, amount: number): Promise<number>;
  abstract expire(key: string, seconds: number): Promise<unknown>;
}

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

function dayBucket(now = Date.now()): number {
  return Math.floor(now / (24 * 60 * 60 * 1000));
}

function resetAtForBucket(bucket: number): number {
  return (bucket + 1) * 24 * 60 * 60 * 1000;
}

/** Spends and refunds the per-user daily GitHub PR permit. */
export class LangyGithubPrQuotaService {
  static create(options: {
    /** The process's counter, or `null` where none is composed. */
    counter: LangyGithubPrCounterPort | null;
  }): LangyGithubPrQuotaService {
    return new LangyGithubPrQuotaService(options);
  }

  private readonly counter: LangyGithubPrCounterPort | null;

  private constructor(options: { counter: LangyGithubPrCounterPort | null }) {
    this.counter = options.counter;
  }

  /**
   * Check-only — does NOT increment. Use this BEFORE the worker starts a PR
   * sequence (e.g. in the chat handler, if you intend to add a pre-gate).
   */
  async usage({
    userId,
    limit = LANGY_GITHUB_PRS_PER_DAY,
  }: {
    userId: string;
    limit?: number;
  }): Promise<GithubPrLimitResult> {
    const connection = this.counter;
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
      const raw = await connection.tryGet(key);
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
   * Increment the counter for one PR. Returns the post-increment usage so the caller can decide
   * whether to soft-warn the user when they're close to the cap. Bumped AFTER a PR is observed in
   * the assistant reply (see LangyMessageService onAssistantReply).
   */
  async record({
    userId,
    limit = LANGY_GITHUB_PRS_PER_DAY,
  }: {
    userId: string;
    limit?: number;
  }): Promise<GithubPrLimitResult> {
    const connection = this.counter;
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
      count = await connection.incr(key);
      if (count === 1) {
        // Two-day TTL gives us a margin around clock skew without leaking
        // counters into the next bucket. The bucket key itself rotates daily.
        await connection.expire(key, 60 * 60 * 24 * 2);
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
   * Apply EXTRA increments (beyond the up-front reservation) when a single chat turn opens more PRs
   * than the one permit we held.
   */
  async recordExtra({ userId, extra }: { userId: string; extra: number }): Promise<void> {
    const connection = this.counter;
    if (!connection) {
      return;
    }

    if (extra <= 0) {
      return;
    }

    const bucket = dayBucket();
    const key = `langy:gh:prs:${userId}:${bucket}`;
    try {
      await connection.incrby(key, extra);
    } catch {
      /* best-effort */
    }
  }

  /**
   * Atomically reserve a per-turn PR permit BEFORE handing the worker the GitHub token.
   */
  async reservePermit({
    userId,
    limit = LANGY_GITHUB_PRS_PER_DAY,
  }: {
    userId: string;
    limit?: number;
  }): Promise<GithubPrLimitResult> {
    const connection = this.counter;
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
    // Track each step's outcome explicitly so a Redis blip MID-flow doesn't collapse two different
    // states into the same fail-open shape. The N1/N2 adversarial findings (goated-review round 4):
    // the previous catch-all could send back `allowed: true, reserved: false` even when the count
    // had ALREADY gone over the limit (DECR throw on over-cap), letting a 21st request squeak past
    // while the counter stayed inflated.
    let count: number;
    try {
      count = await connection.incr(key);
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
        await connection.expire(key, 60 * 60 * 24 * 2);
      } catch {
        // Best-effort retry; on persistent EXPIRE failure the key has no
        // TTL — operator-visible via redis monitoring of `langy:gh:prs:*`
        // keys older than 2 days. Documented residual; cap still works.
        try {
          await connection.expire(key, 60 * 60 * 24 * 2);
        } catch {
          /* TTL-less key; cap enforcement unaffected this bucket */
        }
      }
    }

    if (count > limit) {
      // Over-cap: count already past the limit before any DECR attempt. Even
      // if the DECR throws below, the right answer is `allowed: false`.
      try {
        await connection.decr(key);
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
   * Release a previously-reserved permit (DECR) when the turn ended without opening any PR. Best-
   * effort: on Redis blip we just drop the call. The reservation will expire with the bucket TTL
   * anyway; releasing is a fairness optimisation, not a correctness boundary.
   */
  async releasePermit({ userId }: { userId: string }): Promise<void> {
    const connection = this.counter;
    if (!connection) {
      return;
    }

    const bucket = dayBucket();
    const key = `langy:gh:prs:${userId}:${bucket}`;
    try {
      // Floor the decrement at 0. A naked DECR can underflow: if `release` is called twice for the
      // same reservation (retry path, double-call from a crashed handler, or any reservation that
      // never INCRed because Redis was up-then-down), the counter goes negative — and a negative
      // count < limit means the next 20+ reservations all `allowed: true`. Lua keeps the check-and-
      // decr atomic.
      const conn = connection as LangyGithubPrCounterPort & {
        eval?: (
          script: string,
          numKeys: number,
          ...args: string[]
        ) => Promise<number | string | null>;
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
      const raw = await connection.tryGet(key);
      const n = parseInt(raw ?? "0", 10);
      if (n > 0) {
        await conn.decr(key);
      }
    } catch {
      /* best-effort */
    }
  }
}
