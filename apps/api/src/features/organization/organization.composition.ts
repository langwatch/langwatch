/**
 * `organization.*` — the members of a tenant, their team bindings, its audit trail and
 * its invitations — composed as its own feature. Three groups of answers, and the split
 * is the point.
 */
import type { AuthService } from "@langwatch/auth-contract";
import {
  declareAuthzMiddleware,
  type AuthzBindingForSynthesis,
  type AuthzGrantsService,
  type AuthzService,
} from "@langwatch/authz-contract";
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
} from "@langwatch/enterprise-plan-gate";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  MemberClassificationService,
  PrismaUsageMembershipRepository,
  type RoleChangeType,
  type UsageMembershipRepository,
} from "@langwatch/entitlement-server";
import { HandledError } from "@langwatch/handled-error";
import {
  EmailJoinRequestNotifierAdapter,
  IdentityEventingPort,
  JoinRequestGuardsService,
  JoinRequestLedgerWriterAdapter,
  JoinRequestService,
  JoinRequestsService,
  PostgresIdentityEmailAdapter,
  PrismaJoinCandidateRepository,
  PrismaJoinMembershipAdapter,
  PrismaJoinRequestProjectionRepository,
  PrismaJoinRequestReadRepository,
  PrismaJoinSettingsAdapter,
} from "@langwatch/identity-server";
import { createLogger, type Logger } from "@langwatch/observability";
import { ResourceScope } from "@langwatch/runtime-composition";
import { toDate } from "@langwatch/time";
import {
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
  InviteExpiredError,
  InviteNotFoundError,
  InviteWrongAccountError,
  OrganizationNotFoundError,
  type OrganizationApi,
  type OrganizationService,
} from "@langwatch/organization-contract";
import {
  LITE_MEMBER_VIEWER_ONLY_ERROR,
  MemberSeatLimitReachedError,
  PersonalTeamScopeService,
  PostgresPersonalTeamScopeAdapter,
  buildInviteAcceptUrl,
  isCustomRole,
  isTeamRoleAllowedForOrganizationRole,
  OrganizationMembershipService,
  PersonalWorkspaceDiagnosticsAdapter,
  resolveInviteDisplayStatus,
  ServerOrganizationApp,
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
  GroupIdentityAdapter,
  PersonalWorkspaceIdentityAdapter,
  TeamIdentityAdapter,
  type GroupTrpcPorts,
  type JoinRequestTrpcPorts,
  type OnboardingTrpcPorts,
  type OrganizationPlanUser,
  type OrganizationProvisioningPort,
  type OrganizationRestService,
  type OrganizationTrpcPorts,
  type TeamRoleValue,
  type TeamTrpcPorts,
} from "@langwatch/organization-server";
import {
  RoleBindingScopeType,
  type OrganizationUserRole,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import type { ProjectApi, ProjectService } from "@langwatch/project-contract";
import type { RoleApi } from "@langwatch/role-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { UserApp } from "@langwatch/user-server";
import { z } from "zod";

import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import { ApiOrganizationSettingsSecretAdapter } from "../../app/api-organization-settings-secret.adapter.ts";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { composeApiOrganizationInvites } from "../../app/api-organization-invites.composition.ts";
import type { ApiPersonMailPort } from "../../app/api-person-mail.port.ts";
import type { ApiEnterpriseApplicationPort } from "../enterprise/enterprise.composition.ts";

/**
 * The questionnaire the sign-up form collects, as the ceremony forwards it. Opaque to the
 * organization package on purpose — the shape is the deployment's — so the schema is
 * declared where the process that reads the answers lives.
 */
export const signUpDataSchema = z.object({}).passthrough();

/**
 * The platform application's licence-limit copy, stated here. The message a member reads
 * when an organization is out of full seats. Stated rather than imported because the
 * licence-enforcement vertical has not moved, and the words are what a customer sees.
 */
const FULL_MEMBER_LIMIT_MESSAGE = "Cannot complete action: full member limit reached";

/**
 * The invitation half of `organization.*`, for a deployment that composed one.
 */
export abstract class ApiOrganizationInvitePort {
  /** Everything `organization.*` asks the invitation service. */
  abstract readonly ports: Pick<
    OrganizationTrpcPorts<never>,
    | "createInvites"
    | "revokeInvite"
    | "assertInviteSendAllowed"
    | "resendInvite"
    | "listInvites"
    | "matchInviteToAcceptor"
    | "maskInvitedAddress"
    | "applyInvite"
    | "tryFindLandingProjectSlug"
    | "resolveJoinRequestByInvitation"
    | "withdrawJoinRequestOnInvitationAccepted"
  >;
}

/** The other services and deployment facts `organization.*` reaches. */
export type OrganizationPeers = Readonly<{
  /**
   * The grant ledger an accepted invitation's role bindings are written
   * through. Absent, the invitation half is not composed here and the
   * injected port — or the refusal — stands.
   */
  authzGrants?: AuthzGrantsService | undefined;
  /**
   * The SAME role service `role.*` and `roleBinding.*` mount. An invitation
   * validated against a second copy of assignability would be accepted on
   * write and silently dropped on acceptance.
   */
  roles?: RoleApi | undefined;
  /** The deployment's cipher, for the organization's stored settings. */
  encryption: SecretEncryptionPort | undefined;
  /** The Enterprise application, where the deployment composed one. */
  enterprise?: ApiEnterpriseApplicationPort | undefined;
  /** The invitation service, where the deployment composed one. */
  invites?: ApiOrganizationInvitePort | undefined;
  /**
   * The membership graph the four tenant-shaped namespaces are served over, where this
   * process composed one.
   */
  membership?: OrganizationMembershipPeers | undefined;
}>;

/** What the membership half of this feature is composed over. */
export type OrganizationMembershipPeers = Readonly<{
  /** The same organization service the REST doors and the AuthZ graph serve from. */
  organizations: OrganizationService;
  /** The same project service the tenancy graph composed. */
  projects: ProjectService;
  /** The complete project feature API used by organization-owned workflows. */
  projectApi: ProjectApi;
  /** The grant ledger every membership write states its access on. */
  grants: AuthzGrantsService;
  /** The Auth service a disabled membership's browser sessions are revoked through. */
  auth: AuthService;
  /**
   * The signed-in person's application, for the personal workspace the sign-up
   * ceremony provisions. The SAME one `user.*` answers from: a second would
   * provision a workspace for somebody the /me screens do not know.
   */
  users: Pick<UserApp, "ensurePersonalWorkspace">;
  /** The event stack the join-request ledger appends and stages through. */
  eventing: IdentityEventingPort;
  /** The messages this half sends, where the deployment composed a gateway. */
  mail?: ApiPersonMailPort | undefined;
  /** Names this process in every refusal the membership half raises. */
  processName: string;
}>;

import type { ComposedOrganizationFeature } from "./organization.composition.types.ts";

/** Composes `organization.*` over this process's own graph. */
export function composeOrganizationFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: OrganizationPeers;
  /**
   * The process's ONE fixed-window counter. The same instance every other throttle on
   * this process meters through: two limiters would give one caller two budgets, which is
   * the whole reason the production composition holds a single one.
   */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  /** This deployment's public origin, for the invitation links it mints. */
  baseHost: string;
  /** The demo project every caller may read, where a deployment names one. */
  demoProject: Readonly<{ userId: string; projectId: string }>;
}): ComposedOrganizationFeature {
  const logger = createLogger("langwatch:api:organization");
  const membership = options.peers.membership
    ? composeMembershipHalf({
        prisma: options.infrastructure.prisma,
        plans: options.infrastructure.plans,
        peers: options.peers.membership,
        permissions: options.infrastructure.authz,
        rateLimit: (input) => options.rateLimit(input),
        logger,
        encryption: options.peers.encryption,
        baseHost: options.baseHost,
      })
    : undefined;

  // The five namespaces, their forty-six ports, the team ports and the
  // audit-log check went with the transports that took them; they return with
  // the converted ones.
  return {
    app: membership?.app ?? refusingServerOrganizationApp(),
    rest: membership?.rest,
    provisioning: membership?.provisioning,
  };
}

