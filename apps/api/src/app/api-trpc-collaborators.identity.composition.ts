/**
 * The identity half of {@link ApiTrpcCollaborators}: everything the record
 * reaches that is about a PERSON — who they are, how they got in, which
 * organization they belong to and who else is looking at the project with them.
 *
 * Eight of the record's surfaces are served from this one composition, and they
 * are one composition because they are one graph:
 *
 *   frontDoor / publicEnv   the two signed-out doors (through {@link AuthApp})
 *   identity.*              the verification ceremony that spends a magic link
 *   user.*                  the signed-in person's own account
 *   apiKey.*                their credentials
 *   group.*                 SCIM-managed groups
 *   joinRequests.*          asking to join an organization, and answering
 *   onboarding.*            the sign-up ceremony's first organization
 *   presence.*              who else is in this project
 *
 * They share a spine that cannot be composed twice. The user directory the
 * Auth service resolves a browser session through is the SAME one `user.*`
 * reads an account off and the sign-up ceremony creates one in; the
 * organization service `group.*` lists groups from is the SAME one the
 * membership half writes seats to. So this module takes the already-composed
 * services rather than building any of them, and adds only what the record
 * needs on top: the membership half, the two applications, the join-request
 * orchestration, and the sign-up and verification ceremonies.
 *
 * ## The four deployment facts
 *
 * A person-shaped surface asks four questions this package cannot answer from
 * its own configuration: where the deployment lives (every mailed link is
 * built from it), which sign-in provider it mounted, whether it registered
 * passkeys, and who its operators are. They arrive as
 * {@link ApiIdentityDeploymentFacts} because they belong to the deployment, and
 * a process given none of them still composes — with the consequences each
 * absence below names, never a guess.
 *
 * ## What refuses by name, and why
 *
 * The capabilities that are Enterprise-licensed or belong to a vertical this
 * process does not compose are each a NAMED refusal rather than a value that
 * pretends:
 *
 *   - the SCIM plan gate, the standard AI-tool catalogue, the CLI-token
 *     revocation and the gateway's routing, key and budget reads are
 *     Enterprise;
 *   - an Auth0 password change needs tenant credentials this process holds
 *     none of;
 *   - the reissue request an expired invitation's landing page makes and the
 *     deployment's marketing notifications belong to tiers this half does not
 *     hold.
 *
 * The SEAT LICENCE is not among them any more. It is composed over the plan
 * provider this process shares with the invitation half and the membership
 * counts the usage panel is read from, so re-enabling a membership and
 * elevating a Lite Member are decided against the organization's own plan
 * rather than refused.
 *
 * Each raises an error naming the capability and the process, so a customer's
 * failure is traceable to a deployment shape rather than to their input. The
 * one deliberate exception is the marketing notifications, which are
 * fire-and-forget by construction: a sign-up that could not be announced still
 * created the organization, so those log once and return.
 */
