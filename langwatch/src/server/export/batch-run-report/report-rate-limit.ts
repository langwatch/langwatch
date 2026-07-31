import { createLogger } from "@langwatch/observability";
import { connection } from "~/server/redis";

/**
 * How many analysed reports one person may start per minute, per project.
 *
 * Only the analysed ones. An instant export is a couple of hundred
 * milliseconds of arithmetic and rate-limiting it would be friction with
 * nothing behind it; an analysed one is two model calls over up to
 * twenty-four transcripts and runs for a minute or more. Nothing otherwise
 * stops a run history with forty rows becoming forty concurrent pairs of
 * model calls, and the per-row guard in `useBatchRunReport` only prevents
 * asking twice for the SAME run.
 *
 * Three is comfortably above deliberate use — nobody reads three reports a
 * minute — and well below what a stuck finger or a script produces.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
export const REPORTS_WITH_ANALYSIS_PER_MINUTE = 3;

const logger = createLogger("langwatch:batch-run-report:rate-limit");

export interface ReportRateLimitResult {
  isAllowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Whether this user may start another analysed report right now.
 *
 * Fails OPEN when Redis is unavailable or errors, matching every other limiter
 * here: an outage must not take a feature offline, and the cost of a few extra
 * reports during one is far below the cost of refusing all of them. Dev and
 * test run with no Redis at all, so the same branch keeps them usable.
 */
export async function checkReportRateLimit({
  userId,
  projectId,
  limit = REPORTS_WITH_ANALYSIS_PER_MINUTE,
}: {
  userId: string;
  projectId: string;
  limit?: number;
  /** Passed in by tests; production reads the clock. */
  now?: number;
}): Promise<ReportRateLimitResult> {
  if (!connection) return { isAllowed: true, retryAfterSeconds: 0 };

  const bucket = Math.floor(Date.now() / 60_000);
  const key = `report:rl:${projectId}:${userId}:${bucket}`;

  try {
    const redis = connection as {
      incr: (k: string) => Promise<number>;
      expire: (k: string, s: number) => Promise<number>;
    };
    const count = await redis.incr(key);
    // Only the first write sets the expiry, so a busy minute cannot keep
    // pushing the window out and lock someone out indefinitely.
    if (count === 1) await redis.expire(key, 65);
    if (count <= limit) return { isAllowed: true, retryAfterSeconds: 0 };

    const nextBucket = (bucket + 1) * 60_000;
    return {
      isAllowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((nextBucket - Date.now()) / 1000),
      ),
    };
  } catch (error) {
    logger.warn(
      { error, projectId, userId },
      "run report rate limit failing open on redis error",
    );
    return { isAllowed: true, retryAfterSeconds: 0 };
  }
}