/**
 * `organization.*` on a process that composed no graph to administer. The namespace still
 * mounts and every call refuses by name, so an administrator is told the deployment
 * cannot answer rather than shown an organization with no members in it.
 */
export function refusingOrganizationFeature(): ComposedOrganizationFeature {
  return { app: refusingServerOrganizationApp(), rest: undefined, provisioning: undefined };
}


/** What a `kind: "custom"` check is handed on this process's root. */
type ScopeCheckParams<TInput> = {
  ctx: { actor(): { id: string }; permissionChecked?: boolean };
  input: TInput;
  next(): unknown;
};

/** The caller of one request, as the ports above read it. */
const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

/**
 * Runs one asynchronous read over a list, a few at a time. Bounded rather than a fan-out:
 * an organization's project list can be long, and one decision per project opened at once
 * would starve the same connection pool the request itself is running on.
 */
const PERMISSION_PROBE_CONCURRENCY = 8;

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  run: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array<TResult>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(PERMISSION_PROBE_CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index] as TItem);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function decryptStoredSecret(encryption: SecretEncryptionPort | undefined, value: string): string {
  if (!encryption) {
    throw new ApiOrganizationUnavailableError(
      "stored-secret key, so it cannot read this organization's stored settings",
    );
  }
  return encryption.decrypt(value);
}

