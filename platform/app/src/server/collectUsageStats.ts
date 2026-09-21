import { BUILDER_CHART_KIND } from "~/server/analytics/chartKinds";
import { getApp } from "~/server/app-layer/app";
import type { InstanceUsageStatsRepository } from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import { prisma } from "~/server/db";

/** Every project of every organization the install carries. */
async function projectIdsOf(organizationIds: string[]): Promise<string[]> {
  const projects = await prisma.project.findMany({
    where: { team: { organizationId: { in: organizationIds } } },
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

/** The counts Postgres holds, all of them keyed by project. */
async function countStoredResources(projectIds: string[]) {
  const [
    annotations,
    annotationQueues,
    annotationQueueItems,
    annotationScores,
    batchEvaluations,
    customGraphs,
    datasets,
    datasetRecords,
    experiments,
    triggers,
    workflows,
  ] = await Promise.all([
    // Every comment, whether it is about a whole trace or about one part of it:
    // this counts the reviewing that happened, not what was said about traces.
    prisma.annotation.count({ where: { projectId: { in: projectIds } } }),
    prisma.annotationQueue.count({ where: { projectId: { in: projectIds } } }),
    prisma.annotationQueueItem.count({
      where: { projectId: { in: projectIds } },
    }),
    prisma.annotationScore.count({ where: { projectId: { in: projectIds } } }),
    prisma.batchEvaluation.count({ where: { projectId: { in: projectIds } } }),
    // Builder charts only, so the figure keeps meaning what it has always
    // meant. Saved workbench charts share the table but are a different
    // product; folding them in would show as growth in chart-builder usage.
    prisma.customGraph.count({
      where: { projectId: { in: projectIds }, kind: BUILDER_CHART_KIND },
    }),
    prisma.dataset.count({ where: { projectId: { in: projectIds } } }),
    prisma.datasetRecord.count({ where: { projectId: { in: projectIds } } }),
    prisma.experiment.count({ where: { projectId: { in: projectIds } } }),
    prisma.trigger.count({ where: { projectId: { in: projectIds } } }),
    prisma.workflow.count({ where: { projectId: { in: projectIds } } }),
  ]);

  return {
    annotations,
    annotationQueues,
    annotationQueueItems,
    annotationScores,
    batchEvaluations,
    customGraphs,
    datasets,
    datasetRecords,
    experiments,
    triggers,
    workflows,
  };
}

/**
 * The counts ClickHouse holds.
 *
 * Asked per organization, because its tenant column is the organization and a
 * query spanning tenants has no partition to prune.
 */
async function countIngestedResources({
  organizationIds,
  projectIds,
  repository,
}: {
  organizationIds: string[];
  projectIds: string[];
  repository: InstanceUsageStatsRepository;
}) {
  const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0);
  const [traces, scenarioEvents] = await Promise.all([
    Promise.all(
      organizationIds.map((organizationId) =>
        repository.findTraceCount({ organizationId, projectIds }),
      ),
    ),
    Promise.all(
      organizationIds.map((organizationId) =>
        repository.findScenarioRunCount({ organizationId, projectIds }),
      ),
    ),
  ]);

  return {
    totalTraces: sum(traces),
    totalScenarioEvents: sum(scenarioEvents),
  };
}

/**
 * The counts one install reports.
 *
 * Counted over every organization the install carries, because the install is
 * what reports. It used to be counted per organization, from an id built out
 * of the organization's name, which meant an install with three organizations
 * sent three reports that nothing could join back together.
 */
export async function collectUsageStats({
  organizationIds,
  repository = getApp().usageStats.instance,
}: {
  organizationIds: string[];
  /** Defaults to the repository the composition root built. */
  repository?: InstanceUsageStatsRepository;
}) {
  if (organizationIds.length === 0) {
    throw new Error("an install with no organization has nothing to report");
  }

  const projectIds = await projectIdsOf(organizationIds);
  const [stored, ingested] = await Promise.all([
    countStoredResources(projectIds),
    countIngestedResources({ organizationIds, projectIds, repository }),
  ]);

  return {
    ...ingested,
    ...stored,
    timestamp: new Date().toISOString(),
  };
}
