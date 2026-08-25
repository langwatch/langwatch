import type {
  UsageStatsClickHouseRepository,
  UsageStatsProjectRepository,
  UsageStatsReport,
} from "../ports/usage-stats-worker.ports";

export interface UsageStatsCollectionServiceOptions {
  projects: UsageStatsProjectRepository;
  clickhouse: UsageStatsClickHouseRepository;
  builderChartKind: string;
  now: () => Date;
}

/** Collects the organization-wide usage report sent by the daily Ops worker. */
export class UsageStatsCollectionService {
  private constructor(private readonly options: UsageStatsCollectionServiceOptions) {}

  static create(
    options: UsageStatsCollectionServiceOptions,
  ): UsageStatsCollectionService {
    return new UsageStatsCollectionService(options);
  }

  async collect({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<UsageStatsReport> {
    const counts = await this.options.projects.collectProjectCounts({
      organizationId,
      builderChartKind: this.options.builderChartKind,
    });
    const { projectIds, ...projectCounts } = counts;
    const [totalTraces, totalScenarioEvents] = await Promise.all([
      this.options.clickhouse.findTraceCount({ organizationId, projectIds }),
      this.options.clickhouse.findScenarioRunCount({ organizationId, projectIds }),
    ]);

    return {
      totalTraces,
      totalScenarioEvents,
      ...projectCounts,
      timestamp: this.options.now().toISOString(),
    };
  }
}
