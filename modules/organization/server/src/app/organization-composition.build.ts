/** Builds OrganizationInfrastructure from prisma, encryption, logger, and config. */
import { OrganizationCapabilityUnavailableError } from "@langwatch/organization-contract";
import type { EntitlementApi, Plan, PlanProviderUser } from "@langwatch/entitlement-contract";
import {
  MemberClassificationService,
  PrismaUsageMembershipRepository,
  type RoleChangeType,
  type UsageMembershipRepository,
} from "@langwatch/entitlement-server";
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
} from "@langwatch/enterprise-plan-gate";
import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { Logger } from "@langwatch/observability";
import type { OrganizationUserRole, PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";

import { isCustomRole } from "../rules/custom-role-naming.rules.ts";
import { PersonalWorkspaceDiagnosticsAdapter } from "../services/personal-workspace-diagnostics.service.ts";
import {
  GroupIdentityAdapter,
  PersonalWorkspaceIdentityAdapter,
  TeamIdentityAdapter,
} from "../services/resource-identifiers.service.ts";
import type {
  OrganizationCeremony,
  OrganizationDirectory,
  OrganizationPlanGate,
  OrganizationPlanUser,
  OrganizationPromptSeed,
  OrganizationSignals,
} from "./organization.members.ts";
import type { OrganizationAppConfig, OrganizationInfrastructure } from "./organization.app.ts";

/** What a seat decision answers when every field is known. */
type OrganizationSeatAnswer = Readonly<{
  allowed: boolean;
  limitType: "members" | "membersLite";
  current: number;
  max: number;
}>;

/** Seat licence over the same plan and membership counts; all fields answered. */
class EntitlementOrganizationSeatLicense {
  static create(options: {
    plans: Pick<EntitlementApi, "getActivePlan">;
    memberships: UsageMembershipRepository;
  }): EntitlementOrganizationSeatLicense {
    return new EntitlementOrganizationSeatLicense(options);
  }

  private constructor(
    private readonly options: {
      plans: Pick<EntitlementApi, "getActivePlan">;
      memberships: UsageMembershipRepository;
    },
  ) {}

  async checkLimit(input: {
    organizationId: string;
    resource: "members" | "membersLite";
    user?: OrganizationPlanUser | undefined;
  }): Promise<OrganizationSeatAnswer> {
    const plan = await this.activePlan(input.organizationId, input.user);
    const max = this.allowance(plan, input.resource);
    if (plan.overrideAddingLimitations) {
      return { allowed: true, limitType: input.resource, current: 0, max };
    }

    const current = await this.seatsTaken(input.organizationId, input.resource);
    return { allowed: current < max, limitType: input.resource, current, max };
  }

  async assertRoleChangeAllowed(input: {
    organizationId: string;
    currentRole: string;
    userPermissions: string[] | undefined;
    role: string;
    teamRoleUpdates?: ReadonlyArray<{ role: string; customRoleId?: string }> | undefined;
    user?: OrganizationPlanUser | undefined;
  }): Promise<void> {
    const plan = await this.activePlan(input.organizationId, input.user);
    // The NEW role's permissions are deliberately not read: a built-in role
    // carries none, and a custom one is gated below on the plan rather than on
    // a seat. That is the platform's own call, kept.
    const change = MemberClassificationService.getRoleChangeType(
      input.currentRole as OrganizationUserRole,
      input.userPermissions,
      input.role as OrganizationUserRole,
      undefined,
    );
    await this.assertSeatForChange({ change, organizationId: input.organizationId, plan });

    const assignsCustomRole = (input.teamRoleUpdates ?? []).some(
      (update) => Boolean(update.customRoleId) || isCustomRole(update.role),
    );
    if (assignsCustomRole) {
      assertEnterprisePlanType({
        planType: plan.type,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });
    }
  }

  private async assertSeatForChange(input: {
    change: RoleChangeType;
    organizationId: string;
    plan: Plan;
  }): Promise<void> {
    if (input.change === "no-change" || input.plan.overrideAddingLimitations) return;

    const resource = input.change === "lite-to-full" ? "members" : "membersLite";
    const max = this.allowance(input.plan, resource);
    const current = await this.seatsTaken(input.organizationId, resource);
    if (current >= max) {
      throw new LimitExceededError(resource, current, max);
    }
  }

  private activePlan(
    organizationId: string,
    user: OrganizationPlanUser | undefined,
  ): Promise<Plan> {
    // The plan application's own caller shape is the Enterprise licensing one
    // and the membership half may not name it, so the structural person the two
    // writes already carry is forwarded as it stands.
    return this.options.plans.getActivePlan({
      organizationId,
      ...(user ? { user: user as PlanProviderUser } : {}),
    });
  }

  private allowance(plan: Plan, resource: "members" | "membersLite"): number {
    return resource === "members" ? plan.maxMembers : plan.maxMembersLite;
  }

  private seatsTaken(organizationId: string, resource: "members" | "membersLite"): Promise<number> {
    return resource === "members"
      ? this.options.memberships.getMemberCount(organizationId)
      : this.options.memberships.getMembersLiteCount(organizationId);
  }
}

/**
 * The prompt-tag seeding a new organization gets, absent. The tag catalogue is
 * the prompt feature's and this process composes no route to it, so the seed
 * says so once and provisioning carries on.
 */
class LoggedOrganizationPromptSeed implements OrganizationPromptSeed {
  static create(options: {
    processName: string;
    logger: Pick<Logger, "warn" | "error">;
  }): LoggedOrganizationPromptSeed {
    return new LoggedOrganizationPromptSeed(options.processName, options.logger);
  }

  private constructor(
    private readonly processName: string,
    private readonly logger: Pick<Logger, "warn" | "error">,
  ) {}

  async seedTagsForOrganization(input: { organizationId: string }): Promise<void> {
    this.logger.warn(
      { organizationId: input.organizationId },
      `${this.processName} composes no prompt service, so the new organization starts with no prompt tags.`,
    );
  }

  reportCompensationFailure(error: Error): void {
    this.logger.error({ error }, "Organization provisioning could not undo its own commit");
  }
}

/**
 * Both Enterprise plan gates, over the ONE plan application this process
 * resolves every allowance through. SCIM and the seat guard are read out of
 * stores this process does not hold, so both refuse by name.
 */
function organizationPlanGate(options: {
  plans: Pick<EntitlementApi, "getActivePlan">;
}): OrganizationPlanGate {
  const assertPlan = async (organizationId: string, errorMessage: string) => {
    const plan = await options.plans.getActivePlan({ organizationId });
    assertEnterprisePlanType({ planType: plan.type, errorMessage });
  };

  return {
    assertCustomRolesAllowed: ({ organizationId }) =>
      assertPlan(organizationId, ENTERPRISE_FEATURE_ERRORS.RBAC),
    assertAuditLogsAllowed: ({ organizationId }) =>
      assertPlan(organizationId, ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS),
    assertScimAllowed: () =>
      Promise.reject(
        new OrganizationCapabilityUnavailableError(
          "Enterprise plan store, so it cannot confirm this organization carries SCIM",
        ),
      ),
    assertTeamRoleChangeWithinSeatLimits: () =>
      Promise.reject(
        new OrganizationCapabilityUnavailableError(
          "Enterprise seat licence, so it cannot authorize a member role change",
        ),
      ),
  };
}

/**
 * The trail a sign-up, an invitation and a chosen integration leave outside
 * this feature. This process composes no product-analytics sink and no
 * marketing gateway, so each one says so once, at debug, and carries on.
 */
function organizationSignals(logger: Logger): OrganizationSignals {
  const unsent = (what: string) =>
    logger.debug({ signal: what }, `no product-analytics sink is composed: ${what} is not recorded`);

  return {
    trackServerEvent: (input) => unsent(`the organization event "${input.event}"`),
    fireTeamMemberInvitedNurturing: () => unsent("a team member being invited"),
    fireInviteAcceptedNurturing: () => unsent("an invitation being accepted"),
    fireSignupNurturing: () => unsent("somebody signing up"),
    sendSlackSignupEvent: async () => unsent("a sign-up announcement"),
    sendHubspotSignupForm: async () => unsent("a sign-up form"),
    recordIntegrationMethod: () => unsent("a chosen integration method"),
    reportError: (error) => {
      logger.error({ error }, "an organization surface failed");
    },
  };
}

/**
 * The parts of the sign-up ceremony that belong to other features. The first
 * project goes through the project application this process composed rather
 * than a second creation path, so it writes the same rows the project surface
 * writes.
 */
function organizationCeremony(options: { projects: ProjectApi }): OrganizationCeremony {
  return {
    /**
     * The standard AI-tool catalogue is an Enterprise governance capability.
     * Non-fatal at the call site — the portal's own read provisions the same
     * set — so this refuses by name and the ceremony carries on.
     */
    ensureDefaultAiToolCatalog: () =>
      Promise.reject(
        new OrganizationCapabilityUnavailableError(
          "Enterprise governance service, so it seeded no standard AI tool catalogue",
        ),
      ),
    createProject: async (input) => {
      const project = await options.projects.create(
        {
          organizationId: input.organizationId,
          teamId: input.teamId,
          name: input.name,
          language: input.language,
          framework: input.framework,
        },
        { id: input.userId },
      );

      return { success: true, projectSlug: project.slug };
    },
  };
}

/**
 * One person's own verified address, and the display names a pending list
 * renders. The address comes from the SAME identity application `user.*`
 * answers from; the fallback is the legacy verified column, exactly as the
 * deleted composition read it.
 */
function organizationDirectory(options: {
  identity: Pick<IdentityApi, "verifiedEmailsOf">;
  prisma: PrismaClient;
}): OrganizationDirectory {
  return {
    findVerifiedEmail: async ({ userId }) => {
      const verified = await options.identity.verifiedEmailsOf({ userId });
      if (verified !== null) return verified[0]?.value ?? null;
      const row = await options.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerified: true },
      });
      return row?.emailVerified ? (row.email ?? null) : null;
    },
    // Names only: the local part of a requester's address is not the
    // organization's business until they are a member of it.
    listUserNames: ({ userIds }) =>
      options.prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, name: true },
      }),
  };
}