import { compare, hash } from "bcrypt";
import { AdminAccessService } from "@langwatch/ops-server";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import { ApiKeyApp } from "@langwatch/api-key-server";
import { AuthApp, SignUpVerificationService } from "@langwatch/auth-server";
import {
  PrismaSignUpAccountDirectory,
  PrismaSignUpVerificationTokenStore,
} from "@langwatch/auth-server";
import type { AuthService } from "@langwatch/auth-contract";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { RoutingDecision } from "@langwatch/identity-contract";
import {
  EmailJoinRequestNotifier,
  IdentityEventingPort,
  JoinRequestNotificationMailPort,
  IdentityLedgerWriter,
  IdentityService,
  InProcessBreakGlassLimiter,
  JoinRequestGuards,
  JoinRequestLedgerWriter,
  JoinRequestService,
  JoinRequestsService,
  LegacySsoDomainRoutingRepository,
  PostgresIdentityEmailAdapter,
  PostgresIdentityGuardsAdapter,
  PrismaIdentityHeadsRepository,
  PrismaIdentityProjectionRepository,
  PrismaIdentityVerificationRepository,
  PrismaJoinCandidateRepository,
  PrismaJoinMembership,
  PrismaJoinRequestProjectionRepository,
  PrismaJoinRequestReadRepository,
  PrismaJoinSettings,
  SignInRouterService,
  SsoConnectionDomainRoutingRepository,
  VerificationCeremonyService,
  resolveFederatedMethod,
  signInMethodPolicyPortOver,
} from "@langwatch/identity-server";
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
} from "@langwatch/enterprise-plan-gate";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  PrismaUsageMembershipRepository,
  UsageMembershipPort,
  getRoleChangeType,
  type RoleChangeType,
} from "@langwatch/entitlement-server";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  InviteExpiredError,
  InviteNotFoundError,
  OrganizationApp,
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
  PostgresOrganizationMembershipAdapter,
  isCustomRole,
  resolveInviteDisplayStatus,
  type GroupTrpcPorts,
  type JoinRequestTrpcPorts,
  type OnboardingTrpcPorts,
  type OrganizationPlanUser,
  type OrganizationProvisioningPort,
  type OrganizationRestService,
  type OrganizationSeatDecision,
} from "@langwatch/organization-server";
import type { PresenceService } from "@langwatch/presence-contract";
import {
  BroadcastService,
  PresenceBroadcastPort,
  PresenceDiagnosticsPort,
  PresenceEmitterPort,
  RuntimePresenceAdapter,
} from "@langwatch/presence-server";
import type { OrganizationUserRole, PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { UserService } from "@langwatch/user-contract";
import {
  PostgresUserCredentialAdapter,
  UserApp,
  UserPasswordHasherPort,
  type IdentityTrpcPorts,
  type UserTrpcPorts,
} from "@langwatch/user-server";
import { z } from "zod";
import type { ApiTrpcFeatureApplication } from "../app-trpc/app-trpc.context";

/**
 * What the deployment answers so a person-shaped surface can be served.
 *
 * Four values, none of them this package's. Every one is optional and every
 * absence has a stated consequence rather than a default that pretends to be
 * one.
 */
export type ApiIdentityDeploymentFacts = Readonly<{
  /**
   * The public base URL every mailed link is built from — the confirmation
   * link, the members page an admin is pointed at, the budgets page.
   *
   * Without it this process sends no mail that carries a link: a confirmation
   * mail with a link to nowhere is worse than a refusal, because the person
   * clicks it and lands on the wrong host with a token they have now spent.
   */
  baseUrl?: string | undefined;
  /**
   * `"email"`, or the federated provider id this deployment mounted.
   *
   * ADR-027's single source of truth. Absent means email mode, which is what a
   * process holding no licence gate offers — the licence is what would have
   * unlocked a federated door, and this process composes none.
   */
  authProvider?: string | undefined;
  /** Whether the deployment registered the passkey plugin at boot. */
  passkeysEnabled?: boolean | undefined;
  /** Whether this is the hosted product rather than a self-hosted install. */
  isSaas?: boolean | undefined;
  /**
   * The addresses that see the operator entry in the sidebar and pass
   * `ops.isAdmin`. A comma-separated string, exactly as the deployment
   * configures it.
   */
  adminEmails?: string | readonly string[] | undefined;
}>;

/**
 * Every message this half sends, as it asks for one.
 *
 * A PORT rather than the mail gateway itself, and that is the load-bearing
 * part: rendering a LangWatch message is react-email, and a value-import chain
 * from a backend process to React is what
 * `frontend-boundary.unit.test.ts` exists to stop. So the process states what
 * it wants said, to whom, with the links already built, and the tier that owns
 * the gateway renders it.
 *
 * `@langwatch/mail` holds the templates each of these renders.
 */
export abstract class ApiIdentityMailPort extends JoinRequestNotificationMailPort {
  /** The sign-up confirmation link. Asking twice sends twice. */
  abstract sendSignUpVerificationLink(input: {
    email: string;
    verificationUrl: string;
  }): Promise<unknown>;

  /** A member asking their administrator for more budget. */
  abstract sendBudgetIncreaseRequest(input: {
    to: string;
    requesterEmail: string;
    requesterName?: string;
    organizationName: string;
    budgetsUrl: string;
    scope: string;
    scopeId: string;
    limitUsd: string;
    spentUsd: string;
    period?: string;
    message?: string;
  }): Promise<unknown>;
}

/** Everything the identity half is composed from. */
export type ApiIdentityCollaboratorsOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The same organization service the REST doors and the AuthZ graph serve from. */
  organizations: OrganizationService;
  /** The same project service the tenancy graph composed. */
  projects: ProjectService;
  /** The same API-key service the credential doors authenticate through. */
  apiKeys: ApiKeyService;
  /** The grant ledger every membership write states its access on. */
  grants: AuthzGrantsService;
  /**
   * Which plan the organization is on, and therefore how many seats it holds.
   *
   * The SAME provider the invitation half counts a seat against and every
   * allowance banner reads: a seat this half refuses and a seat that half
   * grants must be one number, or an organization can be invited into a seat
   * it cannot re-enable a membership into.
   */
  plans: Pick<PlanProvider, "getActivePlan">;
  /**
   * The user directory and the Auth service, as the browser-session boundary
   * already composed them. Taken rather than built: a second directory is a
   * second answer to "who is this person".
   */
  users: UserService;
  auth: AuthService;
  /** The process's Redis, where it has one. Presence and the broadcast fan-out use it. */
  redis: RedisConnection | null;
  /** The shared counter the throttles meter through. */
  rateLimit: (input: {
    key: string;
    windowSeconds: number;
    max: number;
  }) => Promise<{ allowed: boolean; resetAt: number }>;
  /** The event stack the two identity ledgers append and stage through. */
  eventing: IdentityEventingPort;
  /** The deployment's own answers; see {@link ApiIdentityDeploymentFacts}. */
  deployment: ApiIdentityDeploymentFacts;
  /** The messages this half sends, where the deployment composed a gateway. */
  mail?: ApiIdentityMailPort | undefined;
  /**
   * The process's shutdown scope.
   *
   * The broadcast fabric duplicates the Redis connection for its subscriber
   * and holds an interval that reaps idle tenant emitters, so it is owned here
   * rather than left to the garbage collector — a drain that left the
   * subscriber open would keep the process alive past its deadline.
   */
  resources: { own(name: string, close: () => Promise<void>): void };
  /** Names this process in every refusal below. */
  processName: string;
}>;

