import { AuthzApi } from "@langwatch/authz-contract";
import {
  DataRetentionApi,
  INDEFINITE_RETENTION_DAYS,
  platformDefaultRetentionDaysSchema,
  type DataRetentionApi as DataRetentionApiContract,
  type KillRetroactiveMutationInput,
  type PinTraceInput,
  type PinnedTrace,
  type ResolvedRetention,
  type RetentionCallerInput,
  type RetentionCategory,
  type RetentionPolicy,
  type RetentionPolicySnapshot,
  type RetentionStorageUsage,
  type RetroactiveMutationProgress,
  type RetroactiveMutationProjectInput,
  type ScopeAssignment,
  type StorageMeterTenantInput,
  type StorageMeterTenantsInput,
  type UnpinTraceInput,
} from "@langwatch/data-retention-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";
import { z } from "zod";
import { reads, type MembersRead } from "@langwatch/infrastructure/members";
import type { DataRetentionPlanResolver } from "./data-retention.members.ts";
import { ClickHouseRetroactiveRetentionRepository } from "../repositories/clickhouse/clickhouse.retroactive-retention.repository.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import {
  RedisDataRetentionCacheStore,
  type DataRetentionRedis,
} from "../stores/data-retention-cache.store.ts";
import type { StorageMeterRedis } from "../stores/storage-meter-cache.store.ts";
import {
  DataRetentionPolicyService,
  type RetentionActor,
} from "../services/data-retention-policy.service.ts";
import { DataRetentionSnapshotService } from "../services/data-retention-snapshot.service.ts";
import { DataRetentionService } from "../services/data-retention.service.ts";
import { RetentionPermissionsService } from "../services/retention-permissions.service.ts";
import { StorageMeterScopeService } from "../services/storage-meter-scope.service.ts";
import { StorageMeterService } from "../services/storage-meter.service.ts";

const DEFAULT_CACHE_TTL_MS = 60_000;

/** Resolves the ClickHouse the retention rewrites and the meter run on. */

/** A project's place in the organization chain, plus the name it renders under. */
export type RetentionProjectLineage = Readonly<{
  projectId: string;
  name: string;
  teamId: string | null;
  organizationId: string | null;
  organizationName: string | null;
}>;

/** One organization's scope targets, as the settings page lists them. */
export type RetentionOrganizationDirectory = Readonly<{
  teams: ReadonlyArray<{ id: string; name: string }>;
  /**
   * Archived projects stay in the list so an existing rule that targets one
   * still resolves a NAME; the picker drops them, which is a filter the
   * snapshot applies rather than one this read makes.
   */
  projects: ReadonlyArray<{ id: string; name: string; teamId: string; archived: boolean }>;
}>;

/**
 * The organization lineage a retention rule is placed, named and gated against.
 * Not this feature's own repository: `Organization`, `Team` and `Project`
 * belong to other features, and a repository here would claim them.
 */
export interface DataRetentionDirectoryReader {
  /** The project the settings page was opened from, or null when there is none. */
  findProjectLineage(input: { projectId: string }): Promise<RetentionProjectLineage | null>;

  listOrganizationDirectory(input: {
    organizationId: string;
  }): Promise<RetentionOrganizationDirectory>;

  /**
   * The organization that owns a scope target, or null when it does not exist.
   * The anchor every scope-targeted gate checks against — never a
   * caller-supplied project id, which can name a different organization.
   */
  findScopeOrganizationId(input: { scope: ScopeAssignment }): Promise<string | null>;

  /**
   * The live projects one scope resolves to, enumerated FROM the organization
   * so a foreign id resolves to no rows. Archived projects are excluded: the
   * storage card must not count what the reader cannot see.
   */
  listScopeProjects(input: {
    organizationId: string;
    scope: ScopeAssignment;
  }): Promise<ReadonlyArray<{ id: string; teamId: string }>>;
}

export type DataRetentionInfrastructure = Readonly<{
  /** Which organization owns a scope, what it is called, what it resolves to. */
  directory: DataRetentionDirectoryReader;
  /** What an organization's plan permits of its retention. */
  plans: DataRetentionPlanResolver;
  redis: (DataRetentionRedis & StorageMeterRedis) | null;
  cacheTtlMs?: number;
}>;

export type DataRetentionAppConfig = Readonly<{
  platformDefaultRetentionDays: number;
}>;

/**
 * Both ClickHouse paths this feature has - the retention rewrite and the
 * storage meter - run on the process's one `clickhouse` member. A deployment
 * that named no ClickHouse refuses at boot naming this module and that member,
 * rather than metering every project at zero bytes and rewriting nothing while
 * reporting success.
 */
