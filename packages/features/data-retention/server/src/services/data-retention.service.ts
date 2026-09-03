import {
  DataRetentionService as DataRetentionServiceContract,
  DataRetentionBackendUnavailableError,
  killRetroactiveMutationInputSchema,
  ScopeTargetNotFoundError,
  platformDefaultRetentionDaysSchema,
  resolveRetention,
  resolveScopeChain,
  retentionDaysInputSchema,
  retroactiveMutationProjectInputSchema,
  retroactiveRetentionUpdateInputSchema,
  type KillRetroactiveMutationInput,
  type ResolvedRetention,
  type RetentionCategory,
  type RetentionPolicy,
  type ScopeAssignment,
  type PinnedTrace,
  type PinTraceInput,
  type RetroactiveMutationProgress,
  type RetroactiveMutationProjectInput,
  type RetroactiveRetentionUpdateInput,
  pinTraceInputSchema,
  type UnpinTraceInput,
  unpinTraceInputSchema,
} from "@langwatch/data-retention-contract";
import {
  TeamNotFoundError,
  type OrganizationService,
  type OrganizationTeam,
} from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { DataRetentionRepository } from "../repositories/data-retention.repository";
import { PinnedTraceRepository } from "../repositories/pinned-trace.repository";
import { RetroactiveRetentionRepository } from "../repositories/retroactive-retention.repository";
import type { DataRetentionCacheStore } from "../stores/data-retention-cache.store";
import { StorageMeterService } from "./storage-meter.service";

export class DataRetentionService extends DataRetentionServiceContract {
  static create(options: {
    repository: DataRetentionRepository;
    projects: ProjectService;
    organizations: OrganizationService;
    defaultRetentionDays: number;
    pinRepository: PinnedTraceRepository;
    retroactiveRepository?: RetroactiveRetentionRepository | null;
    cache?: DataRetentionCacheStore;
    storageMeter?: StorageMeterService;
  }): DataRetentionService {
    return new DataRetentionService(
      options.repository,
      options.projects,
      options.organizations,
      platformDefaultRetentionDaysSchema.parse(options.defaultRetentionDays),
      options.pinRepository,
      options.retroactiveRepository ?? null,
      options.storageMeter ?? StorageMeterService.create({ resolveClickHouseClient: null }),
      options.cache,
    );
  }

  private constructor(
    private readonly repository: DataRetentionRepository,
    private readonly projects: ProjectService,
    private readonly organizations: OrganizationService,
    private readonly defaultRetentionDays: number,
    private readonly pinRepository: PinnedTraceRepository,
    private readonly retroactiveRepository: RetroactiveRetentionRepository | null,
    private readonly storageMeter: StorageMeterService,
    private readonly cache?: DataRetentionCacheStore,
  ) {
    super();
  }

  async getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention> {
    const cached = await this.cache?.tryGet(input.projectId);
    if (cached !== void 0) {
      return cached;
    }

    const project = await this.projects.tryGetWithTeam(input.projectId);
    const context = project
      ? {
          organizationId: project.team.organizationId,
          teamId: project.teamId,
          projectId: project.id,
        }
      : null;
    const resolved = context
      ? resolveRetention({
          rows: await this.repository.findForProjectChain({
            organizationId: context.organizationId,
            scopes: resolveScopeChain(context),
          }),
          chain: resolveScopeChain(context),
          defaultRetentionDays: this.defaultRetentionDays,
        })
      : this.defaultRetention();
    await this.cache?.set(input.projectId, resolved);

    return resolved;
  }

  async getRetentionDays(input: {
    projectId: string;
    category: RetentionCategory;
  }): Promise<number> {
    const retention = await this.getResolvedForProject({ projectId: input.projectId });
    return retention[input.category];
  }

