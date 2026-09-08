import type { ClickHouseClient, QueryParams } from "@clickhouse/client";
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
  ScopeTargetNotFoundError,
  type ScopeAssignment,
  type StorageMeterTenantInput,
  type StorageMeterTenantsInput,
  type UnpinTraceInput,
} from "@langwatch/data-retention-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DataRetentionDirectoryPort } from "../ports/data-retention-directory.port.ts";
import type { DataRetentionPlanPort } from "../ports/data-retention-plan.port.ts";
import type { StorageMeterClickHouseClient } from "../ports/storage-meter-clickhouse.port.ts";
import {
  ClickHouseRetroactiveRetentionRepository,
  type RetentionClickHouseClient,
} from "../repositories/clickhouse/clickhouse.retroactive-retention.repository.ts";
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
export type TenantClickHouseClientResolver = (tenantId: string) => Promise<ClickHouseClient>;

export type DataRetentionInfrastructure = Readonly<{
  /** Which organization owns a scope, what it is called, what it resolves to. */
  directory: DataRetentionDirectoryPort;
  /** What an organization's plan permits of its retention. */
  plans: DataRetentionPlanPort;
  redis: (DataRetentionRedis & StorageMeterRedis) | null;
  resolveClickHouseClient: TenantClickHouseClientResolver | null;
  cacheTtlMs?: number;
}>;

export type DataRetentionAppConfig = Readonly<{
  platformDefaultRetentionDays: number;
}>;

type DataRetentionSetup = FeatureSetup<
  typeof DataRetentionApp.dependencies,
  DataRetentionInfrastructure,
  DataRetentionAppConfig,
  DataRetentionRepositories
>;

/** The rewrite path, over the process's own ClickHouse. */
function retentionClient(client: ClickHouseClient): RetentionClickHouseClient {
  return {
    async command(input): Promise<void> {
      await client.command(input);
    },
    async query(input): Promise<{ json(): Promise<unknown> }> {
      const result = await client.query(input);
      return { json: () => result.json<unknown>() };
    },
  };
}

/** The metering path, which only ever reads. */
function meterClient(client: ClickHouseClient): StorageMeterClickHouseClient {
  return {
    query: async (input: QueryParams) => {
      const result = await client.query(input);
      return { json: () => result.json<unknown>() };
    },
  };
}

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
    infrastructure,
    dependencies,
    config,
  }: DataRetentionSetup): DataRetentionApp {
    const resolveClient = infrastructure.resolveClickHouseClient;
    const storageMeter = StorageMeterService.create({
      resolveClickHouseClient: resolveClient
        ? async (tenantId) => meterClient(await resolveClient(tenantId))
        : null,
      redis: infrastructure.redis,
    });
    const retention = DataRetentionService.create({
      policies: repositories.policies,
      pins: repositories.pins,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      defaultRetentionDays: config.platformDefaultRetentionDays,
      retroactive: resolveClient
        ? ClickHouseRetroactiveRetentionRepository.create({
            resolveClient: async (projectId) => retentionClient(await resolveClient(projectId)),
          })
        : null,
      cache: RedisDataRetentionCacheStore.create({
        redis: infrastructure.redis,
        ttlMs: infrastructure.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      }),
      storageMeter,
    });
    const permissions = RetentionPermissionsService.create({ authz: dependencies.permissions });
    const policy = DataRetentionPolicyService.create({
      directory: infrastructure.directory,
      permissions,
      plans: infrastructure.plans,
      administrators: dependencies.users,
    });

    return new DataRetentionApp({
      retention,
      policy,
      snapshots: DataRetentionSnapshotService.create({
        retention,
        directory: infrastructure.directory,
        permissions,
        policy,
      }),
      scopeMeter: StorageMeterScopeService.create({
        meter: storageMeter,
        directory: infrastructure.directory,
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

  tryGetPin(input: UnpinTraceInput): Promise<PinnedTrace | null> {
    return this.#retention.tryGetPin(input);
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

    try {
      return await this.#retention.setForScope({
        scope: input.scope,
        category: input.category,
        retentionDays: input.retentionDays,
      });
    } catch (error) {
      if (error instanceof ScopeTargetNotFoundError) {
        throw new TRPCError({ code: "NOT_FOUND", message: error.message });
      }

      throw error;
    }
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
