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
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";

import type { ActivityMonitorRepository } from "../repositories/activity-monitor.repository.ts";

export class ActivityMonitorService {
  private constructor(
    private readonly repository: ActivityMonitorRepository,
    private readonly projects: Pick<ProjectApi, "findInternal">,
  ) {}

  static create({
    repository,
    projects,
  }: {
    repository: ActivityMonitorRepository;
    projects: Pick<ProjectApi, "findInternal">;
  }): ActivityMonitorService {
    return new ActivityMonitorService(repository, projects);
  }

  private async findGovProjectId(organizationId: string): Promise<string | null> {
    const project = await this.projects.findInternal({
      organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    return project?.id ?? null;
  }

  sourceDataCoverage(input: {
    organizationId: string;
    sourceId: string;
    windowDays: number;
  }): ReturnType<ActivityMonitorRepository["sourceDataCoverage"]> {
    return this.repository.sourceDataCoverage(input);
  }

  async summary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    return this.repository.summary({ ...input, govProjectId });
  }

  async spendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    return this.repository.spendByUser({ ...input, govProjectId });
  }

  async spendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    return this.repository.spendByTeam({ ...input, govProjectId });
  }

  spendByDepartment(input: ActivityMonitorWindowQuery): Promise<SpendByDepartmentRow[]> {
    return this.repository.spendByDepartment(input);
  }

  async spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    return this.repository.spendOverTime({ ...input, govProjectId });
  }

  recentAnomalies(input: { organizationId: string; limit?: number }): Promise<RecentAnomalyRow[]> {
    return this.repository.recentAnomalies(input);
  }

  async ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    return this.repository.ingestionSourcesHealth({ ...input, govProjectId });
  }

  async eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    return this.repository.eventsForSource({ ...input, govProjectId });
  }

  async sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    return this.repository.sourceHealthMetrics({ ...input, govProjectId });
  }
}