/**
 * The identity half, as `composeApiTrpcCollaborators`
 * (`api-trpc-features.composition.ts`) reads it into the flat record.
 *
 * The application slices are separate from the port groups for the same reason
 * the analytics half separates them: a request carries ONE application, so the
 * slices are merged into whatever the rest of the process composed rather than
 * replacing it.
 */
export type ApiIdentityCollaborators = Readonly<{
  /**
   * The organization object the MANAGEMENT REST family serves from: the
   * canonical contract's settings reads and writes, plus the membership
   * operations the contract does not declare, routed onto one object.
   */
  organizationRest: OrganizationRestService;
  /**
   * The same object again, in the shape `/api/organizations` takes.
   *
   * Published rather than rebuilt: instance provisioning creates the tenant
   * the management family then administers, and two objects over those rows
   * would let a freshly provisioned organization be missing from the listing
   * that is supposed to enumerate exactly them.
   */
  organizationProvisioning: OrganizationService & OrganizationProvisioningPort;
  /**
   * The tenant fan-out this half composed, published so a REST family can
   * broadcast on it too.
   *
   * The SAME fabric `ctx.app.broadcast` publishes on and the subscription lane
   * reads: a second one would put a download's progress on a channel no
   * browser is listening to.
   */
  broadcast: BroadcastService;
  /** The six `ctx.app` slices this half owns. */
  application: Pick<
    ApiTrpcFeatureApplication,
    "apiKeys" | "broadcast" | "config" | "ops" | "organizations" | "presence" | "users"
  >;
  /** The `auth` entry: both signed-out doors answer from it. */
  auth: AuthApp;
  /** The `group` entry. */
  group: GroupTrpcPorts;
  /** The `identity` entry. */
  identity: IdentityTrpcPorts;
  /** The `joinRequests` entry, minus the user-name read the process owns. */
  joinRequests: Omit<JoinRequestTrpcPorts, "listUserNames">;
  /** The `onboarding` entry. */
  onboarding: OnboardingTrpcPorts<typeof signUpDataSchema>;
  /** The `user` entry, minus the account rows the process reads itself. */
  user: Omit<UserTrpcPorts, ApiOwnedUserPorts>;
}>;

/**
 * The `user.*` ports `createApiTrpcPorts` answers from this process's own
 * connection, and which therefore must NOT appear here — see that module's
 * `ApiOwnedUserPorts`, of which this is the twin.
 */
type ApiOwnedUserPorts =
  | "emailIsTaken"
  | "isOrganizationMember"
  | "tryGetOrganizationName"
  | "tryGetUserContact"
  | "tryFindFirstProjectSlug";

/**
 * The questionnaire the sign-up form collects, as the ceremony forwards it.
 *
 * Opaque to the organization package on purpose — the shape is the
 * deployment's — so the schema is declared where the process that reads the
 * answers lives. Passthrough rather than a closed object: a deployment that
 * adds a field to its own form must not have the ceremony drop it.
 */
export const signUpDataSchema = z.object({}).passthrough();

/** The bcrypt cost every stored credential in this database was written at. */
const PASSWORD_HASH_COST = 10;

/**
 * The stored password format, stated ONCE for this process.
 *
 * bcrypt at cost 10, which is what every credential row in the database
 * already carries. The cost is spelled here rather than taken from
 * configuration on purpose — it is part of the stored format, and a process
 * that hashed at a different cost would write rows the other tier's
 * verification still reads but whose cost nobody can account for.
 *
 * A port implementation rather than two loose closures because the comparison
 * has one caller now: `UserCredentialService`, which is the only code in the
 * deployment that ever holds a stored hash. `hashPassword` stays on the port
 * bag beside it for the two calls that mint a FIRST password — sign-up and
 * `setPassword` — where there is nothing to compare against.
 */
class BcryptPasswordHasher extends UserPasswordHasherPort {
  hash({ password }: { password: string }): Promise<string> {
    return hash(password, PASSWORD_HASH_COST);
  }

  matches({ password, hash: stored }: { password: string; hash: string }): Promise<boolean> {
    return compare(password, stored);
  }
}

/**
 * A capability this deployment does not hold.
 *
 * A plain `HandledError` with one code rather than a class per capability: the
 * caller's action is the same in every case — this process cannot do it, ask
 * the tier that can — and the message names which capability and which process,
 * so a support conversation starts from the deployment shape rather than from a
 * stack trace. `fault: "platform"` because nothing the customer sent caused it.
 */
class ApiCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(input: { capability: string; processName: string }) {
    super("service_unavailable", `${input.processName} composes no ${input.capability}.`, {
      httpStatus: 503,
      fault: "platform",
      meta: { capability: input.capability },
    });
    this.name = "ApiCapabilityUnavailableError";
  }
}

/**
 * The seat licence, over the SAME plan provider and the SAME membership counts
 * every other allowance in this process reads.
 *
 * It was a refusal, and the refusal was safe but wrong: this root already makes
 * both halves of the decision under other names — `ApiInviteSeatCensus`
 * compares an invitation against `maxMembers` / `maxMembersLite`, and the org
 * group's `assertCustomRolesAllowed` gates a role change on the plan type — so
 * a member could be invited into a seat the same organization could not
 * re-enable a membership into.
 *
 * The two decisions, and the rules they keep from the platform application byte
 * for byte:
 *
 *   checkLimit               `allowed` is `current < max` on the plan's own
 *                            allowance, and a plan carrying
 *                            `overrideAddingLimitations` — the unlimited
 *                            self-hosted tier — is allowed without a count.
 *                            It ANSWERS rather than throwing: the caller turns
 *                            it into `member_seat_limit_reached` carrying the
 *                            counts, and only the caller knows which write it
 *                            was about to make.
 *   assertRoleChangeAllowed  the seat classification first — a Lite Member
 *                            gaining non-view permissions re-checks the FULL
 *                            member seats, and a full member dropping to lite
 *                            re-checks the LITE ones — then the Enterprise
 *                            requirement that a custom-role assignment
 *                            implies. Both forms of that assignment count: a
 *                            `custom:{roleId}` role string, and a built-in role
 *                            string carrying a `customRoleId`, which the
 *                            cascade persists as a custom binding just the
 *                            same.
 *
 * A seat refusal is a `LimitExceededError` — `resource_limit_exceeded`,
 * carrying the allowance in its `meta` — which is the shape every other member
 * limit in the product raises, so the client's limit modal keeps opening off
 * one answer.
 *
 * What is NOT here: the ops notification the platform fired beside each
 * refusal. It reached a Slack channel through a vertical this process does not
 * compose, and a notification nobody receives must not be able to fail a seat
 * decision.
 */
class ApiOrganizationSeatLicense extends OrganizationSeatLicensePort {
  static create(options: {
    plans: Pick<PlanProvider, "getActivePlan">;
    memberships: UsageMembershipPort;
  }): ApiOrganizationSeatLicense {
    return new ApiOrganizationSeatLicense(options);
  }

  private constructor(
    private readonly options: {
      plans: Pick<PlanProvider, "getActivePlan">;
      memberships: UsageMembershipPort;
    },
  ) {
    super();
  }

