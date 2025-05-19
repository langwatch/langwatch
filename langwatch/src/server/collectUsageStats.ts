import { prisma } from "~/server/db";
import { TRACE_INDEX } from "./elasticsearch";
import { esClient } from "./elasticsearch";

export async function collectUsageStats(instanceId: string) {
  const organizationId = instanceId.split("__")[1];

  const projectIds = await prisma.project
    .findMany({
      where: {
        team: { organizationId },
      },
      select: { id: true },
    })
    .then((projects) => projects.map((project) => project.id));

  if (!organizationId) {
    throw new Error("Invalid instance ID");
  }

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

  const { totalTraces } = await getTraceCount(organizationId);

  return {
    totalTraces,
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

const getTraceCount = async (organizationId: string) => {
  const client = await esClient({ organizationId });

  const result = await client.count({
    index: TRACE_INDEX.alias,
    body: {
      query: {
        match_all: {}, // Get all documents without any filter
      },
    },
  });

  return {
    totalTraces: result.count,
  };
};