/**
 * An invited address, masked, for a deployment with no invitation service. The same shape
 * the invitation service produces: enough of the address for the person holding the link
 * to recognise whether it is theirs, and not enough to learn somebody else's.
 */
function maskAddress(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

/** A capability this deployment did not compose, refused by name. */
export class ApiOrganizationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
      // The capability itself, because the wire message is the CODE (#5984):
      // without it a customer's failure is traceable to "something is off"
      // rather than to the deployment shape that caused it.
      meta: { capability },
    });
    this.name = "ApiOrganizationUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// The membership half: seats, groups, join requests and the sign-up ceremony
// ---------------------------------------------------------------------------

/** Everything the membership half composed, ready to mount. */
type OrganizationMembership = Readonly<{
  app: OrganizationApi;
  rest: OrganizationRestService;
  provisioning: OrganizationProvisioningPort &
    Pick<OrganizationService, "getBillingProfile" | "claimBillingCustomerId">;
  ports: MembershipPorts;
}>;

/** The three port groups the membership namespaces are built on. */
type MembershipPorts = Readonly<{
  group: GroupTrpcPorts;
  joinRequests: JoinRequestTrpcPorts;
  onboarding: OnboardingTrpcPorts<typeof signUpDataSchema>;
}>;



/**
 * Composes the membership half over this process's own graph. The organization service,
 * the project service, the grant ledger and the user directory all arrive already
 * composed.
 */
