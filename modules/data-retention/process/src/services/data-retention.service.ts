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
import { ProjectNotFoundError } from "@langwatch/project-contract";

import type { DataRetentionCacheRepository } from "../repositories/data-retention-cache.repository.ts";
import type { DataRetentionProjectScopeRepository } from "../repositories/data-retention-project-scope.repository.ts";
import type { DataRetentionRepository } from "../repositories/data-retention.repository.ts";
import type { PinnedTraceRepository } from "../repositories/pinned-trace.repository.ts";
import type { RetroactiveRetentionRepository } from "../repositories/retroactive-retention.repository.ts";
import type { StorageMeterService } from "./storage-meter.service.ts";

type DataRetentionServiceOptions = Readonly<{
  policies: DataRetentionRepository;
  pins: PinnedTraceRepository;
  /** Where each project sits, read through project's and organization's shares (R40). */
  projectScopes: DataRetentionProjectScopeRepository;
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

    // A project with no row is refused, never cached: the job retries until the row exists.
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

  /** Refuses a target that does not sit in `organizationId`, as its row places it. */
  async assertScopeInOrganization(input: {
    organizationId: string;
    scope: ScopeAssignment;
  }): Promise<void> {
    if (!(await this.findScopeChain(input))) {
      throw new ScopeTargetNotFoundError("Scope target not found.");
    }
  }

  async previewScopeRemoval(input: {
    organizationId: string;
    scope: ScopeAssignment;
  }): Promise<ResolvedRetention> {
    const chain = await this.findScopeChain(input);
    if (!chain) {
      return this.defaultRetention();
    }

    const rows = await this.options.policies.findAllInOrganization({
      organizationId: input.organizationId,
    });
    const remaining = rows.filter(
      (row) => !(row.scopeType === input.scope.scopeType && row.scopeId === input.scope.scopeId),
    );

    return resolveRetention({
      rows: remaining,
      chain,
      defaultRetentionDays: this.options.defaultRetentionDays,
    });
  }

  listOrganizationRules(input: { organizationId: string }): Promise<RetentionPolicy[]> {
    return this.options.policies.findAllInOrganization(input);
  }

  async setForScope(input: {
    organizationId: string;
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy> {
    const retentionDays = retentionDaysInputSchema.parse(input.retentionDays);
    await this.assertScopeInOrganization(input);

    const row = await this.options.policies.upsertForScope({
      organizationId: input.organizationId,
      scope: input.scope,
      category: input.category,
      retentionDays,
    });
    await this.invalidateForScope(input);

    return row;
  }

  async removeForScope(input: {
    organizationId: string;
    scope: ScopeAssignment;
    category: RetentionCategory;
  }): Promise<void> {
    await this.assertScopeInOrganization(input);
    await this.options.policies.deleteForScope({ scope: input.scope, category: input.category });
    await this.invalidateForScope(input);
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

  private async invalidateForScope(input: {
    organizationId: string;
    scope: ScopeAssignment;
  }): Promise<void> {
    const projectIds = await this.findAffectedProjectIds(input);
    await Promise.all(projectIds.map((projectId) => this.options.cache.delete(projectId)));
  }

  /** The target's chain inside `organizationId`, or null when its row puts it elsewhere. */
  private async findScopeChain({
    organizationId,
    scope,
  }: {
    organizationId: string;
    scope: ScopeAssignment;
  }): Promise<ScopeAssignment[] | null> {
    const organization: ScopeAssignment = { scopeType: "ORGANIZATION", scopeId: organizationId };
    if (scope.scopeType === "ORGANIZATION") {
      return scope.scopeId === organizationId ? [scope] : null;
    }

    if (scope.scopeType === "TEAM") {
      const teamOrganizationId = await this.options.projectScopes.findTeamOrganizationId({
        teamId: scope.scopeId,
      });

      return teamOrganizationId === organizationId ? [scope, organization] : null;
    }

    const context = await this.findProjectContext(scope.scopeId);
    if (!context || context.organizationId !== organizationId) {
      return null;
    }

    return resolveScopeChain(context);
  }

  /** The project's chain as its row places it, archived included; null when it has no row. */
  private findProjectContext(projectId: string): Promise<{
    organizationId: string;
    teamId: string;
    projectId: string;
  } | null> {
    return this.options.projectScopes.findProjectPlacement({ projectId });
  }

  private async findAffectedProjectIds({
    organizationId,
    scope,
  }: {
    organizationId: string;
    scope: ScopeAssignment;
  }): Promise<string[]> {
    if (scope.scopeType === "PROJECT") {
      return [scope.scopeId];
    }

    return this.options.projectScopes.findProjectIds({
      organizationId,
      ...(scope.scopeType === "TEAM" ? { teamId: scope.scopeId } : {}),
    });
  }
}
