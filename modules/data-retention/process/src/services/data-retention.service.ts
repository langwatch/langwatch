import {
  ScopeTargetNotFoundError,
  platformDefaultRetentionDaysSchema,
  resolveRetention,
  resolveScopeChain,
  retentionDaysInputSchema,
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
import type { FoldStateRead } from "@langwatch/eventing";
import {
  TeamNotFoundError,
  type OrganizationApi,
  type OrganizationTeam,
} from "@langwatch/organization-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";

import type { DataRetentionCacheRepository } from "../repositories/data-retention-cache.repository.ts";
import type { DataRetentionProjectScopeState } from "../repositories/data-retention-project-scope.repository.ts";
import type { DataRetentionRepository } from "../repositories/data-retention.repository.ts";
import type { PinnedTraceRepository } from "../repositories/pinned-trace.repository.ts";
import type { RetroactiveRetentionRepository } from "../repositories/retroactive-retention.repository.ts";
import type { StorageMeterService } from "./storage-meter.service.ts";

/** The read side of the project-scope fold: this service never writes it. */
type ProjectScopeReader = {
  get(aggregateId: string): Promise<FoldStateRead<DataRetentionProjectScopeState>>;
  findProjectIds(input: { organizationId: string; teamId?: string }): Promise<string[]>;
};

type DataRetentionServiceOptions = Readonly<{
  policies: DataRetentionRepository;
  pins: PinnedTraceRepository;
  /** Where each project sits, folded from project's facts: no project peer (Q151 Q1). */
  projectScopes: ProjectScopeReader;
  organizations: OrganizationApi;
  defaultRetentionDays: number;
  /**
   * The rewrite path. Not nullable: a deployment with no ClickHouse refuses at
   * boot, so by the time this service exists there is a store behind it —
   * answering `[]` for "no backend" let an in-flight rewrite read as finished.
   */
  retroactive: RetroactiveRetentionRepository;
  cache: DataRetentionCacheRepository;
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

  /** The days a row with no override in its cascade is kept for. */
  getPlatformDefaultRetentionDays(): number {
    return this.options.defaultRetentionDays;
  }

  async getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention> {
    const cached = await this.options.cache.get(input.projectId);
    if (cached.kind === "hit") {
      return cached.value;
    }

    // A project not folded yet is refused, never cached: the job retries until its fact lands.
    const context = await this.findProjectContext(input.projectId);
    if (!context) throw new ProjectNotFoundError();
    const chain = resolveScopeChain(context);
    const resolved = resolveRetention({
      rows: await this.options.policies.findForProjectChain({
        organizationId: context.organizationId,
        scopes: chain,
      }),
      chain,
      defaultRetentionDays: this.options.defaultRetentionDays,
    });
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
    return this.options.retroactive.triggerUpdate(parsed);
  }

  async getRetroactiveMutationProgress(
    input: RetroactiveMutationProjectInput,
  ): Promise<RetroactiveMutationProgress[]> {
    return this.options.retroactive.findMutationProgress(input);
  }

  async killRetroactiveMutation(input: KillRetroactiveMutationInput): Promise<void> {
    await this.options.retroactive.killMutation(input);
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

    const context = await this.findProjectContext(scope.scopeId);
    if (!context) {
      return null;
    }

    return { organizationId: context.organizationId, chain: resolveScopeChain(context) };
  }

  /** The project's chain as folded; null until a fact naming its team has folded. */
  private async findProjectContext(projectId: string): Promise<{
    organizationId: string;
    teamId: string;
    projectId: string;
  } | null> {
    const scope = await this.options.projectScopes.get(projectId);
    if (scope.kind === "empty" || scope.state.teamId === null) {
      return null;
    }

    return { organizationId: scope.state.organizationId, teamId: scope.state.teamId, projectId };
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

      return this.options.projectScopes.findProjectIds({
        organizationId: team.organizationId,
        teamId: scope.scopeId,
      });
    }

    return this.options.projectScopes.findProjectIds({ organizationId: scope.scopeId });
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
