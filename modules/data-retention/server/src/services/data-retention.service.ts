import {
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
  type OrganizationApi,
  type OrganizationTeam,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { DataRetentionRepository } from "../repositories/data-retention.repository.ts";
import type { PinnedTraceRepository } from "../repositories/pinned-trace.repository.ts";
import type { RetroactiveRetentionRepository } from "../repositories/retroactive-retention.repository.ts";
import type { DataRetentionCacheStore } from "../stores/data-retention-cache.store.ts";
import type { StorageMeterService } from "./storage-meter.service.ts";

export type DataRetentionServiceOptions = Readonly<{
  policies: DataRetentionRepository;
  pins: PinnedTraceRepository;
  projects: ProjectApi;
  organizations: OrganizationApi;
  defaultRetentionDays: number;
  /** Null on a deployment that composed no ClickHouse. */
  retroactive: RetroactiveRetentionRepository | null;
  cache: DataRetentionCacheStore;
  storageMeter: StorageMeterService;
}>;

export class DataRetentionService {
  static create(options: DataRetentionServiceOptions): DataRetentionService {
    return new DataRetentionService({
      ...options,
      defaultRetentionDays: platformDefaultRetentionDaysSchema.parse(options.defaultRetentionDays),
    });
  }

  private constructor(private readonly options: DataRetentionServiceOptions) {}

  async getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention> {
    const cached = await this.options.cache.tryGet(input.projectId);
    if (cached !== void 0) {
      return cached;
    }

    const project = await this.options.projects.tryGetWithTeam(input.projectId);
    const context = project
      ? {
          organizationId: project.team.organizationId,
          teamId: project.teamId,
          projectId: project.id,
        }
      : null;
    const resolved = context
      ? resolveRetention({
          rows: await this.options.policies.findForProjectChain({
            organizationId: context.organizationId,
            scopes: resolveScopeChain(context),
          }),
          chain: resolveScopeChain(context),
          defaultRetentionDays: this.options.defaultRetentionDays,
        })
      : this.defaultRetention();
    await this.options.cache.set(input.projectId, resolved);

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
    const resolvedScope = await this.findScopeChain(input.scope);
    if (!resolvedScope) {
      return this.defaultRetention();
    }

    const rows = await this.options.policies.findAllInOrganization({
      organizationId: resolvedScope.organizationId,
    });
    const remaining = rows.filter(
      (row) => !(row.scopeType === input.scope.scopeType && row.scopeId === input.scope.scopeId),
    );

    return resolveRetention({
      rows: remaining,
      chain: resolvedScope.chain,
      defaultRetentionDays: this.options.defaultRetentionDays,
    });
  }

  listOrganizationRules(input: { organizationId: string }): Promise<RetentionPolicy[]> {
    return this.options.policies.findAllInOrganization(input);
  }

  async setForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy> {
    const retentionDays = retentionDaysInputSchema.parse(input.retentionDays);
    const resolvedScope = await this.findScopeChain(input.scope);
    if (!resolvedScope) {
      throw new ScopeTargetNotFoundError("Scope target not found.");
    }

    const row = await this.options.policies.upsertForScope({
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
    await this.options.policies.deleteForScope(input);
    await this.invalidateForScope(input.scope);
  }

  async pin(input: PinTraceInput): Promise<PinnedTrace> {
    const parsed = pinTraceInputSchema.parse(input);

    return this.options.pins.create({ ...parsed, source: "manual" });
  }

  async unpin(input: UnpinTraceInput): Promise<void> {
    const parsed = unpinTraceInputSchema.parse(input);
    await this.options.pins.delete(parsed);
  }

  async autoPin(input: UnpinTraceInput): Promise<PinnedTrace> {
    const parsed = unpinTraceInputSchema.parse(input);

    return this.options.pins.create({ ...parsed, source: "share" });
  }

  async autoUnpin(input: UnpinTraceInput): Promise<void> {
    const parsed = unpinTraceInputSchema.parse(input);
    const keptByHand = await this.options.pins.hasManualPin(parsed);
    if (keptByHand) {
      return;
    }

    await this.options.pins.delete(parsed);
  }

  async isPinned(input: UnpinTraceInput): Promise<boolean> {
    const pin = await this.options.pins.findByProjectAndTrace(unpinTraceInputSchema.parse(input));

    return pin !== null;
  }

  async findPin(input: UnpinTraceInput): Promise<PinnedTrace | null> {
    return this.options.pins.findByProjectAndTrace(unpinTraceInputSchema.parse(input));
  }

  listByProject(input: { projectId: string }): Promise<PinnedTrace[]> {
    return this.options.pins.findAllByProject(input);
  }

  getPinnedTraceIds(input: { projectId: string }): Promise<string[]> {
    return this.options.pins.findAllTraceIds(input);
  }

  async triggerRetroactiveUpdate(
    input: RetroactiveRetentionUpdateInput,
  ): Promise<{ tables: string[] }> {
    const parsed = retroactiveRetentionUpdateInputSchema.parse(input);
    if (!this.options.retroactive) {
      throw new DataRetentionBackendUnavailableError();
    }

    return this.options.retroactive.triggerUpdate(parsed);
  }

  async getRetroactiveMutationProgress(
    input: RetroactiveMutationProjectInput,
  ): Promise<RetroactiveMutationProgress[]> {
    const parsed = retroactiveMutationProjectInputSchema.parse(input);
    if (!this.options.retroactive) {
      return [];
    }

    return this.options.retroactive.getMutationProgress(parsed);
  }

  async killRetroactiveMutation(input: KillRetroactiveMutationInput): Promise<void> {
    const parsed = killRetroactiveMutationInputSchema.parse(input);
    await this.options.retroactive?.killMutation(parsed);
  }

  getTotalStorageBytes(input: { tenantId: string }): Promise<number> {
    return this.options.storageMeter.getTotalStorageBytes(input);
  }

  getTotalStorageBytesForTenants(input: { tenantIds: string[] }): Promise<number> {
    return this.options.storageMeter.getTotalStorageBytesForTenants(input);
  }

  private defaultRetention(): ResolvedRetention {
    return {
      traces: this.options.defaultRetentionDays,
      scenarios: this.options.defaultRetentionDays,
      experiments: this.options.defaultRetentionDays,
    };
  }

  private async invalidateForScope(scope: ScopeAssignment): Promise<void> {
    const projectIds = await this.findAffectedProjectIds(scope);
    await Promise.all(projectIds.map((projectId) => this.options.cache.delete(projectId)));
  }

  private async findScopeChain(scope: ScopeAssignment): Promise<{
    organizationId: string;
    chain: ScopeAssignment[];
  } | null> {
    if (scope.scopeType === "ORGANIZATION") {
      return { organizationId: scope.scopeId, chain: [scope] };
    }

    if (scope.scopeType === "TEAM") {
      const team = await this.findTeam(scope.scopeId);
      if (!team) {
        return null;
      }

      return {
        organizationId: team.organizationId,
        chain: [scope, { scopeType: "ORGANIZATION", scopeId: team.organizationId }],
      };
    }

    const project = await this.options.projects.tryGetWithTeam(scope.scopeId);
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
      const team = await this.findTeam(scope.scopeId);
      if (!team) {
        return [];
      }

      const projects = await this.options.projects.listByTeam({
        organizationId: team.organizationId,
        teamId: scope.scopeId,
      });

      return projects.map((project) => project.id);
    }

    const projects = await this.options.projects.listByOrganization({
      organizationId: scope.scopeId,
      page: 1,
      limit: 10_000,
    });

    return projects.data.map((project) => project.id);
  }

  private async findTeam(teamId: string): Promise<OrganizationTeam | null> {
    try {
      return await this.options.organizations.getTeamById({ teamId });
    } catch (error) {
      if (error instanceof TeamNotFoundError) {
        return null;
      }

      throw error;
    }
  }
}