  async previewScopeRemoval(input: { scope: ScopeAssignment }): Promise<ResolvedRetention> {
    const resolvedScope = await this.tryResolveScope(input.scope);
    if (!resolvedScope) {
      return this.defaultRetention();
    }

    const rows = await this.repository.findAllInOrganization({
      organizationId: resolvedScope.organizationId,
    });
    const remaining = rows.filter(
      (row) => !(row.scopeType === input.scope.scopeType && row.scopeId === input.scope.scopeId),
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
    const resolvedScope = await this.tryResolveScope(input.scope);
    if (!resolvedScope) {
      throw new ScopeTargetNotFoundError("Scope target not found.");
    }

    const row = await this.repository.upsertForScope({
      ...input,
      retentionDays,
      organizationId: resolvedScope.organizationId,
    });
    await this.invalidateForScope(input.scope);
    return row;
  }

  async removeForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
  }): Promise<void> {
    await this.repository.deleteForScope(input);
    await this.invalidateForScope(input.scope);
  }

  async pin(input: PinTraceInput): Promise<PinnedTrace> {
    const parsed = pinTraceInputSchema.parse(input);
    return this.pinRepository.create({ ...parsed, source: "manual" });
  }

  async unpin(input: UnpinTraceInput): Promise<void> {
    const parsed = unpinTraceInputSchema.parse(input);
    await this.pinRepository.delete(parsed);
  }

  async autoPin(input: UnpinTraceInput): Promise<PinnedTrace> {
    const parsed = unpinTraceInputSchema.parse(input);
    return this.pinRepository.create({ ...parsed, source: "share" });
  }

  async autoUnpin(input: UnpinTraceInput): Promise<void> {
    const parsed = unpinTraceInputSchema.parse(input);
    if (await this.pinRepository.hasManualPin(parsed)) {
      return;
    }

    await this.pinRepository.delete(parsed);
  }

  async isPinned(input: UnpinTraceInput): Promise<boolean> {
    return (
      (await this.pinRepository.tryFindByProjectAndTrace(unpinTraceInputSchema.parse(input))) !=
      null
    );
  }

  async tryGetPin(input: UnpinTraceInput): Promise<PinnedTrace | null> {
    return this.pinRepository.tryFindByProjectAndTrace(unpinTraceInputSchema.parse(input));
  }

  listByProject(input: { projectId: string }): Promise<PinnedTrace[]> {
    return this.pinRepository.findAllByProject(input);
  }

  getPinnedTraceIds(input: { projectId: string }): Promise<string[]> {
    return this.pinRepository.findAllTraceIds(input);
  }

  async triggerRetroactiveUpdate(
    input: RetroactiveRetentionUpdateInput,
  ): Promise<{ tables: string[] }> {
    const parsed = retroactiveRetentionUpdateInputSchema.parse(input);
    if (!this.retroactiveRepository) {
      throw new DataRetentionBackendUnavailableError();
    }

    return this.retroactiveRepository.triggerUpdate(parsed);
  }

  async getRetroactiveMutationProgress(
    input: RetroactiveMutationProjectInput,
  ): Promise<RetroactiveMutationProgress[]> {
    const parsed = retroactiveMutationProjectInputSchema.parse(input);
    if (!this.retroactiveRepository) {
      return [];
    }

    return this.retroactiveRepository.getMutationProgress(parsed);
  }

  async killRetroactiveMutation(input: KillRetroactiveMutationInput): Promise<void> {
    const parsed = killRetroactiveMutationInputSchema.parse(input);
    await this.retroactiveRepository?.killMutation(parsed);
  }

  getTotalStorageBytes(input: { tenantId: string }): Promise<number> {
    return this.storageMeter.getTotalStorageBytes(input);
  }

  getTotalStorageBytesForTenants(input: { tenantIds: string[] }): Promise<number> {
    return this.storageMeter.getTotalStorageBytesForTenants(input);
  }

  private defaultRetention(): ResolvedRetention {
    return {
      traces: this.defaultRetentionDays,
      scenarios: this.defaultRetentionDays,
      experiments: this.defaultRetentionDays,
    };
  }

  private async invalidateForScope(scope: ScopeAssignment): Promise<void> {
    const projectIds = await this.findAffectedProjectIds(scope);
    await Promise.all(projectIds.map((projectId) => this.cache?.delete(projectId)));
  }

  private async tryResolveScope(scope: ScopeAssignment): Promise<{
    organizationId: string;
    chain: ScopeAssignment[];
  } | null> {
    if (scope.scopeType === "ORGANIZATION") {
      return { organizationId: scope.scopeId, chain: [scope] };
    }
    if (scope.scopeType === "TEAM") {
      const team = await this.tryGetTeam(scope.scopeId);
      if (!team) {
        return null;
      }

      return {
        organizationId: team.organizationId,
        chain: [scope, { scopeType: "ORGANIZATION", scopeId: team.organizationId }],
      };
    }
    const project = await this.projects.tryGetWithTeam(scope.scopeId);
    if (!project) {
      return null;
    }

    return {
      organizationId: project.team.organizationId,
      chain: resolveScopeChain({
        projectId: project.id,
        teamId: project.teamId,
        organizationId: project.team.organizationId,
      }),
    };
  }

  private async findAffectedProjectIds(scope: ScopeAssignment): Promise<string[]> {
    if (scope.scopeType === "PROJECT") {
      return [scope.scopeId];
    }

    if (scope.scopeType === "TEAM") {
      const team = await this.tryGetTeam(scope.scopeId);
      if (!team) {
        return [];
      }

      const projects = await this.projects.listByTeam({
        organizationId: team.organizationId,
        teamId: scope.scopeId,
      });
      return projects.map((project) => project.id);
    }
    const projects = await this.projects.listByOrganization({
      organizationId: scope.scopeId,
      page: 1,
      limit: 10_000,
    });
    return projects.data.map((project) => project.id);
  }

  private async tryGetTeam(teamId: string): Promise<OrganizationTeam | null> {
    try {
      return await this.organizations.getTeamById({ teamId });
    } catch (error) {
      if (error instanceof TeamNotFoundError) {
        return null;
      }

      throw error;
    }
  }
}
