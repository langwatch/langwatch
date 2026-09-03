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
import type { ActivityMonitorRepository } from "../ports/ingestion-source-activity.port";

export class ActivityMonitorService {
  private constructor(private readonly repository: ActivityMonitorRepository) {}

  static create(repository: ActivityMonitorRepository): ActivityMonitorService {
    return new ActivityMonitorService(repository);
  }

  summary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary> {
    return this.repository.summary(input);
  }

  spendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]> {
    return this.repository.spendByUser(input);
  }

  spendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]> {
    return this.repository.spendByTeam(input);
  }

  spendByDepartment(input: ActivityMonitorWindowQuery): Promise<SpendByDepartmentRow[]> {
    return this.repository.spendByDepartment(input);
  }

  spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult> {
    return this.repository.spendOverTime(input);
  }

  recentAnomalies(input: { organizationId: string; limit?: number }): Promise<RecentAnomalyRow[]> {
    return this.repository.recentAnomalies(input);
  }

  ingestionSourcesHealth(input: { organizationId: string }): Promise<IngestionSourceHealthRow[]> {
    return this.repository.ingestionSourcesHealth(input);
  }

  eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]> {
    return this.repository.eventsForSource(input);
  }

  sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics> {
    return this.repository.sourceHealthMetrics(input);
  }
}
