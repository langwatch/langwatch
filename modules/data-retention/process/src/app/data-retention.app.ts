import { AuthzApi } from "@langwatch/authz-contract";
import {
  dataRetentionConfig,
  DataRetentionApi,
  INDEFINITE_RETENTION_DAYS,
  resolvePlatformDefaultRetentionDays,
  type DataRetentionApi as DataRetentionApiContract,
  type DataRetentionServerConfig,
  type IdIndexRetentionRaiseInput,
  type KillRetroactiveMutationInput,
  type OrganizationRetention,
  type OrganizationStorageEstimate,
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
import { BillingApi } from "@langwatch/enterprise-billing-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";
import type { Instant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import {
  buildDataRetentionSeatPolicyPipeline,
  type DataRetentionSeatPolicyPipeline,
} from "../eventing/data-retention-seat-policy.pipeline.ts";
import { ApplyRetentionExtensionCommand } from "../eventing/retention-extension.commands.ts";
import {
  buildRetentionExtensionPipeline,
  type RetentionExtensionPipelineDefinition,
} from "../eventing/retention-extension.pipeline.ts";
import { ReportRetentionStorageCommand } from "../eventing/retention-storage-report.commands.ts";
import {
  buildRetentionStorageReportPipeline,
  type RetentionStorageReportPipelineDefinition,
} from "../eventing/retention-storage-report.pipeline.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import {
  DataRetentionPolicyService,
  type RetentionActor,
} from "../services/data-retention-policy.service.ts";
import { DataRetentionSnapshotService } from "../services/data-retention-snapshot.service.ts";
import { DataRetentionService } from "../services/data-retention.service.ts";
import { OrganizationStorageEstimateService } from "../services/organization-storage-estimate.service.ts";
import { RetentionExtensionService } from "../services/retention-extension.service.ts";
import { RetentionPermissionsService } from "../services/retention-permissions.service.ts";
import { RetentionPlanService } from "../services/retention-plan.service.ts";
import {
  RetentionStorageReportRequestService,
  type RetentionStorageRequestOutcome,
} from "../services/retention-storage-report-request.service.ts";
import { RetentionStorageReportService } from "../services/retention-storage-report.service.ts";
import { SeatRetentionPolicyService } from "../services/seat-retention-policy.service.ts";
import { StorageMeterScopeService } from "../services/storage-meter-scope.service.ts";
import { StorageMeterService } from "../services/storage-meter.service.ts";

const logger = createLogger("langwatch:data-retention:retention-storage");

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
  teams: readonly { id: string; name: string }[];
  /**
   * Archived projects stay in the list so an existing rule that targets one
   * still resolves a NAME; the picker drops them, which is a filter the
   * snapshot applies rather than one this read makes.
   */
  projects: readonly { id: string; name: string; teamId: string; archived: boolean }[];
}>;

/**
 * The organization lineage a retention rule is placed, named and gated against.
 * Not this feature's own repository: `Organization`, `Team` and `Project`
 * belong to other features, and a repository here would claim them.
 */
export interface DataRetentionDirectoryReader {
  /** The project the settings page was opened from, or null when there is none. */
  findProjectLineage(input: { projectId: string }): Promise<RetentionProjectLineage | null>;

  findOrganizationDirectory(input: {
    organizationId: string;
  }): Promise<RetentionOrganizationDirectory>;

  /**
   * The live projects one scope resolves to, enumerated FROM the organization
   * so a foreign id resolves to no rows. Archived projects are excluded: the
   * storage card must not count what the reader cannot see.
   */
  findScopeProjects(input: {
    organizationId: string;
    scope: ScopeAssignment;
  }): Promise<readonly { id: string; teamId: string }[]>;

  /** When the organization was created; an empty answer when there is no such organization. */
  findOrganizationCreatedAt(input: { organizationId: string }): Promise<readonly Instant[]>;
}

type DataRetentionSetup = FeatureSetup<
  typeof DataRetentionModule.dependencies,
  DataRetentionServerConfig,
  DataRetentionRepositories
>;

export class DataRetentionModule implements DataRetentionApiContract {
  static readonly contract = DataRetentionApi;
  static readonly dependencies = {
    permissions: AuthzApi,
    users: UserApi,
    entitlement: EntitlementApi,
    billing: BillingApi,
  };
  static readonly config = dataRetentionConfig;

  readonly #retention: DataRetentionService;
  readonly #policy: DataRetentionPolicyService;
  readonly #snapshots: DataRetentionSnapshotService;
  readonly #scopeMeter: StorageMeterScopeService;
  readonly #extensions: RetentionExtensionService;
  readonly #storageEstimates: OrganizationStorageEstimateService;
  readonly #storageReport: RetentionStorageReportService;
  readonly #storageRequests: RetentionStorageReportRequestService;
  readonly #users: UserApi;