function composeMembershipHalf(options: {
  prisma: PrismaClient;
  plans: Pick<PlanProvider, "getActivePlan">;
  peers: OrganizationMembershipPeers;
  permissions: AuthzService;
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  logger: Logger;
  encryption: SecretEncryptionPort;
  /** This deployment's public origin, for a lapsed requester's personal project link. */
  baseHost: string;
}): OrganizationMembership {
  const { prisma, plans, peers, logger, baseHost, encryption } = options;
  const { projects, projectApi, grants, auth, users, eventing, mail, processName } = peers;
  const unavailable = (capability: string) => new ApiOrganizationUnavailableError(capability);

  const prompts = LoggedApiOrganizationPromptSeed.create({ processName, logger });
  const seats = ApiOrganizationSeatLicense.create({
    plans,
    memberships: PrismaUsageMembershipRepository.create(prisma),
  });
  const sessions = AuthServiceOrganizationSessionRevocation.create(auth);
  const grantCache = AuthzOrganizationGrantCache.create(grants);
  const identityEmails = PostgresIdentityEmailAdapter.create({ database: prisma }).build();

  function notifyNothing(what: string): void {
    logger.warn(
      { processName },
      `${processName} composes no mail gateway, so nobody was told that ${what}.`,
    );
  }

  const joinRequests = JoinRequestsService.create({
    requests: JoinRequestService.create(
      JoinRequestGuardsService.create({ requests: new PrismaJoinRequestReadRepository(prisma) }),
      JoinRequestLedgerWriterAdapter.create({
        projectionStore: new PrismaJoinRequestProjectionRepository(prisma),
        eventing,
      }),
    ),
    reads: new PrismaJoinRequestReadRepository(prisma),
    candidates: new PrismaJoinCandidateRepository(prisma),
    membership: PrismaJoinMembershipAdapter.create(prisma, grants),
    notifier: mail
      ? EmailJoinRequestNotifierAdapter.create({
          prisma,
          mail,
          baseHost,
          plans,
          memberships: PrismaUsageMembershipRepository.create(prisma),
        })
      : {
          // Fire-and-forget by construction: a request that could not be
          // announced is still recorded, and the admin finds it on the members
          // page. Logged rather than refused so nobody is blocked from asking.
          requestArrived: async () => notifyNothing("a join request arrived"),
          requestStillWaiting: async () => notifyNothing("a join request is still waiting"),
          requestApproved: async () => notifyNothing("a join request was approved"),
          requestRejected: async () => notifyNothing("a join request was rejected"),
          requestExpired: async () => notifyNothing("a join request expired"),
          joinedAutomatically: async () => notifyNothing("somebody joined automatically"),
        },
    settings: PrismaJoinSettingsAdapter.create(prisma),
    // The licence asymmetry, stated once: the gate that has always held single
    // sign-on holds AUTOMATIC joining, because that is federation. This process
    // holds no licence gate, so automatic joining is denied and ASKING is not —
    // which is exactly the shape that keeps "my company is invisible" fixed on
    // the deployments that have no other way out.
    autoJoinLicensed: () => Promise.resolve(false),
    // No feature-flag service on this half, and the flag is a rollout control
    // rather than an entitlement: the surface is mounted, so it is on.
    enabled: () => Promise.resolve(true),
    rateLimit: (input) => options.rateLimit(input),
  });

  /**
   * The caller's own verified address, and the reason every requester-side join-request
   * procedure starts here.
   */
  const verifiedEmailFor = async ({ userId }: { userId: string }): Promise<string | null> => {
    const verified = await identityEmails.tryVerifiedEmailsOf({ userId });
    if (verified !== null) return verified[0]?.value ?? null;
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    return row?.emailVerified ? (row.email ?? null) : null;
  };

  const app = ServerOrganizationApp.create({
    infrastructure: {
      database: prisma,
      identities: PersonalWorkspaceIdentityAdapter.create(),
      teamIdentities: TeamIdentityAdapter.create(),
      groupIdentities: GroupIdentityAdapter.create(),
      settingsSecrets: ApiOrganizationSettingsSecretAdapter.create({ encryption }),
      diagnostics: PersonalWorkspaceDiagnosticsAdapter.create(logger),
      prompts,
      seats,
    },
    dependencies: {
      projects: projectApi,
      permissions: options.permissions,
      users,
    },
    config: undefined,
    resources: new ResourceScope(),
  });
  const rest: OrganizationRestService = {
    getSettings: (input) => app.getSettings(input),
    updateSettings: (input) => app.updateSettings(input),
    listMembers: async (input) => {
      const result = await app.listMembers(input);
      return {
        ...result,
        members: result.members.map((member) => ({
          ...member,
          disabledAt: member.disabledAt === null ? null : toDate(member.disabledAt),
          createdAt: toDate(member.createdAt),
          updatedAt: toDate(member.updatedAt),
        })),
      };
    },
    getMember: async (input) => {
      const member = await app.getMember(input);
      return {
        ...member,
        disabledAt: member.disabledAt === null ? null : toDate(member.disabledAt),
        createdAt: toDate(member.createdAt),
        updatedAt: toDate(member.updatedAt),
      };
    },
    changeMemberRole: (input, by) => app.changeMemberRole(input, by),
    setMemberDisabled: (input, by) => app.setMemberDisabled(input, by),
    deleteMember: (input, by) => app.deleteMember(input, by),
  };
  const provisioning: OrganizationProvisioningPort &
    Pick<OrganizationService, "getBillingProfile" | "claimBillingCustomerId"> = {
    createForProvisioning: (input) => app.createForProvisioning(input),
    deleteProvisionedOrganization: (input) => app.deleteProvisionedOrganization(input),
    getBillingProfile: (input) => app.getBillingProfile(input),
    claimBillingCustomerId: (input) => app.claimBillingCustomerId(input),
    listProvisioningSummaries: async () =>
      (await app.listProvisioningSummaries()).map((summary) => ({
        ...summary,
        createdAt: toDate(summary.createdAt),
      })),
    tryGetProvisioningSummary: async (organizationId) => {
      const summary = await app.tryGetProvisioningSummary(organizationId);
      return summary === null ? null : { ...summary, createdAt: toDate(summary.createdAt) };
    },
  };

  return {
    app,
    // The SAME merged object `ServerOrganizationApp` reads, published so the
    // management REST family serves from it too. A second service over the
    // same rows would let `/api/organization/members` and the members screen
    // disagree about who is in an organization.
    rest,
    provisioning,
    ports: {
      group: {
        /**
         * Groups arrive with SCIM, which is an Enterprise capability read per
         * organization out of a billing store this process does not hold.
         */
        assertScimAllowed: () =>
          Promise.reject(
            unavailable(
              "Enterprise plan store, so it cannot confirm this organization carries SCIM",
            ),
          ),
      },

      joinRequests: {
        lookup: (_ctx, input) => joinRequests.lookup(input),
        pendingForUser: (_ctx, input) => joinRequests.pendingForUser(input),
        request: (_ctx, input) => joinRequests.request(input),
        withdraw: (_ctx, input) => joinRequests.withdraw(input),
        pendingForOrganization: (_ctx, input) => joinRequests.pendingForOrganization(input),
        approve: (_ctx, input) => joinRequests.approve(input),
        reject: (_ctx, input) => joinRequests.reject(input),
        readJoining: (_ctx, input) => joinRequests.readJoining(input),
        setJoining: (_ctx, input) => joinRequests.setJoining(input),
        tryResolveVerifiedEmail: (_ctx, input) => verifiedEmailFor(input),
        listUserNames: (_ctx, { userIds }: Readonly<{ userIds: readonly string[] }>) =>
          prisma.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, name: true },
          }),
      },

      onboarding: {
        signUpDataSchema,
        /**
         * The standard AI-tool catalogue is an Enterprise governance capability.
         * Non-fatal at the call site — the portal's own read provisions the same
         * set — so this refuses by name and the ceremony carries on.
         */
        ensureDefaultAiToolCatalog: () =>
          Promise.reject(
            unavailable(
              "Enterprise governance service, so it seeded no standard AI tool catalogue",
            ),
          ),
        ensurePersonalWorkspace: (_ctx, input) => users.ensurePersonalWorkspace(input),
        /**
         * The first project. It goes through the project service this process
         * composed rather than a second creation path, so it writes the same
         * rows the project surface writes.
         */
        createProject: async (_ctx, input) => {
          const project = await projects.create({
            organizationId: input.organizationId,
            teamId: input.teamId,
            name: input.name,
            language: input.language,
            framework: input.framework,
          });
          return { success: true, projectSlug: project.slug };
        },
        // The deployment's marketing traffic. Fire-and-forget by construction:
        // a sign-up that could not be announced still created the organization.
        sendSlackSignupEvent: async () => notifyNothing("somebody signed up"),
        sendHubspotSignupForm: async () => notifyNothing("somebody signed up"),
        fireSignupNurturing: () => notifyNothing("somebody signed up"),
        recordIntegrationMethod: () => notifyNothing("somebody chose an integration method"),
        reportError: (error: unknown, context: unknown) => {
          logger.error({ error, context }, "Onboarding step failed");
        },
      },
    } as MembershipPorts,
  };
}


