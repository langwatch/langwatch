import type {
  UsageStatsCountInput,
  UsageStatsOrganization,
  UsageStatsProjectCounts,
} from "../../ports/usage-stats-worker.port.ts";

/** Private Ops repository boundary for project-scoped relational usage. */
export abstract class UsageStatsProjectRepository {
  abstract collectProjectCounts(input: {
    organizationId: string;
    builderChartKind: string;
  }): Promise<UsageStatsProjectCounts>;
}

/** Private Ops repository boundary for organization-wide ClickHouse usage. */
export abstract class UsageStatsClickHouseRepository {
  abstract findTraceCount(input: UsageStatsCountInput): Promise<number>;
  abstract findScenarioRunCount(input: UsageStatsCountInput): Promise<number>;
}

/** Private Ops repository boundary for organizations that need reporting. */
export abstract class UsageStatsOrganizationRepository {
  abstract listForUsageStats(): Promise<UsageStatsOrganization[]>;
}
