import { ApiKeyApi, type ApiKeyApi as ApiKeyApiContract } from "@langwatch/api-key-contract";
import type { ApiKeyServerConfig } from "@langwatch/api-key-contract";
import { apiKeyServer } from "@langwatch/api-key-server";
import type { AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import { authzServer, type AuthzInfrastructure } from "@langwatch/authz-server";
import {
  dataRetentionServer,
  type DataRetentionInfrastructure,
} from "@langwatch/data-retention-server";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  MemberClassificationService,
  PrismaUsageMembershipRepository,
} from "@langwatch/entitlement-server";
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
} from "@langwatch/enterprise-plan-gate";
import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import type { Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  GroupIdentityAdapter,
  PersonalWorkspaceDiagnosticsAdapter,
  PersonalWorkspaceIdentityAdapter,
  organizationServer,
  TeamIdentityAdapter,
  type OrganizationPromptSeed,
  type OrganizationSeatLicense,
  type OrganizationSettingsSecret,
} from "@langwatch/organization-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { PostgresPromptAdapter, type PromptService } from "@langwatch/prompt-server";
import type { ProjectApi } from "@langwatch/project-contract";
import { projectServer, type ProjectInfrastructure } from "@langwatch/project-server";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ApplicationBuilder } from "@langwatch/runtime-composition";
import { shareServer, type ShareInfrastructure } from "@langwatch/share-server";
import { topicServer, type TopicInfrastructure } from "@langwatch/topic-server";
import type { AutomationSecretCrypto } from "@langwatch/automation-server";

/** The worker's installed, complete callable tenancy surfaces. */
export type WorkerTenancy = Readonly<{
  projects: ProjectApi;
  organizations: OrganizationApi;
  authorization: AuthzApiContract;
  apiKeys: ApiKeyApiContract;
  shares: import("@langwatch/share-contract").ShareApi;
  topics: import("@langwatch/topic-contract").TopicApi;
  close(): Promise<void>;
}>;

/**
 * Process substrates for the tenancy graph. Technical peer services are
 * deliberately absent: feature dependencies are resolved as API clients by
 * the runtime, including the Project/Organization and Project/API-key cycles.
 */
export type WorkerTenancyCompositionOptions = Readonly<{
  connection: PrismaConnection;
  redis: RedisConnection | null;
  logger: Logger;
  encryption: AutomationSecretCrypto;
  plans: PlanProvider;
  authz: Omit<AuthzInfrastructure, "database" | "redis">;
  apiKeys: ApiKeyServerConfig;
  dataRetention: Omit<DataRetentionInfrastructure, "redis">;
  share: Omit<ShareInfrastructure, "database" | "redis">;
  topics: TopicInfrastructure;
  project: ProjectInfrastructure;
}>;

/**
 * Adds tenancy declarations to the process-wide builder.
 *
 * The caller also installs Auth and User on this builder. Boot allocates every
 * API client before constructing an App, which resolves Organization/User and
 * Project/Organization cycles without a partial service or a lookup escape.
 */
export function installWorkerTenancy<Infrastructure>(
  builder: ApplicationBuilder<Infrastructure>,
  options: WorkerTenancyCompositionOptions,
): ApplicationBuilder<Infrastructure> {
  const database = options.connection.client;
  const prompts = PostgresPromptAdapter.create({ database }).build();

  return builder
    .withModule(authzServer, {
      infrastructure: { database, redis: options.redis, ...options.authz },
    })
    .withModule(organizationServer, {
      infrastructure: {
        identities: PersonalWorkspaceIdentityAdapter.create(),
        teamIdentities: TeamIdentityAdapter.create(),
        groupIdentities: GroupIdentityAdapter.create(),
        settingsSecrets: WorkerOrganizationSettingsSecrets.create(options.encryption),
        diagnostics: PersonalWorkspaceDiagnosticsAdapter.create(options.logger),
        prompts: WorkerOrganizationPrompts.create(prompts, options.logger),
        seats: WorkerOrganizationSeats.create({ plans: options.plans, database }),
      },
    })
    .withModule(projectServer, { infrastructure: options.project })
    .withModule(apiKeyServer, { config: options.apiKeys })
    .withModule(dataRetentionServer, {
      infrastructure: { ...options.dataRetention, redis: options.redis },
    })
    .withModule(shareServer, {
      infrastructure: { ...options.share, redis: options.redis },
    })
    .withModule(topicServer, { infrastructure: options.topics });
}