type DataRetentionSetup = FeatureSetup<
  typeof DataRetentionApp.dependencies,
  DataRetentionInfrastructure & MembersRead<typeof DataRetentionApp.reads>,
  DataRetentionAppConfig,
  DataRetentionRepositories
>;

export class DataRetentionApp implements DataRetentionApiContract {
  static readonly contract = DataRetentionApi;
  static readonly dependencies = {
    projects: ProjectApi,
    organizations: OrganizationApi,
    permissions: AuthzApi,
    users: UserApi,
  };
  static readonly configSchema = z.object({
    platformDefaultRetentionDays: platformDefaultRetentionDaysSchema,
  });
  static readonly reads = reads("clickhouse");

  readonly #retention: DataRetentionService;
  readonly #policy: DataRetentionPolicyService;
  readonly #snapshots: DataRetentionSnapshotService;
  readonly #scopeMeter: StorageMeterScopeService;
  readonly #users: UserApi;

  private constructor(services: {
    retention: DataRetentionService;
    policy: DataRetentionPolicyService;
    snapshots: DataRetentionSnapshotService;
    scopeMeter: StorageMeterScopeService;
    users: UserApi;
  }) {
    this.#retention = services.retention;
    this.#policy = services.policy;
    this.#snapshots = services.snapshots;
    this.#scopeMeter = services.scopeMeter;
    this.#users = services.users;
  }

  static create({
    repositories,
    members,
    dependencies,
    config,
  }: DataRetentionSetup): DataRetentionApp {
    const storageMeter = StorageMeterService.create({
      clickhouse: members.clickhouse,
      redis: members.redis,
    });
    const retention = DataRetentionService.create({
      policies: repositories.policies,
      pins: repositories.pins,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      defaultRetentionDays: config.platformDefaultRetentionDays,
      retroactive: ClickHouseRetroactiveRetentionRepository.create({
        clickhouse: members.clickhouse,
      }),
      cache: RedisDataRetentionCacheStore.create({
        redis: members.redis,
        ttlMs: members.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      }),
      storageMeter,
    });
    const permissions = RetentionPermissionsService.create({ authz: dependencies.permissions });
    const policy = DataRetentionPolicyService.create({
      directory: members.directory,
      permissions,
      plans: members.plans,
      administrators: dependencies.users,
    });

    return new DataRetentionApp({
      retention,
      policy,
      snapshots: DataRetentionSnapshotService.create({
        retention,
        directory: members.directory,
        permissions,
        policy,
      }),
      scopeMeter: StorageMeterScopeService.create({
        meter: storageMeter,
        directory: members.directory,
        permissions,
      }),
      users: dependencies.users,
    });
  }

  getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention> {
    return this.#retention.getResolvedForProject(input);
  }

  getRetentionDays(input: { projectId: string; category: RetentionCategory }): Promise<number> {
    return this.#retention.getRetentionDays(input);
  }

  listOrganizationRules(input: { organizationId: string }): Promise<RetentionPolicy[]> {
    return this.#retention.listOrganizationRules(input);
  }

  setForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy> {
    return this.#retention.setForScope(input);
  }

  pin(input: PinTraceInput): Promise<PinnedTrace> {
    return this.#retention.pin(input);
  }

  unpin(input: UnpinTraceInput): Promise<void> {
    return this.#retention.unpin(input);
  }

  autoPin(input: UnpinTraceInput): Promise<PinnedTrace> {
    return this.#retention.autoPin(input);
  }

  autoUnpin(input: UnpinTraceInput): Promise<void> {
    return this.#retention.autoUnpin(input);
  }

  isPinned(input: UnpinTraceInput): Promise<boolean> {
    return this.#retention.isPinned(input);
  }

  findPin(input: UnpinTraceInput): Promise<PinnedTrace | null> {
    return this.#retention.findPin(input);
  }

  listByProject(input: { projectId: string }): Promise<PinnedTrace[]> {
    return this.#retention.listByProject(input);
  }

  getPinnedTraceIds(input: { projectId: string }): Promise<string[]> {
    return this.#retention.getPinnedTraceIds(input);
  }

  getRetroactiveMutationProgress(
    input: RetroactiveMutationProjectInput,
  ): Promise<RetroactiveMutationProgress[]> {
    return this.#retention.getRetroactiveMutationProgress(input);
  }

