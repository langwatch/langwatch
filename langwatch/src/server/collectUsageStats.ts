import type { ClickHouseClient } from "@clickhouse/client";
import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";

export async function collectUsageStats(instanceId: string) {
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

  const clickhouse = await getClickHouseClientForOrganization(organizationId);

  const totalTraces = await getTraceCount(projects, clickhouse);
  const totalScenarioEvents = await getScenariosCount(projects, clickhouse);

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

async function getTraceCount(
  projects: Array<{ id: string }>,
  clickhouse: ClickHouseClient | null,
): Promise<number> {
  if (!clickhouse || projects.length === 0) return 0;
  return getChTraceCount(clickhouse, projects.map((p) => p.id));
}

async function getChTraceCount(
  clickhouse: ClickHouseClient,
  projectIds: string[],
): Promise<number> {
  // Dedup by (TenantId, TraceId) and filter ArchivedAt via HAVING argMax so a
  // trace with an older unarchived row doesn't leak in pre-merge state.
  const result = await clickhouse.query({
    query: `
      SELECT toString(count()) AS Total
      FROM (
        SELECT TenantId, TraceId
        FROM trace_summaries
        WHERE TenantId IN ({projectIds:Array(String)})
        GROUP BY TenantId, TraceId
        HAVING argMax(ArchivedAt, UpdatedAt) IS NULL
      )
    `,
    query_params: { projectIds },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as Array<{ Total: string }>;
  return parseInt(rows[0]?.Total ?? "0", 10);
}

async function getScenariosCount(
  projects: Array<{ id: string }>,
  clickhouse: ClickHouseClient | null,
): Promise<number> {
  if (!clickhouse || projects.length === 0) return 0;
  return getChScenariosCount(clickhouse, projects.map((p) => p.id));
}

async function getChScenariosCount(
  clickhouse: ClickHouseClient,
  projectIds: string[],
): Promise<number> {
  const result = await clickhouse.query({
    query: `
      SELECT toString(count()) AS Total
      FROM simulation_runs AS t
      WHERE t.TenantId IN ({projectIds:Array(String)})
        AND t.ArchivedAt IS NULL
        AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
          SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
          FROM simulation_runs
          WHERE TenantId IN ({projectIds:Array(String)})
          GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
        )
    `,
    query_params: { projectIds },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as Array<{ Total: string }>;
  return parseInt(rows[0]?.Total ?? "0", 10);
}

