import { createLogger } from "@langwatch/observability";

import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { TOPIC_CLUSTERING_PROCESS_NAME } from "~/server/app-layer/topic-clustering/process-manager/topicClusteringProcess.types";
import { prisma } from "../server/db";

const logger = createLogger("langwatch:tasks:backfillTopicClusteringSchedules");

/** Projects fetched (and bootstrapped) per round-trip. */
const DEFAULT_PAGE_SIZE = 500;

/**
 * How long the task waits for the database schema before giving up. The app's
 * FIRST boot applies migrations, and on a fresh install that boot races this
 * hook — image pulls and rollout in a new cluster take minutes, while the
 * hook Job's three retries burn out in under a minute of crash-loops. Well
 * under the chart's activeDeadlineSeconds (3600, shared across retries) so a
 * timeout still leaves the Job budget to retry.
 */
const DEFAULT_SCHEMA_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SCHEMA_POLL_INTERVAL_MS = 5_000;

export interface SchemaWaitDeps {
  /** Resolves once every table the backfill touches exists; throws until then. */
  probeSchema: () => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Waits for the backfill's tables to exist instead of crash-looping.
 *
 * The Helm hook that runs this task fires on post-install as well as
 * post-upgrade, and nothing orders it after the app's first successful boot —
 * the boot that applies migrations. Probing before the walk turns "fresh
 * install" from three `P2021: table does not exist` crashes (which fail the
 * whole `helm install` with BackoffLimitExceeded) into a quiet wait followed
 * by a no-op. The same wait covers upgrades that introduce the process
 * manager tables themselves.
 *
 * Deliberately does not inspect error codes: a DB still starting up, a
 * missing database, and a missing table all mean the same thing here — not
 * ready yet — and the deadline bounds a genuine outage to a visible throw,
 * which crash-loops with the real error in the pod log rather than hanging
 * until the Job deadline kills it with no cause attached.
 */
/**
 * The schema never appeared inside the wait. An ORDERING condition, not a
 * failure of the backfill itself, so callers may treat it as a skip.
 */
export class BackfillSchemaNotReadyError extends Error {
  constructor(timeoutMs: number, cause: unknown) {
    super(
      `Database schema not ready after ${Math.round(timeoutMs / 1000)}s; ` +
        "the app's first boot applies migrations — check that the app deployment is coming up",
      { cause },
    );
    this.name = "BackfillSchemaNotReadyError";
  }
}

export async function waitForBackfillSchema(
  deps: SchemaWaitDeps,
): Promise<void> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SCHEMA_WAIT_TIMEOUT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_SCHEMA_POLL_INTERVAL_MS;
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;

  const deadline = now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.probeSchema();
      return;
    } catch (error) {
      if (now() >= deadline) {
        throw new BackfillSchemaNotReadyError(timeoutMs, error);
      }
      logger.warn(
        { attempt, error },
        "database schema not ready; waiting for the app's first boot to apply migrations",
      );
      await sleep(pollIntervalMs);
    }
  }
}

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
   * reactor's bootstrap on first trace, not from this backfill.
   */
  findEligibleProjectsPage: (params: {
    afterId: string | null;
    take: number;
  }) => Promise<{ id: string }[]>;
  /**
   * The subset of `projectIds` that already has a scheduled topic clustering
   * wake. Those are skipped: re-requesting is a harmless no-op, but on a large
   * fleet it would append an event per project on every `helm upgrade`.
   */
  findAlreadyScheduledProjectIds: (params: {
    projectIds: string[];
  }) => Promise<Set<string>>;
  /** The bootstrap command boundary (idempotent by design). */
  requestClustering: (params: { projectId: string }) => Promise<void>;
  pageSize?: number;
}

/**
 * ADR-051 one-time backfill: give every eligible project (firstMessage:
 * true) a topic clustering process row and a scheduled daily wake. Safe to
 * re-run: projects that already carry a `nextWakeAt` are skipped outright,
 * and a request that does go out evolves an already-bootstrapped process as
 * a pure no-op. Note each such request still appends a fresh `requested`
 * event — the skip check, not the event log, is what keeps re-runs from
 * growing the log, and it only holds once the workers have processed the
 * previous request into a `nextWakeAt` (a quick hook retry may re-request
 * not-yet-processed projects; benign, the slot is deterministic).
 *
 * A single project's failure must never truncate the fleet: one bad project
 * is logged and skipped so the remaining thousands still get scheduled. The
 * caller turns any failure into a non-zero exit so the Helm hook doesn't
 * report success on a partial backfill.
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

export default async function execute() {
  try {
    await waitForBackfillSchema({
      probeSchema: async () => {
        // Every table the walk reads. Existence is the question, not content —
        // an empty result is a healthy answer on a fresh install.
        await prisma.$queryRaw`SELECT 1 FROM "Project" LIMIT 1`;
        await prisma.$queryRaw`SELECT 1 FROM "ProcessManagerInstance" LIMIT 1`;
      },
    });
  } catch (error) {
    if (!(error instanceof BackfillSchemaNotReadyError)) throw error;
    // Skip rather than fail. Migrations run on app boot, so on a fresh
    // install this Job can legitimately outlive its own wait — and failing
    // here fails the whole `helm install`, which this backfill must never do.
    //
    // Skipping is safe because the backfill is no longer the reconciliation
    // path: clustering bootstrap is level-triggered on ingest, so every
    // ACTIVE project re-asserts its own schedule within the claim window.
    // What is left for this Job is dormant projects, which by definition are
    // not clustering right now and lose nothing by waiting for the next
    // upgrade or a manual run.
    logger.warn(
      { error },
      "Schema not ready inside the wait; skipping the backfill without failing the deploy — active projects self-schedule on ingest, dormant ones are picked up by the next run",
    );
    return;
  }

  await initializeDefaultApp();
  const app = getApp();

  const summary = await backfillTopicClusteringSchedules({
    findEligibleProjectsPage: ({ afterId, take }) =>
      prisma.project.findMany({
        where: {
          firstMessage: true,
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take,
      }),
    findAlreadyScheduledProjectIds: async ({ projectIds }) => {
      const instances = await prisma.processManagerInstance.findMany({
        where: {
          processName: TOPIC_CLUSTERING_PROCESS_NAME,
          projectId: { in: projectIds },
          nextWakeAt: { not: null },
        },
        select: { projectId: true },
      });
      return new Set(instances.map((instance) => instance.projectId));
    },
    requestClustering: async ({ projectId }) => {
      await app.topicClustering.requestClustering({
        tenantId: projectId,
        occurredAt: Date.now(),
        trigger: "bootstrap",
      });
    },
  });

  logger.info(
    summary,
    `Topic clustering backfill: ${summary.succeeded} scheduled, ${summary.skipped} already scheduled, ${summary.failed} failed (of ${summary.scanned} projects)`,
  );

  if (summary.failed > 0) {
    // Non-zero exit: the Helm hook must retry rather than mark a partial
    // backfill as a successful deploy step.
    throw new Error(
      `Topic clustering backfill incomplete: ${summary.failed} of ${summary.scanned} projects failed to schedule`,
    );
  }
}
