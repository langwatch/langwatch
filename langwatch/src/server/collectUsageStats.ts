import type { ClickHouseClient } from "@clickhouse/client";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { prisma } from "~/server/db";
import { esClient, SCENARIO_EVENTS_INDEX, TRACE_INDEX } from "./elasticsearch";

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
      featureClickHouseDataSourceTraces: true,
      featureClickHouseDataSourceSimulations: true,
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

  const clickhouse = getClickHouseClient();

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
  projects: Array<{
    id: string;
    featureClickHouseDataSourceTraces: boolean;
  }>,
  clickhouse: ClickHouseClient | null,
): Promise<number> {
  const chProjectIds = clickhouse
    ? projects.filter((p) => p.featureClickHouseDataSourceTraces).map((p) => p.id)
    : [];
  const esProjectIds = projects
    .filter((p) => !clickhouse || !p.featureClickHouseDataSourceTraces)
    .map((p) => p.id);

  const [chCount, esCount] = await Promise.all([
    chProjectIds.length > 0
      ? getChTraceCount(clickhouse!, chProjectIds)
      : 0,
    esProjectIds.length > 0
      ? getEsTraceCount(esProjectIds)
      : 0,
  ]);

  return chCount + esCount;
}

async function getChTraceCount(
  clickhouse: ClickHouseClient,
  projectIds: string[],
): Promise<number> {
  const result = await clickhouse.query({
    query: `
      SELECT toString(count(DISTINCT TraceId)) AS Total
      FROM trace_summaries
      WHERE TenantId IN ({projectIds:Array(String)})
    `,
    query_params: { projectIds },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as Array<{ Total: string }>;
  return parseInt(rows[0]?.Total ?? "0", 10);
}

async function getEsTraceCount(projectIds: string[]): Promise<number> {
  const client = await esClient();

  const result = await client.count({
    index: TRACE_INDEX.all,
    body: {
      query: {
        terms: { project_id: projectIds },
      },
    },
  });

  return (
    (result as { body?: { count?: number } }).body?.count ??
    result.count ??
    0
  );
}

async function getScenariosCount(
  projects: Array<{
    id: string;
    featureClickHouseDataSourceSimulations: boolean;
  }>,
  clickhouse: ClickHouseClient | null,
): Promise<number> {
  const chProjectIds = clickhouse
    ? projects.filter((p) => p.featureClickHouseDataSourceSimulations).map((p) => p.id)
    : [];
  const esProjectIds = projects
    .filter((p) => !clickhouse || !p.featureClickHouseDataSourceSimulations)
    .map((p) => p.id);

  const [chCount, esCount] = await Promise.all([
    chProjectIds.length > 0
      ? getChScenariosCount(clickhouse!, chProjectIds)
      : 0,
    esProjectIds.length > 0
      ? getEsScenariosCount(esProjectIds)
      : 0,
  ]);

  return chCount + esCount;
}

async function getChScenariosCount(
  clickhouse: ClickHouseClient,
  projectIds: string[],
): Promise<number> {
  const result = await clickhouse.query({
    query: `
      SELECT toString(count()) AS Total
      FROM (
        SELECT *
        FROM simulation_runs
        WHERE TenantId IN ({projectIds:Array(String)})
        ORDER BY ScenarioRunId, UpdatedAt DESC
        LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
      )
      WHERE DeletedAt IS NULL
    `,
    query_params: { projectIds },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as Array<{ Total: string }>;
  return parseInt(rows[0]?.Total ?? "0", 10);
}

async function getEsScenariosCount(projectIds: string[]): Promise<number> {
  const client = await esClient();

  const result = await client.count({
    index: SCENARIO_EVENTS_INDEX.alias,
    body: {
      query: {
        terms: { project_id: projectIds },
      },
    },
  });

  return (
    (result as { body?: { count?: number } }).body?.count ??
    result.count ??
    0
  );
}