  private constructor(services: {
    retention: DataRetentionService;
    policy: DataRetentionPolicyService;
    snapshots: DataRetentionSnapshotService;
    scopeMeter: StorageMeterScopeService;
    extensions: RetentionExtensionService;
    storageEstimates: OrganizationStorageEstimateService;
    storageReport: RetentionStorageReportService;
    storageRequests: RetentionStorageReportRequestService;
    users: UserApi;
  }) {
    this.#retention = services.retention;
    this.#policy = services.policy;
    this.#snapshots = services.snapshots;
    this.#scopeMeter = services.scopeMeter;
    this.#extensions = services.extensions;
    this.#storageEstimates = services.storageEstimates;
    this.#storageReport = services.storageReport;
    this.#storageRequests = services.storageRequests;
    this.#users = services.users;
  }

  static create({ repositories, dependencies, config }: DataRetentionSetup): DataRetentionModule {
    const storageMeter = StorageMeterService.create({
      meter: repositories.storageMeter,
      cache: repositories.storageMeterCache,
    });
    const retention = DataRetentionService.create({
      policies: repositories.policies,
      pins: repositories.pins,
      projectScopes: repositories.projectScopes,
      defaultRetentionDays: resolvePlatformDefaultRetentionDays({
        LANGWATCH_DEFAULT_RETENTION_DAYS: config.platformDefaultDays,
        NODE_ENV: config.nodeEnvironment,
      }),
      retroactive: repositories.retroactive,
      cache: repositories.cache,
      storageMeter,
    });
    const permissions = RetentionPermissionsService.create({ authz: dependencies.permissions });
    const policy = DataRetentionPolicyService.create({
      directory: repositories.directory,
      permissions,
      plans: RetentionPlanService.create({
        entitlement: dependencies.entitlement,
        isSaas: config.isSaas,
      }),
    });

    const storageReport = RetentionStorageReportService.create({
      policies: repositories.policies,
      directory: repositories.directory,
      meter: repositories.storageMeter,
      billing: dependencies.billing,
    });

    return new DataRetentionModule({
      retention,
      policy,
      snapshots: DataRetentionSnapshotService.create({
        retention,
        directory: repositories.directory,
        permissions,
        policy,
      }),
      scopeMeter: StorageMeterScopeService.create({
        meter: storageMeter,
        directory: repositories.directory,
        permissions,
      }),
      extensions: RetentionExtensionService.create({
        seatPolicies: SeatRetentionPolicyService.create({ rules: retention }),
        projects: retention,
      }),
      storageEstimates: OrganizationStorageEstimateService.create({
        meter: storageMeter,
        directory: repositories.directory,
        retention,
      }),
      storageReport,
      storageRequests: RetentionStorageReportRequestService.create({
        organizations: storageReport,
      }),
      users: dependencies.users,
    });
  }

