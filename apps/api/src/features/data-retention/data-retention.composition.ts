/**
 * How long a project's scopes keep what they captured, composed as its own feature.
 * `dataRetention.*` — the window a scope is swept on, what its plan may set that to, and
 * how many bytes the current scope holds.
 */
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import {
  DataRetentionPlanPort,
  PrismaDataRetentionDirectoryRepository,
  dataRetentionServer,
  type DataRetentionInfrastructure,
  type DataRetentionPlan,
} from "@langwatch/data-retention-server";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { isEnterpriseTier } from "@langwatch/enterprise-plan-gate";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { UserApi, type UserApi as UserApiContract } from "@langwatch/user-contract";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createDataRetentionTrpcRouter } from "./data-retention-trpc.mount.ts";
import type { ComposedDataRetentionFeature } from "./data-retention.composition.types.ts";

/** The other features' apps the retention surface resolves and authorizes through. */
export type DataRetentionPeers = Readonly<{
  /** Resolves a project's organization and team, for a scoped rule. */
  projects: ProjectApiContract;
  /** Resolves a team's organization, for an organization-scoped rule. */
  organizations: OrganizationApiContract;
  /** The SAME permission answers the declared check on the same procedure asks. */
  permissions: AuthzApiContract;
  /**
   * The operator allow-list "who may keep data forever" is decided against, and
   * the address it is written in. The SAME directory every other surface reads,
   * so the answer can never be two answers.
   */
  users: UserApiContract;
}>;

/** Installs the retention surface over this process's own graph. */
export async function installApiDataRetention(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: DataRetentionPeers;
  /** The floor a project with no policy of its own is bounded by. */
  defaultRetentionDays: number;
  /** The meter's counters; `null` runs them uncached. */
  redis: DataRetentionInfrastructure["redis"];
  /** The application's own ClickHouse, or `null` where the process composed none. */
  resolveClickHouseClient: DataRetentionInfrastructure["resolveClickHouseClient"];
}): Promise<ComposedDataRetentionFeature> {
  const { prisma, plans } = options.infrastructure;
  const { projects, organizations, permissions, users } = options.peers;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(ProjectApi, projects)
    .withProvided(OrganizationApi, organizations)
    .withProvided(AuthzApi, permissions)
    .withProvided(UserApi, users)
    .withModule(dataRetentionServer, {
      infrastructure: {
        directory: PrismaDataRetentionDirectoryRepository.create(prisma),
        plans: ApiDataRetentionPlans.create(plans),
        redis: options.redis,
        resolveClickHouseClient: options.resolveClickHouseClient,
      },
    })
    .boot({
      role: "api",
      config: {
        "data-retention": { platformDefaultRetentionDays: options.defaultRetentionDays },
      },
    });

  const app = runtime.module(dataRetentionServer).provided;

  return {
    router: (mount) => createDataRetentionTrpcRouter(mount.runtime),
    service: app,
  };
}

/**
 * The plan behind a retention gate, reduced to the two facts retention tiers on.
 * Which plan types count as enterprise, and whether this install is SaaS at all,
 * are billing and licensing facts the feature deliberately does not know.
 */
class ApiDataRetentionPlans extends DataRetentionPlanPort {
  static create(plans: Pick<PlanProvider, "getActivePlan">): ApiDataRetentionPlans {
    return new ApiDataRetentionPlans(plans);
  }

  private constructor(private readonly plans: Pick<PlanProvider, "getActivePlan">) {
    super();
  }

  async getPlan(input: {
    organizationId: string;
    userId: string | null;
  }): Promise<DataRetentionPlan> {
    const plan: PlanInfo = await this.plans.getActivePlan({
      organizationId: input.organizationId,
      ...(input.userId ? { user: { id: input.userId } } : {}),
    });

    return { free: plan.free, uncapped: isEnterpriseTier(plan.type) };
  }
}
