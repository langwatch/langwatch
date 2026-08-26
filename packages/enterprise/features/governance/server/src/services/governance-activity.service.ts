// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  ActivityMonitorPagedWindowQuery,
  ActivityMonitorSummary,
  ActivityMonitorWindowQuery,
  ActivityEventDetailRow,
  IngestionSourceHealthRow,
  RecentAnomalyRow,
  SourceHealthMetrics,
  SpendByDepartmentRow,
  SpendByTeamRow,
  SpendByUserRow,
  SpendOverTimeGroupBy,
  SpendOverTimeResult,
} from "@langwatch/enterprise-governance-contract";
import type { ActivityMonitorService } from "./ingestion-source-activity.service";

/** Keeps Governance activity reads behind one private capability. */
export class GovernanceActivityService {
  private constructor(private readonly activity: ActivityMonitorService) {}

  static create(activity: ActivityMonitorService): GovernanceActivityService {
    return new GovernanceActivityService(activity);
  }

  summary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary> {
    return this.activity.summary(input);
  }

  spendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]> {
    return this.activity.spendByUser(input);
  }

  spendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]> {
    return this.activity.spendByTeam(input);
  }

  spendByDepartment(input: ActivityMonitorWindowQuery): Promise<SpendByDepartmentRow[]> {
    return this.activity.spendByDepartment(input);
  }

  spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult> {
    return this.activity.spendOverTime(input);
  }

  recentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]> {
    return this.activity.recentAnomalies(input);
  }

  ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]> {
    return this.activity.ingestionSourcesHealth(input);
  }

  eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]> {
    return this.activity.eventsForSource(input);
  }

  sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics> {
    return this.activity.sourceHealthMetrics(input);
  }
}
