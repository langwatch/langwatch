import { prisma } from "../server/db";
import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:tasks:backfillAnnotationsToClickhouse");

/**
 * One-time backfill task that syncs all annotations from Prisma to ClickHouse
 * via the event sourcing pipeline using bulkSyncAnnotations commands.
 */
export default async function execute() {
  initializeDefaultApp();

  const annotations = await prisma.annotation.findMany({
    select: { id: true, projectId: true, traceId: true },
  });

  logger.info({ count: annotations.length }, "Found annotations to backfill");

  // Group annotation IDs by (projectId, traceId)
  const grouped: Record<string, Record<string, string[]>> = {};
  for (const annotation of annotations) {
    if (!grouped[annotation.projectId]) {
      grouped[annotation.projectId] = {};
    }
    if (!grouped[annotation.projectId]![annotation.traceId]) {
      grouped[annotation.projectId]![annotation.traceId] = [];
    }
    grouped[annotation.projectId]![annotation.traceId]!.push(annotation.id);
  }

  const app = getApp();
  let totalTraces = 0;
  const totalProjects = Object.keys(grouped).length;

  for (const [projectId, traceMap] of Object.entries(grouped)) {
    let projectTraces = 0;

    for (const [traceId, annotationIds] of Object.entries(traceMap)) {
      try {
        await app.traces.bulkSyncAnnotations({
          tenantId: projectId,
          traceId,
          annotationIds,
          occurredAt: Date.now(),
        });
        projectTraces++;
        totalTraces++;
        if (totalTraces % 100 === 0) {
          logger.info({ totalTraces }, "Backfill progress");
        }
      } catch (error) {
        logger.error(
          { error, projectId, traceId },
          "Failed to backfill annotations for trace",
        );
      }
    }

    logger.info(
      { projectId, projectTraces },
      "Finished backfilling project",
    );
  }

  logger.info(
    { totalTraces, totalProjects, totalAnnotations: annotations.length },
    "Finished backfilling all annotations to ClickHouse",
  );
}
