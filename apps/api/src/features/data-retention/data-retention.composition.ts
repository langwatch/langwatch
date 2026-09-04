/**
 * How long a project's scopes keep what they captured, composed as its own
 * feature.
 *
 * `dataRetention.*` — the window a scope is swept on, what its plan may set
 * that to, and how many bytes the current scope holds. It used to be composed
 * inside the product-infrastructure half beside the object store and the
 * monitors; the three shared a ClickHouse resolver and nothing else.
 *
 * ## The policy is composed, not re-implemented
 *
 * `@langwatch/data-retention-server` owns the rules — which permission each
 * tier demands, which values a plan may persist, the enterprise floor and the
 * paid presets. What this composition supplies is the four things those rules
 * run over and the feature may not reach: the organization directory, the
 * permission answers from the SAME AuthZ service every declared check asks,
 * the plan reading, and the platform-administrator allow-list.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import {
  PrismaDataRetentionAdapter,
  DataRetentionAdministratorPort,
  DataRetentionPermissionsPort,
  DataRetentionPlanPort,
  DataRetentionPolicyService,
  DataRetentionSnapshotService,
  PrismaDataRetentionDirectoryRepository,
  StorageMeterScopeService,
  type DataRetentionDirectoryPort,
  type DataRetentionPlan,
  type DataRetentionTrpcPolicy,
  type RetentionActor,
  type RetentionPolicySnapshot,
  type StorageScopeUsage,
} from "@langwatch/data-retention-server";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { isEnterpriseTier } from "@langwatch/enterprise-plan-gate";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type {
  ApiTrpcFeatureApplication,
  ApiTrpcPortsContext,
} from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createDataRetentionTrpcRouter } from "./data-retention-trpc.mount";

/** Reports the one capability this feature can be composed without. */
export abstract class ApiDataRetentionAbsenceReport {
  abstract absent(capability: "plans"): void;
}

/** Writes the absence to the process log, once, at composition time. */
export class LoggedApiDataRetentionAbsence extends ApiDataRetentionAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiDataRetentionAbsence {
    return new LoggedApiDataRetentionAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "plans"): void {
    this.logger.warn(
      { capability },
      "API process composed no plan provider: every retention write refuses by name, because a plan gate that cannot read a plan must not pass.",
    );
  }
}

/**
 * The operator allow-list the retention gates read, named as the one peer this
 * feature has.
 *
 * The SAME slice `ctx.app.ops` carries, so "who may switch retention off" and
 * "who sees the operator sidebar" can never be two answers.
 */
export type DataRetentionPeers = Readonly<{
  ops: ApiTrpcFeatureApplication["ops"];
  /** Resolves a project's organization and team, for a scoped rule. */
  projects: Parameters<typeof PrismaDataRetentionAdapter.create>[0]["projects"];
  /** Resolves a team's organization, for an organization-scoped rule. */
  organizations: Parameters<typeof PrismaDataRetentionAdapter.create>[0]["organizations"];
}>;

/** Everything the retention policy is composed from besides its peer. */
export type DataRetentionFeatureCollaborators = Readonly<{
  prisma: ApiTrpcInfrastructure["prisma"];
  authz: AuthzService;
  /** Which plan an organization is on, where the deployment composed a provider. */
  plans?: Pick<PlanProvider, "getActivePlan">;
  /** The retention service the settings page reads and writes through. */
  dataRetention: DataRetentionService;
  ops: ApiTrpcFeatureApplication["ops"];
  report?: ApiDataRetentionAbsenceReport;
}>;

/** The namespace, the composed policy, and the service every reader shares. */
export type ComposedDataRetentionFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createDataRetentionTrpcRouter>;
  /**
   * For `ctx.app.dataRetention`, and for every other surface a retention window
   * bounds: the trace read stack's own floor, a share link's expiry and the
   * storage meter all read THIS service. A second adapter would be a second
   * answer to how long a project keeps what it captured.
   */
  service: DataRetentionService;
}>;

