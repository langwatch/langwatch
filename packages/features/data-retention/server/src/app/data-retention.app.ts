import {
  DataRetentionApi,
  platformDefaultRetentionDaysSchema,
  type DataRetentionApi as DataRetentionApiContract,
  type KillRetroactiveMutationInput,
  type PinTraceInput,
  type RetroactiveMutationProjectInput,
  type RetroactiveRetentionUpdateInput,
  type RetentionCategory,
  type ScopeAssignment,
  type UnpinTraceInput,
} from "@langwatch/data-retention-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { z } from "zod";
import { PrismaDataRetentionAdapter } from "../adapters/prisma.data-retention.adapter.ts";
import type { TenantClickHouseClientResolver } from "../adapters/clickhouse.retroactive-retention.adapter.ts";
import type { DataRetentionDatabasePort } from "../ports/data-retention-database.port.ts";
import type { DataRetentionRedis } from "../stores/data-retention-cache.store.ts";
import type { StorageMeterRedis } from "../stores/storage-meter-cache.store.ts";

export type DataRetentionInfrastructure = Readonly<{
  database: DataRetentionDatabasePort;
  redis: (DataRetentionRedis & StorageMeterRedis) | null;
  resolveClickHouseClient: TenantClickHouseClientResolver | null;
  cacheTtlMs?: number;
}>;

export type DataRetentionAppConfig = Readonly<{
  platformDefaultRetentionDays: number;
}>;

type DataRetentionDependencies = Readonly<{
  projects: typeof ProjectApi;
  organizations: typeof OrganizationApi;
}>;

type DataRetentionSetup = FeatureSetup<
  DataRetentionDependencies,
  DataRetentionInfrastructure,
  DataRetentionAppConfig
>;

export class DataRetentionApp implements DataRetentionApiContract {
  static readonly contract = DataRetentionApi;
  static readonly dependencies: DataRetentionDependencies = {
    projects: ProjectApi,
    organizations: OrganizationApi,
  };
  static readonly configSchema = z.object({
    platformDefaultRetentionDays: platformDefaultRetentionDaysSchema,
  });

  #retention: DataRetentionApiContract;

  private constructor(retention: DataRetentionApiContract) {
    this.#retention = retention;
  }

  static create({ infrastructure, dependencies, config }: DataRetentionSetup): DataRetentionApp {
    const retention = PrismaDataRetentionAdapter.create({
      database: infrastructure.database,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      defaultRetentionDays: config.platformDefaultRetentionDays,
      redis: infrastructure.redis,
      cacheTtlMs: infrastructure.cacheTtlMs,
      resolveClickHouseClient: infrastructure.resolveClickHouseClient,
    });
    return new DataRetentionApp(retention);
  }

  getResolvedForProject(input: { projectId: string }) {
    return this.#retention.getResolvedForProject(input);
  }

  getRetentionDays(input: { projectId: string; category: RetentionCategory }) {
    return this.#retention.getRetentionDays(input);
  }

  previewScopeRemoval(input: { scope: ScopeAssignment }) {
    return this.#retention.previewScopeRemoval(input);
  }

  listOrganizationRules(input: { organizationId: string }) {
    return this.#retention.listOrganizationRules(input);
  }

  tryGetPolicyById(input: { id: string }) {
    return this.#retention.tryGetPolicyById(input);
  }

  setForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }) {
    return this.#retention.setForScope(input);
  }

  removeForScope(input: { scope: ScopeAssignment; category: RetentionCategory }) {
    return this.#retention.removeForScope(input);
  }

  pin(input: PinTraceInput) {
    return this.#retention.pin(input);
  }

  unpin(input: UnpinTraceInput) {
    return this.#retention.unpin(input);
  }

  autoPin(input: UnpinTraceInput) {
    return this.#retention.autoPin(input);
  }

  autoUnpin(input: UnpinTraceInput) {
    return this.#retention.autoUnpin(input);
  }

  isPinned(input: UnpinTraceInput) {
    return this.#retention.isPinned(input);
  }

  tryGetPin(input: UnpinTraceInput) {
    return this.#retention.tryGetPin(input);
  }

  listByProject(input: { projectId: string }) {
    return this.#retention.listByProject(input);
  }

  getPinnedTraceIds(input: { projectId: string }) {
    return this.#retention.getPinnedTraceIds(input);
  }

  triggerRetroactiveUpdate(input: RetroactiveRetentionUpdateInput) {
    return this.#retention.triggerRetroactiveUpdate(input);
  }

  getRetroactiveMutationProgress(input: RetroactiveMutationProjectInput) {
    return this.#retention.getRetroactiveMutationProgress(input);
  }

  killRetroactiveMutation(input: KillRetroactiveMutationInput) {
    return this.#retention.killRetroactiveMutation(input);
  }

  getTotalStorageBytes(input: { tenantId: string }) {
    return this.#retention.getTotalStorageBytes(input);
  }

  getTotalStorageBytesForTenants(input: { tenantIds: string[] }) {
    return this.#retention.getTotalStorageBytesForTenants(input);
  }
}