  /** The pipeline `data_retention_seat_policy` registers, over billing's activation fact. */
  seatPolicyPipeline(): DataRetentionSeatPolicyPipeline {
    return buildDataRetentionSeatPolicyPipeline({ extensions: this.#extensions });
  }

  /** The `data_retention_extension` pipeline: the activation's extension, raised per project. */
  retentionExtensionPipeline(
    deps: { applyRetryDelayMs?: (params: { attempt: number }) => number } = {},
  ): RetentionExtensionPipelineDefinition {
    return buildRetentionExtensionPipeline({
      applyCommand: ApplyRetentionExtensionCommand.create({ retention: this.#retention }),
      extensions: this.#extensions,
      ...deps,
    });
  }

  connectRetentionExtensionCommands(
    commands: EventingCommands<RetentionExtensionPipelineDefinition>,
  ): void {
    this.#extensions.connect({
      record: (data) => commands.recordRetentionExtension.send(data),
      apply: (data) => commands.applyRetentionExtension.send(data),
    });
  }

  /** The `data_retention_storage_report` pipeline: daily clock, measure command and bill. */
  storageReportPipeline(deps: {
    deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  }): RetentionStorageReportPipelineDefinition {
    return buildRetentionStorageReportPipeline({
      reportCommand: ReportRetentionStorageCommand.create({ measurer: this.#storageReport }),
      sweep: {
        request: ({ at }) => this.#storageRequests.requestAll({ at }),
        deleteDispatchedBefore: deps.deleteDispatchedBefore,
      },
      bill: (measured) => this.#storageReport.bill(measured),
    });
  }

  connectStorageReportCommands(
    commands: EventingCommands<RetentionStorageReportPipelineDefinition>,
  ): void {
    this.#storageRequests.connect((data) => commands.reportRetentionStorage.send(data));
  }

  /** Sends today's measure command for one organization, or for every one with rules. */
  requestRetentionStorageReport(input: {
    organizationId?: string;
  }): Promise<RetentionStorageRequestOutcome> {
    return input.organizationId
      ? this.#storageRequests.requestOrganization({ organizationId: input.organizationId })
      : this.#storageRequests.requestAll();
  }

  getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention> {
    return this.#retention.getResolvedForProject(input);
  }

  getPlatformDefaultRetentionDays(): number {
    return this.#retention.getPlatformDefaultRetentionDays();
  }

  getRetentionDays(input: { projectId: string; category: RetentionCategory }): Promise<number> {
    return this.#retention.getRetentionDays(input);
  }

  listOrganizationRules(input: { organizationId: string }): Promise<RetentionPolicy[]> {
    return this.#retention.listOrganizationRules(input);
  }

  setForScope(input: {
    organizationId: string;
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

  raiseIdIndexRetention(input: IdIndexRetentionRaiseInput): Promise<{ tables: string[] }> {
    return this.#retention.raiseIdIndexRetention(input);
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

  getOrganizationStorageEstimate(input: {
    organizationId: string;
  }): Promise<OrganizationStorageEstimate> {
    return this.#storageEstimates.getEstimate(input);
  }

  getOrganizationRetention(input: { organizationId: string }): Promise<OrganizationRetention> {
    return this.#storageEstimates.getRetention(input);
  }

  /**
   * The door has asked the target's permission; this refuses a target outside the named
   * organization, so the preview never leaks another organization's resolved default.
   */
  async previewScopeRemoval(
    input: { organizationId?: string; scope: ScopeAssignment } & RetentionCallerInput,
  ): Promise<ResolvedRetention> {
    const target = await this.#scopeTarget(input);
    await this.#retention.assertScopeInOrganization(target);

    return this.#retention.previewScopeRemoval(target);
  }

  async changeScopeRetention(
    input: {
      organizationId?: string;
      scope: ScopeAssignment;
      category: RetentionCategory;
      retentionDays: number;
    } & RetentionCallerInput,
  ): Promise<RetentionPolicy> {
    const actor = await this.#actor(input.userId);
    const { organizationId, scope } = await this.#scopeTarget(input);
    await this.#retention.assertScopeInOrganization({ organizationId, scope });
    // Paid plans may persist only their fixed presets, enterprise and self-hosted the full
    // range above the custom floor. The indefinite sentinel is a no-op here so the
    // platform-operator check below still runs.
    await this.#policy.assertWriteAllowed({
      actor,
      organizationId,
      retentionDays: input.retentionDays,
    });
    if (input.retentionDays === INDEFINITE_RETENTION_DAYS) {
      await this.#policy.assertCanDisableRetention({ actor });
    }

    const saved = await this.#retention.setForScope({
      organizationId,
      scope,
      category: input.category,
      retentionDays: input.retentionDays,
    });
    await this.#syncStorageLine(organizationId);
    return saved;
  }

  async removeForScope(
    input: {
      organizationId?: string;
      scope: ScopeAssignment;
      category: RetentionCategory;
    } & RetentionCallerInput,
  ): Promise<void> {
    const actor = await this.#actor(input.userId);
    const { organizationId, scope } = await this.#scopeTarget(input);
    await this.#retention.assertScopeInOrganization({ organizationId, scope });
    await this.#policy.assertPlanForScope({ actor, organizationId });
    await this.#retention.removeForScope({
      organizationId,
      scope,
      category: input.category,
    });
    await this.#syncStorageLine(organizationId);
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
   * Adds or removes the storage line after a rule change. The rule is already saved, so a billing
   * failure is logged rather than undoing it; the daily report aligns the line again.
   */
  async #syncStorageLine(organizationId: string): Promise<void> {
    try {
      await this.#storageReport.syncLine({ organizationId });
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : String(error) },
        "Retention storage line could not follow the rule change",
      );
    }
  }

  /**
   * The caller's profile, resolved from the id rather than read off the
   * request.
   */
  async #actor(userId: string): Promise<RetentionActor> {
    const user = await this.#users.findById({ id: userId });

    return { userId, email: user?.email ?? null };
  }

  /** The named organisation, or the one the approved target sits in; never the page's project. */
  async #scopeTarget(input: {
    organizationId?: string;
    scope: ScopeAssignment;
  }): Promise<{ organizationId: string; scope: ScopeAssignment }> {
    const organizationId =
      input.organizationId ??
      (await this.#retention.getScopeOrganizationId({ scope: input.scope }));

    return { organizationId, scope: input.scope };
  }
}