/** Composes the retention surface over this process's own graph. */
export function composeDataRetentionFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: DataRetentionPeers;
  /** The floor a project with no policy of its own is bounded by. */
  defaultRetentionDays: number;
  /** The meter's counters; `null` runs them uncached. */
  redis: Parameters<typeof PrismaDataRetentionAdapter.create>[0]["redis"];
  /** The application's own ClickHouse, or `null` where the process composed none. */
  resolveClickHouseClient: Parameters<
    typeof PrismaDataRetentionAdapter.create
  >[0]["resolveClickHouseClient"];
  /**
   * A finished retention service, where the host supplies one.
   *
   * It WINS over the adapter below, which is how a test names the service it
   * wants without standing up a database — the same seam the trace read stack
   * offers.
   */
  dataRetention?: DataRetentionService;
  report?: ApiDataRetentionAbsenceReport;
}): ComposedDataRetentionFeature {
  const service = options.dataRetention ?? PrismaDataRetentionAdapter.create({
    database: options.infrastructure.prisma,
    projects: options.peers.projects,
    organizations: options.peers.organizations,
    defaultRetentionDays: options.defaultRetentionDays,
    redis: options.redis,
    resolveClickHouseClient: options.resolveClickHouseClient,
  });
  const collaborators: DataRetentionFeatureCollaborators = {
    prisma: options.infrastructure.prisma,
    authz: options.infrastructure.authz,
    plans: options.infrastructure.plans,
    dataRetention: service,
    ops: options.peers.ops,
    ...(options.report ? { report: options.report } : {}),
  };
  const ports = composeRetentionPolicy(collaborators);

  return { service, router: (mount) => createDataRetentionTrpcRouter({ ...mount, ports }) };
}

/**
 * The retention surface on a process that composed no retention service.
 *
 * The namespace still mounts and every read and write refuses by name, so the
 * settings page says the deployment cannot answer rather than rendering a
 * window nobody sweeps on.
 */
export function refusingDataRetentionFeature(): ComposedDataRetentionFeature {
  const ports = new Proxy(
    {},
    {
      get:
        () =>
        (): never => {
          throw new ApiDataRetentionUnavailableError("The retention policy");
        },
      has: () => true,
    },
  ) as DataRetentionTrpcPolicy<RetentionPolicySnapshot, StorageScopeUsage>;

  return {
    router: (mount) => createDataRetentionTrpcRouter({ ...mount, ports }),
    service: new Proxy(
      {},
      {
        get:
          () =>
          (): never => {
            throw new ApiDataRetentionUnavailableError("The retention window");
          },
        has: () => true,
      },
    ) as DataRetentionService,
  };
}

/** A capability this deployment did not compose, refused by name. */
class ApiDataRetentionUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiDataRetentionUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Data retention
// ---------------------------------------------------------------------------

/**
 * The retention policy this process supplies to the packaged transport.
 *
 * Each method takes the request context because the caller is resolved per
 * request; everything else is composed once. The refusals are the feature's —
 * this only translates a context into the actor the services take.
 */
function composeRetentionPolicy(
  options: DataRetentionFeatureCollaborators,
): DataRetentionTrpcPolicy<RetentionPolicySnapshot, StorageScopeUsage> {
  if (!options.plans) options.report?.absent("plans");

  const directory: DataRetentionDirectoryPort = PrismaDataRetentionDirectoryRepository.create(
    options.prisma,
  );
  const permissions = ApiDataRetentionPermissions.create(options.authz);
  const policy = DataRetentionPolicyService.create({
    directory,
    permissions,
    plans: ApiDataRetentionPlans.create(options.plans),
    administrators: ApiDataRetentionAdministrators.create(options.ops),
  });
  const snapshots = DataRetentionSnapshotService.create({
    retention: options.dataRetention,
    directory,
    permissions,
    policy,
  });
  const meter = StorageMeterScopeService.create({
    retention: options.dataRetention,
    directory,
    permissions,
  });

  return {
    assertCanWriteScope: (ctx, scope) => policy.assertCanWriteScope({ actor: actorOf(ctx), scope }),
    assertWriteAllowed: (ctx, scope, retentionDays) =>
      policy.assertWriteAllowed({ actor: actorOf(ctx), scope, retentionDays }),
    assertCanDisableRetention: (ctx) => policy.assertCanDisableRetention({ actor: actorOf(ctx) }),
    assertPlanForScope: (ctx, scope) => policy.assertPlanForScope({ actor: actorOf(ctx), scope }),
    assertPlanForProject: (ctx, projectId) =>
      policy.assertPlanForProject({ actor: actorOf(ctx), projectId }),
    getPolicySnapshot: (ctx, { projectId }) =>
      snapshots.getSnapshot({ projectId, actor: actorOf(ctx) }),
    getScopeStorageUsage: (ctx, { projectId, scope }) =>
      meter.getScopeUsage({ projectId, scope, actor: actorOf(ctx) }),
  };
}

/** The signed-in caller, as the retention services name them. */
function actorOf(ctx: unknown): RetentionActor {
  const session = (ctx as ApiTrpcPortsContext).session;
  return {
    userId: session?.user?.id ?? null,
    email: session?.user?.email ?? null,
  };
}

