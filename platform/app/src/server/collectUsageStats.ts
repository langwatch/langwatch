import {
  createDefaultInstanceUsageStatsRepository,
  type InstanceUsageStatsRepository,
} from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import { prisma } from "~/server/db";

export async function collectUsageStats({
  instanceId,
  repository = createDefaultInstanceUsageStatsRepository(),
}: {
  instanceId: string;
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
    annotations: annotationCount,
    annotationQueues: annotationQueueCount,
    annotationQueueItems: annotationQueueItemCount,
    annotationScores: annotationScoreCount,
    batchEvaluations: batchEvaluationCount,
    customGraphs: customGraphCount,
    datasets: datasetCount,
    datasetRecords: datasetRecordCount,
    experiments: experimentCount,
    triggers: triggerCount,
    workflows: workflowCount,
    timestamp: new Date().toISOString(),
  };
}
