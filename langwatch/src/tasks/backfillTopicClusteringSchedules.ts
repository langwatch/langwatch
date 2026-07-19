import { createLogger } from "@langwatch/observability";

import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { TOPIC_CLUSTERING_PROCESS_NAME } from "~/server/app-layer/topic-clustering/process-manager/topicClusteringProcess.types";
import { prisma } from "../server/db";

const logger = createLogger("langwatch:tasks:backfillTopicClusteringSchedules");

/** Projects fetched (and bootstrapped) per round-trip. */
const DEFAULT_PAGE_SIZE = 500;

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
   * Keyset paging rather than offset: the walk stays O(1) per page and cannot
   * skip or repeat a project if rows are inserted while it runs.
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
 * re-run — the bootstrap request is idempotent (event-log dedup + a pure
 * no-op evolution for already-bootstrapped processes), and projects that
 * already carry a `nextWakeAt` are skipped outright.
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