/**
 * The retention tiers' permission answers, over the SAME AuthZ service the
 * declared check on the same procedure asks.
 *
 * The batched reads go through `canBatchByIds`, which is the one call the
 * application's own `batchScopePermissions` made: an organization's project
 * list is every project it holds, and one probe per row would be one round
 * trip per row.
 */
class ApiDataRetentionPermissions extends DataRetentionPermissionsPort {
  static create(authz: AuthzService): ApiDataRetentionPermissions {
    return new ApiDataRetentionPermissions(authz);
  }

  private constructor(private readonly authz: AuthzService) {
    super();
  }

  canManageOrganization(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.authz.hasPermission({
      userId: input.userId,
      permission: "organization:manage",
      organizationId: input.organizationId,
    });
  }

  async canManageTeams(input: {
    userId: string;
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    if (input.teamIds.length === 0) return new Map();
    const decided = await this.authz.canBatchByIds({
      principal: { type: "user", id: input.userId },
      permission: "team:manage",
      organizationId: input.organizationId,
      teams: input.teamIds.map((teamId) => ({ teamId })),
      projects: [],
    });
    return decided.teams;
  }

  canUpdateProjects(input: {
    userId: string;
    organizationId: string | null;
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    return this.decideProjects({ ...input, permission: "project:update" });
  }

  canViewTraces(input: {
    userId: string;
    organizationId: string;
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    return this.decideProjects({ ...input, permission: "traces:view" });
  }

  private async decideProjects(input: {
    userId: string;
    organizationId: string | null;
    projectIds: readonly string[];
    permission: "project:update" | "traces:view";
  }): Promise<ReadonlyMap<string, boolean>> {
    if (input.projectIds.length === 0) return new Map();
    // A personal-account project has no organization, and the batched read is
    // organization-shaped. One probe per id is exact there, and the list is
    // never longer than one.
    if (!input.organizationId) {
      const decided = await Promise.all(
        input.projectIds.map(
          async (projectId) =>
            [
              projectId,
              await this.authz.hasPermission({
                userId: input.userId,
                permission: input.permission,
                projectId,
              }),
            ] as const,
        ),
      );
      return new Map(decided);
    }
    const decided = await this.authz.canBatchByIds({
      principal: { type: "user", id: input.userId },
      permission: input.permission,
      organizationId: input.organizationId,
      teams: [],
      projects: input.projectIds.map((projectId) => ({ projectId })),
    });
    return decided.projects;
  }
}

/**
 * The plan behind a retention gate, reduced to the two facts retention tiers
 * on.
 *
 * `uncapped` is where this deployment's billing and licensing plumbing stops:
 * an enterprise tier, or a self-hosted install, may take any whole-week value
 * above the feature's own floor. Everything else — which values that means —
 * is the retention feature's and stays there. An unrecognised tier resolves to
 * `false`, which fails CLOSED to the restrictive menu.
 */
class ApiDataRetentionPlans extends DataRetentionPlanPort {
  static create(plans: Pick<PlanProvider, "getActivePlan"> | undefined): ApiDataRetentionPlans {
    return new ApiDataRetentionPlans(plans);
  }

  private constructor(private readonly plans: Pick<PlanProvider, "getActivePlan"> | undefined) {
    super();
  }

  async getPlan(input: {
    organizationId: string;
    userId: string | null;
  }): Promise<DataRetentionPlan> {
    if (!this.plans) {
      throw new ApiDataRetentionUnavailableError(
        "The organization's active plan, which every retention gate is decided against,",
      );
    }
    const plan: PlanInfo = await this.plans.getActivePlan({
      organizationId: input.organizationId,
      ...(input.userId ? { user: { id: input.userId } } : {}),
    } as never);
    return { free: plan.free, uncapped: isEnterpriseTier(plan.type) };
  }
}

/** The platform-operator allow-list, as the ops surface reads it. */
class ApiDataRetentionAdministrators extends DataRetentionAdministratorPort {
  static create(ops: ApiTrpcFeatureApplication["ops"]): ApiDataRetentionAdministrators {
    return new ApiDataRetentionAdministrators(ops);
  }

  private constructor(private readonly ops: ApiTrpcFeatureApplication["ops"]) {
    super();
  }

  isPlatformAdministrator(input: { userId: string | null; email: string | null }): boolean {
    // The slice declares its identity structurally, because the surfaces that
    // read it name different halves of a person. The one field this answer
    // turns on is the address the allow-list is written in.
    return this.ops.isAdmin({ email: input.email ?? undefined } as never);
  }
}
