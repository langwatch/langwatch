import {
  UsageStatsProjectRepository,
  type UsageStatsProjectDatabase,
  type UsageStatsProjectCounts,
} from "../../ports/usage-stats-worker.ports";

export class PrismaUsageStatsProjectRepository extends UsageStatsProjectRepository {
  private constructor(private readonly database: UsageStatsProjectDatabase) {
    super();
  }

  static create(database: UsageStatsProjectDatabase): PrismaUsageStatsProjectRepository {
    return new PrismaUsageStatsProjectRepository(database);
  }

  async collectProjectCounts({
    organizationId,
    builderChartKind,
  }: {
    organizationId: string;
    builderChartKind: string;
  }): Promise<UsageStatsProjectCounts> {
    const projects = await this.database.project.findMany({
      where: {
        team: { organizationId },
      },
      select: {
        id: true,
      },
    });
    const projectIds = projects.map((project) => project.id);

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
      this.database.annotation.count({ where: { projectId: { in: projectIds } } }),
      this.database.annotationQueue.count({ where: { projectId: { in: projectIds } } }),
      this.database.annotationQueueItem.count({
        where: { projectId: { in: projectIds } },
      }),
      this.database.annotationScore.count({ where: { projectId: { in: projectIds } } }),
      this.database.batchEvaluation.count({ where: { projectId: { in: projectIds } } }),
      this.database.customGraph.count({
        where: {
          projectId: { in: projectIds },
          kind: builderChartKind,
        },
      }),
      this.database.dataset.count({ where: { projectId: { in: projectIds } } }),
      this.database.datasetRecord.count({ where: { projectId: { in: projectIds } } }),
      this.database.experiment.count({ where: { projectId: { in: projectIds } } }),
      this.database.trigger.count({ where: { projectId: { in: projectIds } } }),
      this.database.workflow.count({ where: { projectId: { in: projectIds } } }),
    ]);

    return {
      projectIds,
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
}
