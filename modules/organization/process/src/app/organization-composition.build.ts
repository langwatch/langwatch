/** Builds OrganizationInfrastructure from prisma, encryption, logger, redis, and config. */
import type { AuthzApi, OrganizationUserRole } from "@langwatch/authz-contract";
import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
  getRoleChangeType,
  isViewOnlyCustomRole,
  type EntitlementApi,
  type Plan,
  type PlanProviderUser,
  type RoleChangeType,
} from "@langwatch/entitlement-contract";
import {
  PrismaUsageMembershipRepository,
  type UsageMembershipRepository,
} from "@langwatch/entitlement-process";
import { HandledError } from "@langwatch/handled-error";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { Logger } from "@langwatch/observability";
import {
  OrganizationCapabilityUnavailableError,
  type OrganizationPendingInviteApplied,
} from "@langwatch/organization-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";

import type { OrganizationInviteRepository } from "../repositories/organization-invite.repository.ts";
import { PrismaOrganizationInviteRepository } from "../repositories/prisma/prisma.organization-invite.repository.ts";
import { PrismaOrganizationUserDirectoryRepository } from "../repositories/prisma/prisma.organization-user-directory.repository.ts";
import { isCustomRole } from "../rules/custom-role-naming.rules.ts";
import type { InviteAssignableRoles } from "../rules/invite-contracts.rules.ts";
import { resolveInviteDisplayStatus } from "../rules/invite-display-status.rules.ts";
import { buildInviteAcceptUrl } from "../rules/invite-link.rules.ts";
import { GroupIdentityService } from "../services/group-identity.service.ts";
import { InviteCreationThrottleService } from "../services/invite-creation-throttle.service.ts";
import { InviteSendThrottleService } from "../services/invite-send-throttle.service.ts";
import { InviteService } from "../services/invite.service.ts";
import { PersonalWorkspaceDiagnosticsService } from "../services/personal-workspace-diagnostics.service.ts";
import { PersonalWorkspaceIdentityService } from "../services/personal-workspace-identity.service.ts";
import { TeamIdentityService } from "../services/team-identity.service.ts";
import type { OrganizationInfrastructure } from "./organization.app.ts";
import type {
  OrganizationCeremony,
  OrganizationDirectory,
  OrganizationInviteRateLimit,
  OrganizationInviteSeatCensus,
  OrganizationInvitations,
  OrganizationInvitesCreated,
  OrganizationInviteWithOrganization,
  OrganizationJoinRequests,
  OrganizationPlanGate,
  OrganizationPlanUser,
  OrganizationPromptSeed,
  OrganizationSignals,
} from "./organization.members.ts";

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
    teamRoleUpdates?: readonly { role: string; customRoleId?: string }[] | undefined;
    user?: OrganizationPlanUser | undefined;
  }): Promise<void> {
    const plan = await this.activePlan(input.organizationId, input.user);
    // The NEW role's permissions are deliberately not read: a built-in role
    // carries none, and a custom one is gated below on the plan rather than on
    // a seat. That is the platform's own call, kept.
    const change = getRoleChangeType(
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

/** The seat census an invitation is validated against: the SAME membership counts the seat
 * licence above reads, narrowed to what {@link InviteService} asks of it. */
class EntitlementOrganizationInviteSeatCensus implements OrganizationInviteSeatCensus {
  static create(memberships: UsageMembershipRepository): EntitlementOrganizationInviteSeatCensus {
    return new EntitlementOrganizationInviteSeatCensus(memberships);
  }

  private constructor(private readonly memberships: UsageMembershipRepository) {}

  getMemberCount(organizationId: string): Promise<number> {
    return this.memberships.getMemberCount(organizationId);
  }

  getMembersLiteCount(organizationId: string): Promise<number> {
    return this.memberships.getMembersLiteCount(organizationId);
  }

  isViewOnlyCustomRole(permissions: string[]): boolean {
    return isViewOnlyCustomRole(permissions);
  }
}

/** The process's ONE fixed-window counter, over process Redis, as the invitation throttle
 * spends it: same shape as the model-provider connection limiter's own Redis adapter. */
class RedisOrganizationInviteRateLimit implements OrganizationInviteRateLimit {
  static create(redis: RedisConnection): RedisOrganizationInviteRateLimit {
    return new RedisOrganizationInviteRateLimit(redis);
  }

  private constructor(private readonly redis: RedisConnection) {}

  async limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number; count?: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>> {
    const counter = `organization:invite:rate-limit:${input.key}`;
    const now = nowInstant().epochMilliseconds;
    const count = input.count ?? 1;
    const used =
      count === 1 ? await this.redis.incr(counter) : await this.redis.incrby(counter, count);
    if (used === count) await this.redis.expire(counter, input.windowSeconds);
    if (used <= input.max) {
      return { allowed: true, resetAt: now + input.windowSeconds * 1000 };
    }

    const remaining = await this.redis.ttl(counter);
    return { allowed: false, resetAt: now + Math.max(remaining, 0) * 1000 };
  }
}

/**
 * The invitations this deployment administers, in the shape the door reads.
 * The service, repository and throttle are the deleted composition's own,
 * unmoved; only the wrapper's method names changed to match the door's port.
 */
export class InviteServiceOrganizationInvitations implements OrganizationInvitations {
  static create(options: {
    invites: InviteService;
    repository: OrganizationInviteRepository;
    throttle: InviteSendThrottleService;
    baseHost: string;
    identity: Pick<IdentityApi, "verifiedEmailsOf">;
    userDirectory: PrismaOrganizationUserDirectoryRepository;
    logger: Pick<Logger, "warn">;
  }): InviteServiceOrganizationInvitations {
    return new InviteServiceOrganizationInvitations(options);
  }

  private constructor(
    private readonly options: {
      invites: InviteService;
      repository: OrganizationInviteRepository;
      throttle: InviteSendThrottleService;
      baseHost: string;
      identity: Pick<IdentityApi, "verifiedEmailsOf">;
      userDirectory: PrismaOrganizationUserDirectoryRepository;
      logger: Pick<Logger, "warn">;
    },
  ) {}

  create(
    input: Parameters<OrganizationInvitations["create"]>[0],
  ): Promise<OrganizationInvitesCreated> {
    return this.options.invites.createInvites({
      organizationId: input.organizationId,
      invites: input.invites.map((invite) => ({
        email: invite.email,
        role: invite.role,
        ...(invite.teamIds === undefined ? {} : { teamIds: invite.teamIds }),
        ...(invite.teams === undefined ? {} : { teams: invite.teams.map((team) => ({ ...team })) }),
      })),
      // Whichever mode the transport asked for. The composition deliberately
      // picks none: hard-coding one here is what made the management API
      // accept a batch naming a team outside the organization and answer 201
      // with nothing created.
      validation: input.validation,
    });
  }

  async revoke(input: Readonly<{ organizationId: string; inviteId: string }>): Promise<void> {
    await this.options.invites.revokeInvite(input);
  }

  assertSendAllowed(input: Readonly<{ inviteId: string }>): Promise<void> {
    return this.options.throttle.assertInviteSendAllowed(input);
  }

  resend(
    input: Readonly<{ organizationId: string; inviteId: string }>,
  ): ReturnType<InviteService["resendInvite"]> {
    return this.options.invites.resendInvite(input);
  }

  list(input: Readonly<{ organizationId: string }>): ReturnType<InviteService["listInvites"]> {
    return this.options.invites.listInvites(input);
  }

  async findByCode(
    input: Readonly<{ inviteCode: string }>,
  ): Promise<OrganizationInviteWithOrganization | null> {
    const found = await this.options.repository
      .getInviteByCodeWithOrganization(input)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "invite_not_found") return undefined;
        throw error;
      });
    if (found === undefined || found.organization === null) return null;

    const { organization, ...invite } = found;
    return { ...invite, organization: { id: organization.id, name: organization.name } };
  }

  async matchToAcceptor(
    input: Readonly<{ inviteEmail: string; sessionEmail: string; userId: string }>,
  ): Promise<Readonly<{ matches: boolean; viaIdentifierId?: string | null }>> {
    const verified = await this.options.identity.verifiedEmailsOf({ userId: input.userId });
    return InviteService.matchInviteToAcceptor({
      inviteEmail: input.inviteEmail,
      sessionEmail: input.sessionEmail,
      matchable: verified.kind === "resolved" ? verified.emails : null,
    });
  }

  apply(
    input: Readonly<{
      userId: string;
      invite: OrganizationInviteWithOrganization;
      viaIdentifierId?: string | null;
    }>,
  ): Promise<void> {
    return this.options.invites.applyInvite(input);
  }

  applyPending(
    input: Readonly<{ userId: string; organizationId: string; email: string }>,
  ): Promise<OrganizationPendingInviteApplied> {
    return this.options.invites.applyPendingInvite(input);
  }

  async findLandingProjectSlug(
    input: Readonly<{ invite: OrganizationInviteWithOrganization }>,
  ): Promise<string | null> {
    const [slug] = await this.options.invites.findLandingProjectSlugs(input.invite);
    return slug ?? null;
  }

  acceptUrl(inviteCode: string): string {
    return buildInviteAcceptUrl(this.options.baseHost, inviteCode);
  }

  maskAddress(email: string): string {
    return InviteService.maskInvitedAddress(email);
  }

  displayStatus(invite: Parameters<OrganizationInvitations["displayStatus"]>[0]): string {
    return resolveInviteDisplayStatus(invite);
  }

  /** No mail gateway is composed on this process (D11's "absent is supported" state), so the
   * seat-limit notice has nowhere to send: logged rather than silently dropped. */
  async notifySeatLimitReached(
    input: Readonly<{ organizationId: string; limitType: string; current: number; max: number }>,
  ): Promise<void> {
    this.options.logger.warn(
      { organizationId: input.organizationId, limitType: input.limitType },
      "no mail gateway is composed, so this organization's administrators were not told it reached its seat limit",
    );
  }

  findUserIdByEmail(input: Readonly<{ email: string }>): Promise<string | null> {
    return this.options.userDirectory.findUserIdByEmail(input);
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
    logger.debug(
      { signal: what },
      `no product-analytics sink is composed: ${what} is not recorded`,
    );

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
 * The parts of the sign-up ceremony belonging to other features. The first
 * project goes through the project application rather than a second creation
 * path, so it writes the same rows the project surface writes.
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
 * Identity's join-request ledger, asked per call: a peer is not callable while
 * the process is still constructing, and this door is built during it.
 */
function identityJoinRequests(
  identity: Pick<IdentityApi, "joinRequests">,
): OrganizationJoinRequests {
  const ledger = () => identity.joinRequests();
  return {
    lookup: (input) => ledger().lookup(input),
    offerForSignedInUser: (input) => ledger().offerForSignedInUser(input),
    dismissOffer: (input) => ledger().dismissOffer(input),
    joinAutomaticallyIfAdmitted: (input) => ledger().joinAutomaticallyIfAdmitted(input),
    automaticJoinsForOrganization: (input) => ledger().automaticJoinsForOrganization(input),
    pendingForUser: (input) => ledger().pendingForUser(input),
    pendingForOrganization: (input) => ledger().pendingForOrganization(input),
    request: (input) => ledger().request(input),
    withdraw: (input) => ledger().withdraw(input),
    approve: (input) => ledger().approve(input),
    reject: (input) => ledger().reject(input),
    readJoining: (input) => ledger().readJoining(input),
    setJoining: (input) => ledger().setJoining(input),
    resolveByInvitation: (input) => ledger().resolveByInvitation(input),
    withdrawOnInvitationAccepted: (input) => ledger().withdrawOnInvitationAccepted(input),
  };
}

/**
 * One person's verified address, and the display names a pending list renders.
 * The address comes from the SAME identity application `user.*` answers from;
 * the fallback is the legacy verified column, as the deleted composition read it.
 */
function organizationDirectory(options: {
  identity: Pick<IdentityApi, "verifiedEmailsOf">;
  userDirectory: PrismaOrganizationUserDirectoryRepository;
}): OrganizationDirectory {
  return {
    findVerifiedEmail: async ({ userId }) => {
      const verified = await options.identity.verifiedEmailsOf({ userId });
      if (verified.kind === "resolved") return verified.emails[0]?.value ?? null;
      return options.userDirectory.findLegacyVerifiedEmail(userId);
    },
    // Names only: the local part of a requester's address is not the
    // organization's business until they are a member of it.
    listUserNames: ({ userIds }) => options.userDirectory.findUserNames(userIds),
  };
}

/**
 * `InviteService` composed from this process's own reads plus the peers
 * `ServerOrganizationApp` depends on. Mail and the workspace-size census
 * stay uncomposed — their absence is supported: invitations still write and carry an accept URL.
 */
function organizationInvitations(input: {
  prisma: ProcessMembers["prisma"];
  redis: RedisConnection;
  logger: Logger;
  baseHost: string;
  identity: Pick<IdentityApi, "verifiedEmailsOf">;
  entitlement: Pick<EntitlementApi, "getActivePlan">;
  permissions: AuthzApi;
  roles: InviteAssignableRoles;
}): OrganizationInvitations {
  const repository = PrismaOrganizationInviteRepository.create({ database: input.prisma });
  const throttle = InviteSendThrottleService.create(
    RedisOrganizationInviteRateLimit.create(input.redis),
  );
  const invites = InviteService.create({
    invites: repository,
    seats: EntitlementOrganizationInviteSeatCensus.create(
      PrismaUsageMembershipRepository.create(input.prisma),
    ),
    plans: input.entitlement,
    grants: input.permissions,
    roles: input.roles,
    throttle,
    baseHost: input.baseHost,
  });

  return InviteServiceOrganizationInvitations.create({
    invites,
    repository,
    throttle,
    baseHost: input.baseHost,
    identity: input.identity,
    userDirectory: PrismaOrganizationUserDirectoryRepository.create(input.prisma),
    logger: input.logger,
  });
}

/** What this process hands `ServerOrganizationApp` at boot. */
export function buildOrganizationInfrastructure(input: {
  prisma: ProcessMembers["prisma"];
  encryption: { encrypt(value: string): string; decrypt(value: string): string };
  logger: Logger;
  redis: RedisConnection;
  /** The process's own fact (`BASE_HOST`); absent where it named none. */
  publicBaseUrl: string | undefined;
  /** A process fact, unresolved — see the handoff. */
  processName: string;
  /** Unresolved — collides with `authz`'s landed leaves if redeclared here. */
  demoProject: Readonly<{ userId: string; projectId: string }>;
  dependencies: {
    projects: ProjectApi;
    identity: Pick<IdentityApi, "verifiedEmailsOf" | "joinRequests">;
    entitlement: Pick<EntitlementApi, "getActivePlan" | "requestBound">;
    permissions: AuthzApi;
    roles: InviteAssignableRoles;
  };
}): OrganizationInfrastructure {
  const { prisma, logger, dependencies } = input;
  const baseHost = input.publicBaseUrl ?? "";

  return {
    identities: PersonalWorkspaceIdentityService.create(),
    teamIdentities: TeamIdentityService.create(),
    groupIdentities: GroupIdentityService.create(),
    // An organization's stored settings and a project's stored secret are
    // encrypted by ONE algorithm under ONE key: the process's own cipher is
    // that key, so the settings this writes stay readable everywhere else.
    settingsSecrets: input.encryption,
    diagnostics: PersonalWorkspaceDiagnosticsService.create(logger),
    prompts: LoggedOrganizationPromptSeed.create({ processName: input.processName, logger }),
    seats: EntitlementOrganizationSeatLicense.create({
      plans: dependencies.entitlement,
      memberships: PrismaUsageMembershipRepository.create(prisma),
    }),
    invitations: organizationInvitations({
      prisma,
      redis: input.redis,
      logger,
      baseHost,
      identity: dependencies.identity,
      entitlement: dependencies.entitlement,
      permissions: dependencies.permissions,
      roles: dependencies.roles,
    }),
    // The sender-scoped creation counter: same fixed-window adapter the
    // resend throttle spends, so both invite limits live behind one port.
    inviteCreationThrottle: InviteCreationThrottleService.create({
      rateLimit: RedisOrganizationInviteRateLimit.create(input.redis),
      plans: dependencies.entitlement,
    }),
    // Identity owns the join-request ledger; this feature serves its door.
    joinRequests: identityJoinRequests(dependencies.identity),
    plans: organizationPlanGate({ plans: dependencies.entitlement }),
    signals: organizationSignals(logger),
    ceremony: organizationCeremony({ projects: dependencies.projects }),
    directory: organizationDirectory({
      identity: dependencies.identity,
      userDirectory: PrismaOrganizationUserDirectoryRepository.create(prisma),
    }),
    demoProject: input.demoProject,
  };
}
