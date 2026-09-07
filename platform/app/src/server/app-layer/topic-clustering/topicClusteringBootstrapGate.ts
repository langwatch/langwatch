import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";

const logger = createLogger("langwatch:topic-clustering:bootstrap-gate");

/**
 * How long one project's bootstrap claim survives.
 *
 * This is the healing latency: a project whose clustering schedule went
 * missing recovers on its next trace after the claim expires. An hour is far
 * inside the daily clustering cadence, so a missed schedule never costs a
 * project a run, while keeping the write rate to at most one process-manager
 * commit per project per hour.
 */
export const BOOTSTRAP_CLAIM_TTL_SECONDS = 60 * 60;

function buildKey(projectId: string): string {
  return `topic-clustering:bootstrap-claimed:${projectId}`;
}

/**
 * Rate-limits the topic-clustering bootstrap so it can be called on EVERY
 * ingest without a per-trace write.
 *
 * ADR-051's bootstrap used to be edge-triggered — it fired once, on a
 * project's first-message transition. An edge that is missed is missed
 * forever: a failed bootstrap, a project that predates the feature, or a
 * deploy gap left the project with no `nextWakeAt` and nothing to notice,
 * which is why a deploy-time backfill had to exist at all.
 *
 * Calling it on every ingest instead makes it level-triggered — the system
 * continuously re-asserts "this project should have a schedule" and heals
 * itself. That is only affordable because the request is cheap by
 * construction: a `bootstrap`-trigger request evolves an already-bootstrapped
 * process to the same state, and `nextDailySlot` is anchored to the project's
 * hash slot rather than relative to now, so re-requesting cannot push the wake
 * forward or start a second run. The only real cost is the commit itself,
 * which is what this gate bounds.
 *
 * Best-effort by design: a Redis failure proceeds WITHOUT the claim. Losing a
 * schedule is a silent product outage; an extra commit is not.
 */
export function createRateLimitedBootstrap({
  redis,
  bootstrap,
  ttlSeconds = BOOTSTRAP_CLAIM_TTL_SECONDS,
}: {
  redis: Redis | Cluster;
  bootstrap: (projectId: string) => Promise<void>;
  ttlSeconds?: number;
}): (projectId: string) => Promise<void> {
  return async (projectId: string): Promise<void> => {
    let claimed = true;
    try {
      const result = await redis.set(
        buildKey(projectId),
        "1",
        "EX",
        ttlSeconds,
        "NX",
      );
      claimed = result === "OK";
    } catch (error) {
      logger.warn(
        { projectId, error },
        "Bootstrap claim failed; requesting anyway rather than risking an unscheduled project",
      );
    }

    if (!claimed) return;

    await bootstrap(projectId);
  };
}
