import { getApp } from "~/server/app-layer/app";
import type { InstanceUsageStatsRepository } from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import { prisma } from "~/server/db";

/** Total counts for each project-scoped table, across the given project ids. */
async function collectProjectScopedCounts(projectIds: string[]) {
  const [
    annotationCount,
    annotationQueueCount,
    annotationQueueItemCount,
    annotationScoreCount,
    batchEvaluationCount,
    customGraphCount,
    datasetCount,
    datasetRecordCount,
    experimentCount,
    triggerCount,
    workflowCount,
  ] = await Promise.all([
    prisma.annotation.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.annotationQueue.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.annotationQueueItem.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.annotationScore.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.batchEvaluation.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.customGraph.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.dataset.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.datasetRecord.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.experiment.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.trigger.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.workflow.count({
      where: { projectId: { in: projectIds } },
    }),
  ]);

  return {
    annotationCount,
    annotationQueueCount,
    annotationQueueItemCount,
    annotationScoreCount,
    batchEvaluationCount,
    customGraphCount,
    datasetCount,
    datasetRecordCount,
    experimentCount,
    triggerCount,
    workflowCount,
  };
}

export async function collectUsageStats({
  instanceId,
  repository = getApp().usageStats.instance,
}: {
  instanceId: string;
  /** Defaults to the repository the composition root built. */
  repository?: InstanceUsageStatsRepository;
}) {
  const organizationId = instanceId.split("__")[1];

  if (!organizationId) {
    throw new Error("Invalid instance ID");
  }

  const projects = await prisma.project.findMany({
    where: {
      team: { organizationId },
    },
    select: {
      id: true,
    },
  });
  const projectIds = projects.map((p) => p.id);

  // Get total counts for each table that has projectId
  const counts = await collectProjectScopedCounts(projectIds);

  const totalTraces = await repository.findTraceCount({
    organizationId,
    projectIds,
  });
  const totalScenarioEvents = await repository.findScenarioRunCount({
    organizationId,
    projectIds,
  });

  return {
    totalTraces,
    totalScenarioEvents,
    annotations: counts.annotationCount,
    annotationQueues: counts.annotationQueueCount,
    annotationQueueItems: counts.annotationQueueItemCount,
    annotationScores: counts.annotationScoreCount,
    batchEvaluations: counts.batchEvaluationCount,
    customGraphs: counts.customGraphCount,
    datasets: counts.datasetCount,
    datasetRecords: counts.datasetRecordCount,
    experiments: counts.experimentCount,
    triggers: counts.triggerCount,
    workflows: counts.workflowCount,
    timestamp: new Date().toISOString(),
  };
}