/** What this process hands `ServerOrganizationApp` at boot. */
export function buildOrganizationInfrastructure(input: {
  prisma: PrismaClient;
  encryption: { encrypt(value: string): string; decrypt(value: string): string };
  logger: Logger;
  config: OrganizationAppConfig;
  dependencies: {
    projects: ProjectApi;
    identity: Pick<IdentityApi, "verifiedEmailsOf">;
    entitlement: Pick<EntitlementApi, "getActivePlan">;
  };
}): OrganizationInfrastructure {
  const { prisma, logger, config, dependencies } = input;

  return {
    identities: PersonalWorkspaceIdentityAdapter.create(),
    teamIdentities: TeamIdentityAdapter.create(),
    groupIdentities: GroupIdentityAdapter.create(),
    // An organization's stored settings and a project's stored secret are
    // encrypted by ONE algorithm under ONE key: the process's own cipher is
    // that key, so the settings this writes stay readable everywhere else.
    settingsSecrets: input.encryption,
    diagnostics: PersonalWorkspaceDiagnosticsAdapter.create(logger),
    prompts: LoggedOrganizationPromptSeed.create({ processName: config.processName, logger }),
    seats: EntitlementOrganizationSeatLicense.create({
      plans: dependencies.entitlement,
      memberships: PrismaUsageMembershipRepository.create(prisma),
    }),
    // No invitation service is composed on this process, so the invitation
    // door refuses by name rather than administering invitations nobody mints.
    invitations: null,
    // Likewise the join-request ledger: the join door refuses by name.
    joinRequests: null,
    plans: organizationPlanGate({ plans: dependencies.entitlement }),
    signals: organizationSignals(logger),
    ceremony: organizationCeremony({ projects: dependencies.projects }),
    directory: organizationDirectory({ identity: dependencies.identity, prisma }),
    demoProject: config.demoProject,
  };
}
