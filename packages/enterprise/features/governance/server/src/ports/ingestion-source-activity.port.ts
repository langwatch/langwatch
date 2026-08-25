import type {
  ActivityEventDetailRow,
  ActivityMonitorPagedWindowQuery,
  ActivityMonitorSummary,
  ActivityMonitorWindowQuery,
  IngestionSourceHealthRow,
  RecentAnomalyRow,
  SourceHealthMetrics,
  SpendByDepartmentRow,
  SpendByTeamRow,
  SpendByUserRow,
  SpendOverTimeGroupBy,
  SpendOverTimeResult,
} from "@langwatch/enterprise-governance-contract";

export abstract class ActivityMonitorRepository {
  abstract summary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary>;
  abstract spendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]>;
  abstract spendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]>;
  abstract spendByDepartment(
    input: ActivityMonitorWindowQuery,
  ): Promise<SpendByDepartmentRow[]>;
  abstract spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult>;
  abstract recentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]>;
  abstract ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]>;
  abstract eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]>;
  abstract sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics>;
}

export type GovernanceClickHouseResult = {
  json(): Promise<unknown>;
};

export abstract class GovernanceClickHouseClientPort {
  abstract query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<GovernanceClickHouseResult>;
}

export abstract class GovernanceClickHouseResolverPort {
  abstract tryResolve(
    organizationId: string,
  ): Promise<GovernanceClickHouseClientPort | null>;
}