class WorkerOrganizationSettingsSecrets implements OrganizationSettingsSecret {
  static create(encryption: AutomationSecretCrypto): WorkerOrganizationSettingsSecrets {
    return new WorkerOrganizationSettingsSecrets(encryption);
  }
  private constructor(private readonly encryption: AutomationSecretCrypto) {}
  encrypt(value: string): string {
    return this.encryption.encrypt(value);
  }
  decrypt(value: string): string {
    return this.encryption.decrypt(value);
  }
}

class WorkerOrganizationPrompts implements OrganizationPromptSeed {
  static create(prompts: PromptService, logger: Pick<Logger, "error">): WorkerOrganizationPrompts {
    return new WorkerOrganizationPrompts(prompts, logger);
  }
  private constructor(
    private readonly prompts: PromptService,
    private readonly logger: Pick<Logger, "error">,
  ) {}
  seedTagsForOrganization(input: { organizationId: string }): Promise<void> {
    return this.prompts.seedTagsForOrganization(input);
  }
  reportCompensationFailure(error: Error): void {
    this.logger.error({ error }, "Organization provisioning could not undo its own commit");
  }
}

class WorkerOrganizationSeats implements OrganizationSeatLicense {
  static create(options: {
    plans: PlanProvider;
    database: PrismaConnection["client"];
  }): WorkerOrganizationSeats {
    return new WorkerOrganizationSeats(
      options.plans,
      PrismaUsageMembershipRepository.create(options.database),
    );
  }
  private constructor(
    private readonly plans: PlanProvider,
    private readonly memberships: PrismaUsageMembershipRepository,
  ) {}
  async checkLimit(input: {
    organizationId: string;
    resource: "members" | "membersLite";
    user?: { id: string; name?: string | null; email?: string | null };
  }) {
    const plan = await this.plans.getActivePlan(input);
    const max = input.resource === "members" ? plan.maxMembers : plan.maxMembersLite;
    if (plan.overrideAddingLimitations)
      return { allowed: true, limitType: input.resource, current: 0, max };
    const current =
      input.resource === "members"
        ? await this.memberships.getMemberCount(input.organizationId)
        : await this.memberships.getMembersLiteCount(input.organizationId);
    return { allowed: current < max, limitType: input.resource, current, max };
  }
  async assertRoleChangeAllowed(input: {
    organizationId: string;
    currentRole: string;
    userPermissions: string[] | undefined;
    role: string;
    teamRoleUpdates?: ReadonlyArray<{ role: string; customRoleId?: string }>;
    user?: { id: string; name?: string | null; email?: string | null };
  }): Promise<void> {
    const plan = await this.plans.getActivePlan({
      organizationId: input.organizationId,
      user: input.user,
    });
    const change = MemberClassificationService.getRoleChangeType(
      organizationRole(input.currentRole),
      input.userPermissions,
      organizationRole(input.role),
      undefined,
    );
    if (change !== "no-change" && !plan.overrideAddingLimitations) {
      const resource = change === "lite-to-full" ? "members" : "membersLite";
      const current =
        resource === "members"
          ? await this.memberships.getMemberCount(input.organizationId)
          : await this.memberships.getMembersLiteCount(input.organizationId);
      const max = resource === "members" ? plan.maxMembers : plan.maxMembersLite;
      if (current >= max) throw new LimitExceededError(resource, current, max);
    }
    if (
      (input.teamRoleUpdates ?? []).some(
        (update) => update.customRoleId || update.role.startsWith("custom:"),
      )
    ) {
      assertEnterprisePlanType({
        planType: plan.type,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });
    }
  }
}

function organizationRole(
  value: string,
): Parameters<typeof MemberClassificationService.getRoleChangeType>[0] {
  if (value === "ADMIN" || value === "MEMBER" || value === "EXTERNAL") return value;
  throw new Error(`Unknown organization role "${value}".`);
}
