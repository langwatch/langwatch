import {
  DataRetentionService as DataRetentionServiceContract,
  platformDefaultRetentionDaysSchema,
  resolveRetention,
  resolveScopeChain,
  retentionDaysInputSchema,
  type ResolvedRetention,
  type RetentionCategory,
  type RetentionPolicy,
  type ScopeAssignment,
} from "@langwatch/data-retention-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { DataRetentionRepository } from "../repositories/data-retention.repository";

export class DataRetentionService extends DataRetentionServiceContract {
  static create(options: {
    repository: DataRetentionRepository;
    projects: ProjectService;
    organizations: OrganizationService;
    defaultRetentionDays: number;
  }): DataRetentionService {
    return new DataRetentionService(
      options.repository,
      options.projects,
      options.organizations,
      platformDefaultRetentionDaysSchema.parse(options.defaultRetentionDays),
    );
  }

  private constructor(
    private readonly repository: DataRetentionRepository,
    private readonly projects: ProjectService,
    private readonly organizations: OrganizationService,
    private readonly defaultRetentionDays: number,
  ) {
    super();
  }

  async getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention> {
    const project = await this.projects.getWithTeam(input.projectId);
    const chain = resolveScopeChain({
      projectId: project.id,
      teamId: project.teamId,
      organizationId: project.team.organizationId,
    });
    return resolveRetention({
      rows: await this.repository.findForScopes({
        organizationId: project.team.organizationId,
        scopes: chain,
      }),
      chain,
      defaultRetentionDays: this.defaultRetentionDays,
    });
  }

  async getRetentionDays(input: {
    projectId: string;
    category: RetentionCategory;
  }): Promise<number> {
    return (await this.getResolvedForProject({ projectId: input.projectId }))[
      input.category
    ];
  }

  async previewScopeRemoval(input: {
    scope: ScopeAssignment;
  }): Promise<ResolvedRetention> {
    const resolvedScope = await this.resolveScope(input.scope);
    const rows = await this.repository.findAllInOrganization({
      organizationId: resolvedScope.organizationId,
    });
    const remaining = rows.filter(
      (row) =>
        !(row.scopeType === input.scope.scopeType && row.scopeId === input.scope.scopeId),
    );
    return resolveRetention({
      rows: remaining,
      chain: resolvedScope.chain,
      defaultRetentionDays: this.defaultRetentionDays,
    });
  }

  listOrganizationRules(input: { organizationId: string }): Promise<RetentionPolicy[]> {
    return this.repository.findAllInOrganization(input);
  }

  tryGetPolicyById(input: { id: string }): Promise<RetentionPolicy | null> {
    return this.repository.tryFindById(input);
  }

  async setForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy> {
    const retentionDays = retentionDaysInputSchema.parse(input.retentionDays);
    const resolvedScope = await this.resolveScope(input.scope);
    const row = await this.repository.upsertForScope({
      ...input,
      retentionDays,
      organizationId: resolvedScope.organizationId,
    });
    return row;
  }

  async removeForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
  }): Promise<void> {
    await this.repository.deleteForScope(input);
  }

  private async resolveScope(scope: ScopeAssignment): Promise<{
    organizationId: string;
    chain: ScopeAssignment[];
  }> {
    if (scope.scopeType === "ORGANIZATION") {
      return { organizationId: scope.scopeId, chain: [scope] };
    }
    if (scope.scopeType === "TEAM") {
      const team = await this.organizations.getTeamById({ teamId: scope.scopeId });
      return {
        organizationId: team.organizationId,
        chain: [scope, { scopeType: "ORGANIZATION", scopeId: team.organizationId }],
      };
    }
    const project = await this.projects.getWithTeam(scope.scopeId);
    return {
      organizationId: project.team.organizationId,
      chain: resolveScopeChain({
        projectId: project.id,
        teamId: project.teamId,
        organizationId: project.team.organizationId,
      }),
    };
  }
}
