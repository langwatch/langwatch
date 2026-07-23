import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";

const logger = createLogger("langwatch:topic-clustering:schedule-seed");

/** Projects fetched (and bootstrapped) per round-trip. */
const DEFAULT_PAGE_SIZE = 500;

/** One claim per window across replicas; the walk is idempotent regardless. */
const SEED_CLAIM_KEY = "topic-clustering:schedule-seed:v1";
const SEED_CLAIM_TTL_SECONDS = 24 * 60 * 60;
/** Permanent once a pass finds nothing left to seed: later boots exit on one GET. */
const SEED_DONE_KEY = "topic-clustering:schedule-seed:v1:done";

export interface BackfillSummary {
  /** Bootstrap request accepted for a project that had no scheduled wake. */
  succeeded: number;
  /** Bootstrap request threw; the project was logged and left behind. */
  failed: number;
  /** Already had a `nextWakeAt`, so no request was issued at all. */
  skipped: number;
  /** succeeded + failed + skipped — every project the paging walk visited. */
  scanned: number;
}

export interface BackfillDeps {
  /**
   * One page of eligible projects, ascending by id, strictly after `afterId`.
   * Keyset paging rather than offset: the walk stays O(1) per page and never
   * repeats a project. It CAN miss a project inserted mid-walk with an id
   * lexically behind the cursor (ids are nanoid, not monotonic) — harmless
   * here, because a project created after the walk started has
   * `firstMessage: false` and gets its schedule from the projectMetadata
   * reactor's bootstrap on first trace, not from this walk.
   */
  findEligibleProjectsPage: (params: {
    afterId: string | null;
    take: number;
  }) => Promise<{ id: string }[]>;
  /**
   * The subset of `projectIds` that already has a scheduled topic clustering
   * wake. Those are skipped: re-requesting is a harmless no-op, but on a large
   * fleet it would append an event per project on every pass.
   */
  findAlreadyScheduledProjectIds: (params: {
    projectIds: string[];
  }) => Promise<Set<string>>;
  /** The bootstrap command boundary (idempotent by design). */
  requestClustering: (params: { projectId: string }) => Promise<void>;
  pageSize?: number;
}

/**
 * ADR-051 legacy-project seed: give every eligible project (firstMessage:
 * true) that predates level-triggered bootstrap a topic clustering process
 * row and a scheduled daily wake. Safe to re-run: projects that already
 * carry a `nextWakeAt` are skipped outright, and a request that does go out
 * evolves an already-bootstrapped process as a pure no-op. Note each such
 * request still appends a fresh `requested` event — the skip check, not the
 * event log, is what keeps re-runs from growing the log, and it only holds
 * once the workers have processed the previous request into a `nextWakeAt`.
 *
 * A single project's failure must never truncate the fleet: one bad project
 * is logged and skipped so the rest still gets scheduled.
 */
export async function backfillTopicClusteringSchedules(
  deps: BackfillDeps,
): Promise<BackfillSummary> {
  const take = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const summary: BackfillSummary = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    scanned: 0,
  };

  let afterId: string | null = null;

  for (;;) {
    const page = await deps.findEligibleProjectsPage({ afterId, take });
    if (page.length === 0) break;

    const alreadyScheduled = await deps.findAlreadyScheduledProjectIds({
      projectIds: page.map((project) => project.id),
    });

    for (const project of page) {
      summary.scanned++;

      if (alreadyScheduled.has(project.id)) {
        summary.skipped++;
        continue;
      }

      try {
        await deps.requestClustering({ projectId: project.id });
        summary.succeeded++;
      } catch (error) {
        summary.failed++;
        logger.error(
          { error, projectId: project.id },
          "failed to request topic clustering bootstrap for project; continuing with the rest",
        );
      }
    }

    afterId = page[page.length - 1]!.id;
    if (page.length < take) break;
  }

  return summary;
}

export interface SeedClusteringSchedulesDeps extends BackfillDeps {
  /** Coordination only — without Redis the walk still runs safely. */
  redis: Redis | Cluster | null;
}

/**
 * One-time boot seed for pre-cutover projects (spec:
 * specs/topic-clustering/event-sourced-scheduling.feature "Existing projects
 * are backfilled once"). Runs on worker start — no deploy-time job or chart
 * hook, and unlike a Helm hook this never races the app's own migrations
 * (workers only start after boot). Redis (when available) elects one
 * replica per window; correctness comes from the per-project
 * already-scheduled skip, which is idempotent regardless of coordination.
 *
 * Once a pass finds nothing left to schedule (a fresh install hits this on
 * its very first boot, since there are no projects yet), a permanent Redis
 * marker short-circuits every later boot to a single GET — this walk costs
 * nothing for anyone who signs up after the cutover.
 */
export async function seedClusteringSchedules(
  deps: SeedClusteringSchedulesDeps,
): Promise<BackfillSummary> {
  if (await isSeedDone(deps.redis)) {
    return { succeeded: 0, failed: 0, skipped: 0, scanned: 0 };
  }
  if (!(await claimSeed(deps.redis))) {
    return { succeeded: 0, failed: 0, skipped: 0, scanned: 0 };
  }

  try {
    const summary = await backfillTopicClusteringSchedules(deps);
    logger.info(
      summary,
      `Topic clustering schedule seed: ${summary.succeeded} scheduled, ${summary.skipped} already scheduled, ${summary.failed} failed (of ${summary.scanned} projects)`,
    );
    // Nothing left to seed and nothing failed: every legacy project is
    // scheduled (or there never were any). Mark the pass finished so
    // signups after the cutover never pay for a scan again.
    if (summary.succeeded === 0 && summary.failed === 0) {
      await markSeedDone(deps.redis);
    }
    return summary;
  } finally {
    // Release the claim once the pass is over (finished or crashed): it
    // only elects one replica per concurrent boot window, and must not
    // hold a failed pass hostage until the TTL — "the next boot retries".
    await releaseSeedClaim(deps.redis);
  }
}

async function claimSeed(redis: Redis | Cluster | null): Promise<boolean> {
  if (!redis) return true;
  try {
    const claimed = await redis.set(
      SEED_CLAIM_KEY,
      String(Date.now()),
      "EX",
      SEED_CLAIM_TTL_SECONDS,
      "NX",
    );
    return claimed === "OK";
  } catch (error) {
    // Coordination is best-effort; the walk itself is idempotent.
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Redis seed claim failed; seeding anyway",
    );
    return true;
  }
}

async function releaseSeedClaim(redis: Redis | Cluster | null): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(SEED_CLAIM_KEY);
  } catch {
    // Best-effort: worst case the TTL clears it.
  }
}

async function isSeedDone(redis: Redis | Cluster | null): Promise<boolean> {
  if (!redis) return false;
  try {
    return (await redis.get(SEED_DONE_KEY)) !== null;
  } catch {
    return false;
  }
}

async function markSeedDone(redis: Redis | Cluster | null): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(SEED_DONE_KEY, String(Date.now()));
  } catch {
    // Best-effort: the next pass just re-derives the same answer.
  }
}