/** The `ctx.app.organizations` slice on a process with no membership graph. */
function refusingServerOrganizationApp(): OrganizationApi {
  return new Proxy(
    {},
    {
      get: () => (): never => {
        throw new ApiOrganizationUnavailableError("organization directory");
      },
      has: () => true,
    },
  ) as OrganizationApi;
}

/** A seat decision with every field answered. */
export type ApiOrganizationSeatAnswer = Readonly<{
  allowed: boolean;
  limitType: "members" | "membersLite";
  current: number;
  max: number;
}>;

/**
 * The seat licence, over the SAME plan provider and the SAME membership counts every
 * other allowance in this process reads.
 */
export class ApiOrganizationSeatLicense extends OrganizationSeatLicensePort {
  static create(options: {
    plans: Pick<PlanProvider, "getActivePlan">;
    memberships: UsageMembershipRepository;
  }): ApiOrganizationSeatLicense {
    return new ApiOrganizationSeatLicense(options);
  }

  private constructor(
    private readonly options: {
      plans: Pick<PlanProvider, "getActivePlan">;
      memberships: UsageMembershipRepository;
    },
  ) {
    super();
  }

  /**
   * Narrower than the port on purpose: every field is answered, always. The port leaves
   * `limitType`, `current` and `max` optional so a deployment with no seat gate can refuse with
   * `allowed` alone, and the licence-enforcement door needs all four to render a limit.
   */
  async checkLimit(input: {
    organizationId: string;
    resource: "members" | "membersLite";
    user?: OrganizationPlanUser | undefined;
  }): Promise<ApiOrganizationSeatAnswer> {
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
    await this.assertSeatForChange({
      change,
      organizationId: input.organizationId,
      plan,
    });

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
    plan: PlanInfo;
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
  ): Promise<PlanInfo> {
    // The plan provider's own caller shape is the Enterprise licensing one and
    // the membership half may not name it, so the structural person the two
    // writes already carry is forwarded as it stands.
    return this.options.plans.getActivePlan({
      organizationId,
      ...(user ? { user } : {}),
    } as never);
  }

