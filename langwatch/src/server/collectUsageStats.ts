import { prisma } from "~/server/db";
import { TRACE_INDEX } from "./elasticsearch";
import { esClient } from "./elasticsearch";

export async function collectUsageStats(instanceId: string) {
  const organizationId = instanceId.split("-")[0];

  if (!organizationId) {
    throw new Error("Invalid instance ID");
  }

  const userCount = await prisma.user.count();
  const annotationCount = await prisma.annotation.count();
  const annotationQueueCount = await prisma.annotationQueue.count();
  const annotationQueueItemCount = await prisma.annotationQueueItem.count();
  const annotationScoreCount = await prisma.annotationScore.count();
  const batchEvaluationCount = await prisma.batchEvaluation.count();
  const customGraphCount = await prisma.customGraph.count();
  const datasetCount = await prisma.dataset.count();
  const datasetRecordCount = await prisma.datasetRecord.count();
  const experimentCount = await prisma.experiment.count();
  const triggerCount = await prisma.trigger.count();

  const { totalTraces } = await getTraceCount(organizationId);

  return {
    totalTraces,
    userCount,
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