  async checkLimit(input: {
    organizationId: string;
    resource: "members" | "membersLite";
    user?: OrganizationPlanUser | undefined;
  }): Promise<OrganizationSeatDecision> {
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
    const change = getRoleChangeType(
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

  private seatsTaken(
    organizationId: string,
    resource: "members" | "membersLite",
  ): Promise<number> {
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
 *
 * Non-fatal in one direction and fatal in the other, which is why it is not a
 * refusal: sign-up creates the organization first and seeds afterwards, so
 * refusing here would cost a person the organization they just made over a
 * catalogue of tags. It is logged instead, once, naming the organization —
 * the tags are a starting point a person can add for themselves, and the
 * compensation path a provisioning run needs is reported the same way.
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

/** The presence publisher, over the process's broadcast fabric. */
class ApiPresenceBroadcast extends PresenceBroadcastPort {
  static create(broadcast: BroadcastService): ApiPresenceBroadcast {
    return new ApiPresenceBroadcast(broadcast);
  }

  private constructor(private readonly broadcast: BroadcastService) {
    super();
  }

  async publish(input: {
    projectId: string;
    event: string;
    channel: "presence_updated" | "presence_cursor";
    rateLimited: boolean;
  }): Promise<void> {
    if (input.rateLimited) {
      await this.broadcast.broadcastToTenantRateLimited(
        input.projectId,
        input.event,
        input.channel,
        "delta",
      );
      return;
    }
    await this.broadcast.broadcastToTenant(input.projectId, input.event, input.channel);
  }
}

/** Presence diagnostics on this process's structured logger. */
class ApiPresenceDiagnostics extends PresenceDiagnosticsPort {
  static create(logger: Pick<Logger, "warn">): ApiPresenceDiagnostics {
    return new ApiPresenceDiagnostics(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  warn(message: string, context: Record<string, unknown>): void {
    this.logger.warn(context, message);
  }
}

/**
 * Composes the identity half.
 *
 * Always succeeds. Every capability it cannot hold is a named refusal on the
 * surface that needs it rather than a reason the whole record goes missing —
 * the opposite of the analytics half's ClickHouse, whose absence still leaves
 * every namespace mounted, and for the same reason: a person who cannot sign in
 * because a namespace vanished has no way to discover why.
 */
export function composeApiIdentityCollaborators(
  options: ApiIdentityCollaboratorsOptions,
): ApiIdentityCollaborators {
  const {
    prisma,
    organizations,
    projects,
    apiKeys,
    grants,
    plans,
    users,
    auth,
    redis,
    rateLimit,
    eventing,
    deployment,
    mail,
    resources,
    processName,
  } = options;

  const logger = createLogger("langwatch:api:identity");
  const unavailable = (capability: string) =>
    new ApiCapabilityUnavailableError({ capability, processName });

  // -- the credential half of the /settings/authentication screens -----------
  //
  // The stored-password format, and the user feature's own reader over the
  // rows it is stored on. Composed here, beside the two sign-in ceremonies,
  // because this half already states the format every credential row in the
  // database was written at; composed AT ALL because the four answers it
  // serves used to be `prisma.account` statements written in the API's tRPC
  // ports composition, one of them selecting the hash itself.
  const passwords = new BcryptPasswordHasher();
  const credentials = PostgresUserCredentialAdapter.create({
    database: prisma,
    passwords,
  }).build();

  // -- the membership half, and the organization application over it ---------

  const membership = PostgresOrganizationMembershipAdapter.create({
    database: prisma,
    grants,
    prompts: LoggedApiOrganizationPromptSeed.create({ processName, logger }),
    // The seat gate, over the SAME counts the usage panel shows and the SAME
    // plan the invitation half spends a seat against: an administrator refused
    // here and an administrator shown their usage there cannot be told two
    // different numbers about one organization.
    seats: ApiOrganizationSeatLicense.create({
      plans,
      memberships: PrismaUsageMembershipRepository.create(prisma),
    }),
    sessions: AuthServiceOrganizationSessionRevocation.create(auth),
    grantCache: AuthzOrganizationGrantCache.create(grants),
  }).build();

  /**
   * One organization object, two owners.
   *
   * `OrganizationApp` reads a single `organizations` dependency that is the
   * canonical contract AND the fourteen membership operations the contract does
   * not declare. Which half owns an operation is a fact about the contract
   * rather than about this process, so it is stated once here as a name list
   * and routed rather than restated as forty delegating methods — a list that
   * drifts fails the typecheck, and forty methods that drift do not.
   */
  const MEMBERSHIP_OPERATIONS = new Set<string>([
    "createAndAssign",
    "deleteMember",
    "setMemberDisabled",
    "getAllForUser",
    "getOrganizationWithMembers",
    "getMemberById",
    "getAllMembers",
    "getUserOrgRoleByTeamId",
    "getPrimaryIntent",
    "updateTeamMemberRole",
    "changeMemberRole",
    "getAuditLogs",
    // The paged listing and the single-member read the MANAGEMENT REST family
    // asks for. On this list for the same reason as the twelve above: the
    // canonical contract declares neither, so routing them here is what makes
    // one object answer both halves rather than two objects answering one
    // question each.
    "listMembers",
    "getMember",
    // The four INSTANCE-PROVISIONING operations `/api/organizations` performs.
    // Same reason again: the canonical contract does not declare them because
    // they run before any credential for the organization exists, so the door
    // that creates a tenant and the screens that administer it afterwards must
    // resolve through one object or a provisioned organization would be
    // invisible to the second.
    "createForProvisioning",
    "listProvisioningSummaries",
    "getProvisioningSummary",
    "deleteProvisionedOrganization",
  ]);

  const organizationsForApp = new Proxy(organizations, {
    get(target, property, receiver) {
      if (typeof property === "string" && MEMBERSHIP_OPERATIONS.has(property)) {
        const operation = (membership as unknown as Record<string, unknown>)[property];
        return typeof operation === "function" ? operation.bind(membership) : operation;
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Parameters<typeof OrganizationApp.create>[0]["organizations"];

  const organizationApp = OrganizationApp.create({
    organizations: organizationsForApp,
    projects,
  });

  // -- the two applications the /me and credential screens read -------------

  const adminAccess = AdminAccessService.create({
    adminEmails: deployment.adminEmails ?? [],
  });

  const userApp = UserApp.create({
    users,
    auth,
    ops: adminAccess,
    organizations,
  });

  // -- presence, and the fabric it publishes on -----------------------------

  const broadcast = new BroadcastService(redis ?? null);
  resources.own("API presence broadcast", () => broadcast.close());
  const presence: PresenceService = RuntimePresenceAdapter.create({
    redis,
    broadcast: ApiPresenceBroadcast.create(broadcast),
    projects,
    diagnostics: ApiPresenceDiagnostics.create(logger),
  }).build();

  // -- the sign-in ceremony -------------------------------------------------

  /**
   * ADR-027's single source of truth for this process.
   *
   * A deployment that named a provider gets it; one that did not gets email
   * mode. There is no licence gate here to deny SSO, which is exactly why an
   * unnamed provider must not be guessed at: reporting a federated mode the
   * process cannot serve would send a person to a door that does not open.
   */
  const resolveAuthProvider = () => Promise.resolve(deployment.authProvider ?? "email");

  const signInRouter = new SignInRouterService({
    // The projection-backed lookup when the deployment named a provider, the
    // legacy string columns otherwise. Both answer "which connection routes
    // this domain"; `configured` is whether THIS deployment mounted the method
    // the connection names, which is the fact only the deployment holds.
    domains: deployment.authProvider
      ? new SsoConnectionDomainRoutingRepository(
          prisma,
          async (methodId) =>
            (await resolveFederatedMethod(resolveAuthProvider))?.id === methodId,
        )
      : new LegacySsoDomainRoutingRepository(prisma, () =>
          resolveFederatedMethod(resolveAuthProvider),
        ),
    policy: signInMethodPolicyPortOver({
      resolveAuthProvider,
      // No licence gate on this process, so federation is not licensed. The
      // policy reads that the way ADR-027 always did: email mode, no federated
      // method in the default set, and none reachable from a routing decision.
      federationLicensed: () => Promise.resolve(false),
      offersPasskeys: () => deployment.passkeysEnabled === true,
      selfHosted: () => deployment.isSaas !== true,
    }),
    breakGlass: new InProcessBreakGlassLimiter(),
  });

  // -- the sign-up ceremony -------------------------------------------------

  const signUpVerification = mail
    ? new SignUpVerificationService({
        tokens: new PrismaSignUpVerificationTokenStore(prisma),
        directory: new PrismaSignUpAccountDirectory(prisma),
        mailer: {
          sendVerificationLink: async ({
            email,
            verificationUrl,
          }: {
            email: string;
            verificationUrl: string;
          }) => {
            await mail.sendSignUpVerificationLink({ email, verificationUrl });
          },
        },
        accounts: {
          // Nobody has been asked for a name on this path: the person typed an
          // address and a password into a log-in form. Onboarding asks.
          createCredentialAccount: async ({
            email,
            passwordHash,
          }: {
            email: string;
            passwordHash: string;
          }) => {
            await users.createCredentialUser({ name: null, email, passwordHash });
          },
          markAddressConfirmed: async ({ email }: { email: string }) => {
            // Case-insensitive for the same reason the lookup beside it is:
            // rows written before sign-up lowercased addresses may carry
            // capitals, and an exact match would quietly confirm nothing.
            await prisma.user.updateMany({
              where: { email: { equals: email, mode: "insensitive" } },
              data: { emailVerified: true },
            });
          },
        },
        buildVerificationUrl: ({ token }) =>
          `${deployment.baseUrl ?? ""}/auth/signup?verify=${encodeURIComponent(token)}`,
      })
    : undefined;

  /**
   * The ceremony, or the refusal that names why there is none.
   *
   * Both halves of it are absent together and that is not an accident: without
   * a base URL a confirmation link points at nowhere, and without a mail
   * gateway it is never sent. Either way the person cannot finish, so the door
   * says so instead of accepting an address it will never write back to.
   */
  const requireSignUpVerification = (): SignUpVerificationService => {
    if (!signUpVerification || !deployment.baseUrl) {
      throw unavailable(
        "mail gateway with a public base URL, so it cannot send a sign-up confirmation link",
      );
    }
    return signUpVerification;
  };

  // -- the identity ledger, and the ceremony that spends a magic link -------

  const heads = PrismaIdentityHeadsRepository.create(prisma);
  const guards = PostgresIdentityGuardsAdapter.create({ database: prisma }).build();
  const identityEmails = PostgresIdentityEmailAdapter.create({ database: prisma }).build();

  const verificationCeremony = new VerificationCeremonyService(
    new PrismaIdentityVerificationRepository(prisma),
    heads,
    new IdentityService(
      guards.identityGuards,
      new IdentityLedgerWriter({
        // The SAME address lock the guards claim through (ADR-116 §6): the
        // guards claim before stating a fact and the fold releases once no
        // live identifier of that user carries the value, so a second lock
        // instance here would release something this process never claimed.
        projectionStore: new PrismaIdentityProjectionRepository(prisma, guards.reservations),
        eventing,
      }),
    ),
    // The per-user fork, as this process reads it: the identifier projection
    // IS the answer here, because the process composes no legacy branch to
    // fall back to.
    { isLatched: () => Promise.resolve(true) },
  );

  // -- join requests --------------------------------------------------------

  const joinRequestService = () =>
    new JoinRequestService(
      new JoinRequestGuards({ requests: new PrismaJoinRequestReadRepository(prisma) }),
      new JoinRequestLedgerWriter({
        projectionStore: new PrismaJoinRequestProjectionRepository(prisma),
        eventing,
      }),
    );

  const joinRequests = new JoinRequestsService({
    requests: joinRequestService(),
    reads: new PrismaJoinRequestReadRepository(prisma),
    candidates: new PrismaJoinCandidateRepository(prisma),
    membership: new PrismaJoinMembership(prisma, grants),
    notifier: mail
      ? new EmailJoinRequestNotifier(prisma, mail)
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
    settings: new PrismaJoinSettings(prisma),
    // The licence asymmetry, stated once: the gate that has always held single
    // sign-on holds AUTOMATIC joining, because that is federation. This process
    // holds no licence gate, so automatic joining is denied and ASKING is not —
    // which is exactly the shape that keeps "my company is invisible" fixed on
    // the deployments that have no other way out.
    autoJoinLicensed: () => Promise.resolve(false),
    // No feature-flag service on this half, and the flag is a rollout control
    // rather than an entitlement: the surface is mounted, so it is on.
    enabled: () => Promise.resolve(true),
    rateLimit,
  });

  function notifyNothing(what: string): void {
    logger.warn(
      { processName },
      `${processName} composes no mail gateway, so nobody was told that ${what}.`,
    );
  }

  /**
   * The caller's own verified address, and the reason every requester-side
   * join-request procedure starts here.
   *
   * `tryVerifiedEmailsOf` answers `null` for a user who is not on identifiers
   * yet, which is the legacy fallback the rest of the identity surface uses:
   * the `User.email` column, but only where it is marked verified. An
   * unverified address answers null, and every caller treats that as the
   * universal nothing.
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

  return {
    // The SAME merged object `OrganizationApp` reads, published so the
    // management REST family serves from it too. A second service over the
    // same rows would let `/api/organization/members` and the members screen
    // disagree about who is in an organization.
    organizationRest: organizationsForApp as unknown as OrganizationRestService,
    organizationProvisioning: organizationsForApp as unknown as OrganizationService &
      OrganizationProvisioningPort,
    broadcast,

    application: {
      apiKeys: ApiKeyApp.create({ apiKeys }),
      broadcast: broadcast as unknown as PresenceEmitterPort,
      config: { opsSidebarEmails: AdminAccessService.parseEmails(deployment.adminEmails ?? []) },
      ops: adminAccess as unknown as ApiTrpcFeatureApplication["ops"],
      organizations: organizationApp,
      presence,
      users: userApp,
    },

    auth: AuthApp.create({
      // The front door is unauthenticated, so the caller's address is the only
      // thing the throttle can key on — and this process reads it from the
      // request the transport already resolved rather than from a header a
      // client controls.
      clientIp: (ctx: unknown) =>
        (ctx as { clientIp?: () => string }).clientIp?.() ?? "unknown",
      rateLimit: async (input) => ({ allowed: (await rateLimit(input)).allowed }),
      route: (input): Promise<RoutingDecision> => signInRouter.route(input),
      addressIsRegistered: (_ctx, input) => requireSignUpVerification().addressIsRegistered(input),
      requestSignUpVerification: (_ctx, input) =>
        requireSignUpVerification().requestVerification(input),
      completeSignUpVerification: (_ctx, input) =>
        requireSignUpVerification().completeVerification(input),

      /**
       * A revoked invitation reads exactly like a missing one: the journey ends
       * quietly, revealing nothing about the organization or the inviter.
       * Expired is different — it is recoverable in one click by the inviter —
       * so it gets its own named refusal.
       */
      readInviteLanding: async (_ctx, { inviteCode }) => {
        const invite = await prisma.organizationInvite.findUnique({
          where: { inviteCode },
          select: {
            status: true,
            expiration: true,
            organization: { select: { name: true } },
            requestedByUser: { select: { name: true } },
          },
        });

        if (!invite || invite.status === "REVOKED") {
          throw new InviteNotFoundError("Invitation not found");
        }

        const status = resolveInviteDisplayStatus(invite);
        if (status === "EXPIRED") throw new InviteExpiredError();

        return {
          organizationName: invite.organization.name,
          inviterName: invite.requestedByUser?.name ?? null,
          alreadyAccepted: status === "ACCEPTED",
        };
      },

      /**
       * Asking an organization's admins to reissue a stale invitation goes
       * through the invitation service, which owns the throttle that stops one
       * stale code from mailing an organization repeatedly. This process
       * composes none, so it refuses by name rather than mailing unthrottled.
       */
      requestFreshInvite: () =>
        Promise.reject(
          unavailable(
            "invitation service, so it cannot ask this organization's admins to reissue the invitation",
          ),
        ),

      resolveAuthProvider,
    }),

    group: {
      /**
       * Groups arrive with SCIM, which is an Enterprise capability read per
       * organization out of a billing store this process does not hold. It
       * refuses rather than permitting: permitting would let a deployment
       * outside the plan write group bindings that the plan's own tier would
       * have refused.
       */
      assertScimAllowed: () =>
        Promise.reject(
          unavailable("Enterprise plan store, so it cannot confirm this organization carries SCIM"),
        ),
    },

    identity: {
      completeEmailVerification: (input) => verificationCeremony.completeEmailVerification(input),
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
          unavailable("Enterprise governance service, so it seeded no standard AI tool catalogue"),
        ),
      ensurePersonalWorkspace: (_ctx, input) => userApp.ensurePersonalWorkspace(input),
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

    user: {
      resolveAuthProvider,
      deploymentOffersPasskeys: () => deployment.passkeysEnabled === true,
      appBaseUrl: () => deployment.baseUrl ?? null,
      clientIp: (ctx: unknown) =>
        (ctx as { clientIp?: () => string }).clientIp?.() ?? "unknown",
      rateLimit: async (input) => ({ allowed: (await rateLimit(input)).allowed }),
      // The product-analytics sink is the deployment's. Absent, and silent on
      // purpose: an analytics write has never been allowed to fail a request.
      trackServerEvent: () => undefined,

      /**
       * The FIRST password a sign-up or `setPassword` writes. There is nothing
       * to compare against on either path, so this is a mint rather than a
       * rotation — {@link BcryptPasswordHasher} is the same format either way.
       */
      hashPassword: ({ password }: { password: string }) => passwords.hash({ password }),

      /**
       * The four account-row answers, through the user feature's own
       * persistence.
       *
       * They were `prisma.account` statements in
       * `api-trpc-ports.composition.ts` — including a `select` naming
       * `password`, the bcrypt hash a credential sign-in is checked against.
       * Nothing leaked, but the read was written where no rule about that
       * column applies: `prisma-containment` governs which modules may NAME
       * the client, and a composition that already holds one walks past it.
       *
       * `rotatePassword` is the shape that closes it. Verification and
       * replacement are one call on `UserCredentialService`, so the hash it
       * reads is compared and discarded inside that service and no port above
       * it is ever handed one.
       */
      rotatePassword: (
        _ctx: unknown,
        input: Readonly<{ userId: string; currentPassword: string; newPassword: string }>,
      ) => credentials.rotatePassword(input),

      tryFindAuth0DatabaseAccount: (_ctx: unknown, input: Readonly<{ userId: string }>) =>
        credentials.tryFindAuth0DatabaseAccount(input),

      listLinkedAccounts: (_ctx: unknown, input: Readonly<{ userId: string }>) =>
        credentials.listLinkedAccounts(input),

      unlinkAccount: (_ctx: unknown, input: Readonly<{ userId: string; accountId: string }>) =>
        credentials.unlinkAccount(input),

      /**
       * The Auth0 tenant is the deployment's own, and changing a password in it
       * is an API call against credentials this process does not hold.
       */
      changeAuth0Password: () =>
        Promise.reject(
          unavailable("Auth0 tenant credentials, so it cannot change an Auth0 password"),
        ),

      /**
       * CLI tokens are an Enterprise governance capability. It refuses rather
       * than returning: a deactivation that silently left the person's CLI
       * credentials live would be the failure this call exists to prevent.
       */
      revokeCliTokensForUser: () =>
        Promise.reject(
          unavailable("Enterprise governance service, so it cannot revoke this user's CLI tokens"),
        ),

      tryResolveSupportContact: async (_ctx, { organizationId }) => {
        const settings = await organizations.getSettings({ organizationId });
        if (settings.supportContact) return settings.supportContact;
        return await firstAdminEmail(prisma, organizationId);
      },

      resolveBudgetIncreaseRecipient: async (_ctx, { organizationId }) => {
        const adminEmail = await firstAdminEmail(prisma, organizationId);
        if (!adminEmail) {
          logger.warn(
            { organizationId },
            "budget increase requested but the organization has no admin",
          );
          throw unavailable("administrator for this organization to send the request to");
        }
        return adminEmail;
      },

      sendBudgetIncreaseRequest: async (_ctx, input) => {
        if (!mail || !deployment.baseUrl) {
          throw unavailable(
            "mail gateway with a public base URL, so it cannot send the budget increase request",
          );
        }
        await mail.sendBudgetIncreaseRequest({
          ...input,
          budgetsUrl: `${deployment.baseUrl.replace(/\/$/, "")}/gateway/budgets`,
        });
      },

      // The gateway's own stores. All three are Enterprise, and all three
      // refuse rather than answering: a budget pre-check that answered
      // "allowed" without a store would let spend through unmetered.
      tryResolveDefaultRoutingPolicy: () =>
        Promise.reject(
          unavailable("Enterprise gateway governance, so it holds no default routing policy"),
        ),
      listPersonalVirtualKeys: () =>
        Promise.reject(
          unavailable("Enterprise gateway governance, so it holds no personal gateway keys"),
        ),
      checkBudget: () =>
        Promise.reject(unavailable("Enterprise gateway budget store, so it cannot check a budget")),
    },
  };
}

/**
 * The organization's first administrator, by seat age.
 *
 * A row read with the organization id already in hand, which is why it lives
 * here beside the other reads this process answers from its own connection
 * rather than behind a port.
 */
async function firstAdminEmail(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string | null> {
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN", disabledAt: null },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true } } },
  });
  return admin?.user.email ?? null;
}

