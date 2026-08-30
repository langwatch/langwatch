import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { prisma } from "../server/db";

const logger = createLogger("langwatch:tasks:backfillAnnotationsToClickhouse");

type App = ReturnType<typeof getApp>;

interface BackfillTotals {
  traces: number;
  annotations: number;
}

/**
 * Reconciliation task that syncs all annotations from Prisma to ClickHouse
 * via the event sourcing pipeline using bulkSyncAnnotations commands. Run it
 * whenever add/remove sync events were lost and has-annotation search reads
 * have drifted from what Prisma holds.
 *
 * Annotations are read one project at a time: the multitenancy guard rejects
 * any Annotation query that does not name its project.
 *
 * Race-condition note: concurrent add/remove mutations are safe because
 * handleTraceAnnotationsBulkSynced merges via Set (never overwrites).
 * The worst case is a brief window where a just-removed annotation
 * reappears until the next add/remove event corrects it.
 *
 * Every comment counts, including one left on a single span: what ClickHouse
 * carries is whether a human has touched a trace, which the has-annotation
 * filter in search reads.
 */
export default async function execute() {
  initializeDefaultApp();

  const projects = await prisma.project.findMany({ select: { id: true } });
  const app = getApp();
  const totals: BackfillTotals = { traces: 0, annotations: 0 };

  for (const project of projects) {
    await backfillProject({ app, projectId: project.id, totals });
  }

  logger.info(
    {
      totalTraces: totals.traces,
      totalProjects: projects.length,
      totalAnnotations: totals.annotations,
    },
    "Finished backfilling all annotations to ClickHouse",
  );
}

async function backfillProject({
  app,
  projectId,
  totals,
}: {
  app: App;
  projectId: string;
  totals: BackfillTotals;
}): Promise<void> {
  const annotations = await prisma.annotation.findMany({
    where: { projectId },
    select: { id: true, traceId: true },
  });
  if (annotations.length === 0) return;
  totals.annotations += annotations.length;

  let projectTraces = 0;
  for (const [traceId, annotationIds] of groupAnnotationIdsByTrace(annotations)) {
    const synced = await syncTraceAnnotations({
      app,
      projectId,
      traceId,
      annotationIds,
    });
    if (!synced) continue;
    projectTraces++;
    totals.traces++;
    if (totals.traces % 100 === 0) {
      logger.info({ totalTraces: totals.traces }, "Backfill progress");
    }
  }

  logger.info({ projectId, projectTraces }, "Finished backfilling project");
}

function groupAnnotationIdsByTrace(
  annotations: Array<{ id: string; traceId: string }>,
): Map<string, string[]> {
  const idsByTrace = new Map<string, string[]>();
  for (const annotation of annotations) {
    const ids = idsByTrace.get(annotation.traceId) ?? [];
    ids.push(annotation.id);
    idsByTrace.set(annotation.traceId, ids);
  }
  return idsByTrace;
}

async function syncTraceAnnotations({
  app,
  projectId,
  traceId,
  annotationIds,
}: {
  app: App;
  projectId: string;
  traceId: string;
  annotationIds: string[];
}): Promise<boolean> {
  try {
    await app.commands.traces.bulkSyncAnnotations({
      tenantId: projectId,
      traceId,
      annotationIds,
      occurredAt: Date.now(),
    });
    return true;
  } catch (error) {
    logger.error({ error, projectId, traceId }, "Failed to backfill annotations for trace");
    return false;
  }
}