  getTotalStorageBytes(input: StorageMeterTenantInput): Promise<number> {
    return this.#retention.getTotalStorageBytes(input);
  }

  getTotalStorageBytesForTenants(input: StorageMeterTenantsInput): Promise<number> {
    return this.#retention.getTotalStorageBytesForTenants(input);
  }

  async getPolicySnapshot(
    input: { projectId: string } & RetentionCallerInput,
  ): Promise<RetentionPolicySnapshot> {
    return this.#snapshots.getSnapshot({
      projectId: input.projectId,
      actor: await this.#actor(input.userId),
    });
  }

  async getScopeStorageUsage(
    input: { projectId: string; scope: ScopeAssignment } & RetentionCallerInput,
  ): Promise<RetentionStorageUsage> {
    return this.#scopeMeter.getScopeUsage({
      projectId: input.projectId,
      scope: input.scope,
      actor: await this.#actor(input.userId),
    });
  }

  /**
   * Gated by the same write-on-scope check as the removal it previews, so the
   * resolved organization default never leaks to a caller who could not remove
   * the rule.
   */
  async previewScopeRemoval(
    input: { scope: ScopeAssignment } & RetentionCallerInput,
  ): Promise<ResolvedRetention> {
    const actor = await this.#actor(input.userId);
    await this.#policy.assertCanWriteScope({ actor, scope: input.scope });

    return this.#retention.previewScopeRemoval({ scope: input.scope });
  }

  async changeScopeRetention(
    input: {
      scope: ScopeAssignment;
      category: RetentionCategory;
      retentionDays: number;
    } & RetentionCallerInput,
  ): Promise<RetentionPolicy> {
    const actor = await this.#actor(input.userId);
    await this.#policy.assertCanWriteScope({ actor, scope: input.scope });
    // The scope's owning organization and its plan, resolved ONCE: paid plans
    // may persist only their fixed presets, enterprise and self-hosted the full
    // range above the custom floor. The indefinite sentinel is a no-op here so
    // the platform-operator check below still runs.
    await this.#policy.assertWriteAllowed({
      actor,
      scope: input.scope,
      retentionDays: input.retentionDays,
    });
    if (input.retentionDays === INDEFINITE_RETENTION_DAYS) {
      this.#policy.assertCanDisableRetention({ actor });
    }

    // `ScopeTargetNotFoundError` is a handled 404: the runtime maps its status
    // to the door's code, so there is nothing to translate here.
    return this.#retention.setForScope({
      scope: input.scope,
      category: input.category,
      retentionDays: input.retentionDays,
    });
  }

  async removeForScope(
    input: { scope: ScopeAssignment; category: RetentionCategory } & RetentionCallerInput,
  ): Promise<void> {
    const actor = await this.#actor(input.userId);
    await this.#policy.assertCanWriteScope({ actor, scope: input.scope });
    await this.#policy.assertPlanForScope({ actor, scope: input.scope });
    await this.#retention.removeForScope({ scope: input.scope, category: input.category });
  }

  /**
   * The retention is resolved through the cascade, never taken from the caller:
   * a client value would let `project:update` contract data to any number. The
   * answer names what was applied — an organization save loses to a closer one.
   */
  async applyRetentionToExistingData(
    input: { projectId: string; category: RetentionCategory } & RetentionCallerInput,
  ): Promise<{ tables: string[]; appliedRetentionDays: number }> {
    const actor = await this.#actor(input.userId);
    await this.#policy.assertPlanForProject({ actor, projectId: input.projectId });
    const effective = await this.#retention.getResolvedForProject({ projectId: input.projectId });
    const appliedRetentionDays = effective[input.category];
    const result = await this.#retention.triggerRetroactiveUpdate({
      projectId: input.projectId,
      category: input.category,
      newRetentionDays: appliedRetentionDays,
    });

    return { ...result, appliedRetentionDays };
  }

  async killRetroactiveMutation(
    input: KillRetroactiveMutationInput & RetentionCallerInput,
  ): Promise<void> {
    const actor = await this.#actor(input.userId);
    await this.#policy.assertPlanForProject({ actor, projectId: input.projectId });
    await this.#retention.killRetroactiveMutation({
      projectId: input.projectId,
      mutationId: input.mutationId,
    });
  }

  /**
   * The address the platform-operator allow-list is written in, resolved from
   * the caller's id rather than read off the request.
   */
  async #actor(userId: string): Promise<RetentionActor> {
    const user = await this.#users.tryFindById({ id: userId });

    return { userId, email: user?.email ?? null };
  }
}