  private allowance(plan: PlanInfo, resource: "members" | "membersLite"): number {
    return resource === "members" ? plan.maxMembers : plan.maxMembersLite;
  }

  private seatsTaken(organizationId: string, resource: "members" | "membersLite"): Promise<number> {
    return resource === "members"
      ? this.options.memberships.getMemberCount(organizationId)
      : this.options.memberships.getMembersLiteCount(organizationId);
  }
}

/** Session revocation, over the Auth service this process already composed. */
class AuthServiceOrganizationSessionRevocation extends OrganizationSessionRevocationPort {
  static create(auth: AuthService): AuthServiceOrganizationSessionRevocation {
    return new AuthServiceOrganizationSessionRevocation(auth);
  }

  private constructor(private readonly auth: AuthService) {
    super();
  }

  async revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    await this.auth.revokeAllBrowserSessions(input);
  }
}

/** The authorization snapshot cache, over the grant ledger this process serves. */
class AuthzOrganizationGrantCache extends OrganizationGrantCachePort {
  static create(grants: AuthzGrantsService): AuthzOrganizationGrantCache {
    return new AuthzOrganizationGrantCache(grants);
  }

  private constructor(private readonly grants: AuthzGrantsService) {
    super();
  }

  async invalidateOrganization(input: { organizationId: string }): Promise<void> {
    await this.grants.invalidateOrganization(input);
  }
}

/**
 * The prompt-tag seeding a new organization gets, absent.
 */
class LoggedApiOrganizationPromptSeed extends OrganizationPromptSeedPort {
  static create(options: {
    processName: string;
    logger: Pick<Logger, "warn" | "error">;
  }): LoggedApiOrganizationPromptSeed {
    return new LoggedApiOrganizationPromptSeed(options.processName, options.logger);
  }

  private constructor(
    private readonly processName: string,
    private readonly logger: Pick<Logger, "warn" | "error">,
  ) {
    super();
  }

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
