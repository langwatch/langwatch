// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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

/** The organization's hidden governance project, resolved by the caller from its owner. */
export type ActivityMonitorTenant = { govProjectId: string | null };

export interface ActivityMonitorRepository {
  sourceDataCoverage(input: {
    organizationId: string;
    sourceId: string;
    windowDays: number;
  }): Promise<{
    health: "healthy" | "unhealthy";
    consecutiveFailures: number;
    lastSuccessfulPullIso: string | null;
    days: { dayStartIso: string; covered: boolean }[];
  }>;
  summary(
    input: ActivityMonitorWindowQuery & ActivityMonitorTenant,
  ): Promise<ActivityMonitorSummary>;
  spendByUser(
    input: ActivityMonitorPagedWindowQuery & ActivityMonitorTenant,
  ): Promise<SpendByUserRow[]>;
  spendByTeam(
    input: ActivityMonitorPagedWindowQuery & ActivityMonitorTenant,
  ): Promise<SpendByTeamRow[]>;
  spendByDepartment(input: ActivityMonitorWindowQuery): Promise<SpendByDepartmentRow[]>;
  spendOverTime(
    input: {
      organizationId: string;
      windowDays: number;
      groupBy: SpendOverTimeGroupBy;
    } & ActivityMonitorTenant,
  ): Promise<SpendOverTimeResult>;
  recentAnomalies(input: { organizationId: string; limit?: number }): Promise<RecentAnomalyRow[]>;
  ingestionSourcesHealth(
    input: { organizationId: string } & ActivityMonitorTenant,
  ): Promise<IngestionSourceHealthRow[]>;
  eventsForSource(
    input: {
      organizationId: string;
      sourceId: string;
      limit?: number;
      beforeIso?: string;
    } & ActivityMonitorTenant,
  ): Promise<ActivityEventDetailRow[]>;
  sourceHealthMetrics(
    input: { organizationId: string; sourceId: string } & ActivityMonitorTenant,
  ): Promise<SourceHealthMetrics>;
}
