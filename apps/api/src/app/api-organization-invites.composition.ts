/**
 * The invitation half of `organization.*`, composed on this process's own graph.
 *
 * It was an injected port with a refusing default, because the service lived in
 * the retired platform application and reached four verticals that had not
 * moved. All four have moved now, and each arrived as something this process
 * already holds:
 *
 *   the licence-enforcement counts   `@langwatch/entitlement-server`'s
 *                                    `PrismaUsageMembershipRepository` — the
 *                                    SAME reading the usage panel shows
 *   the plan provider                the one every allowance banner reads
 *   the role service                 the one `role.*` and `roleBinding.*` mount
 *   the mailer                       a PORT, still absent here, and honestly so
 *
 * `ApiOrganizationInvitePort` survives as the injection seam — a host that
 * composes its own invitation service still wins — but a process that injects
 * nothing now ANSWERS instead of refusing, on BOTH doors: the production
 * composition builds this once and hands the tRPC ports to the org-group half
 * and the three REST operations to `/api/organization`.
 *
 * ## The mail absence, and why it is not a refusal
 *
 * `OrganizationInviteMailPort` is left unfilled. Rendering a LangWatch message
 * is react-email, and `frontend-boundary.unit.test.ts` exists to stop a
 * value-import chain from a backend process to React — the same reason
 * `ApiIdentityMailPort` and `ApiPasswordResetMailPort` are ports rather than
 * calls into `@langwatch/mail`.
 *
 * Absent is a SUPPORTED state here rather than a degradation, and that is the
 * difference from the password-reset seam: an invitation is written either
 * way, it carries its accept URL in the listing, and the caller is told
 * `emailNotSent` so the screen can show the link to copy. That is byte for
 * byte what the platform application did on a deployment with no
 * `SENDGRID_API_KEY`. A reset that reports success and sends nothing leaves
 * somebody waiting on an inbox; an invitation that reports `emailNotSent`
 * leaves an administrator holding a link.
 */
import {
  buildInviteAcceptUrl,
  InviteService,
  InviteSendThrottleService,
  OrganizationInviteRateLimitPort,
  OrganizationInviteSeatCensusPort,
  maskInvitedAddress,
  matchInviteToAcceptor,
  type OrganizationInviteMailPort,
  type OrganizationRestInviteService,
  type OrganizationTrpcPorts,
} from "@langwatch/organization-server";
import {
  PrismaUsageMembershipRepository,
  isViewOnlyCustomRole,
} from "@langwatch/entitlement-server";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { PostgresIdentityEmailAdapter } from "@langwatch/identity-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RoleService } from "@langwatch/role-contract";
import type { ApiOrganizationInvitePort } from "./api-trpc-collaborators.org-group.composition";

/**
 * The seat census, over the SAME reading the usage panel shows.
 *
 * Two counts and the lite-seat rule from one vertical, so an administrator
 * refused a seat here and an administrator shown their usage there cannot be
 * told two different numbers about the same organization.
 */
class ApiInviteSeatCensus extends OrganizationInviteSeatCensusPort {
  constructor(private readonly memberships: PrismaUsageMembershipRepository) {
    super();
  }

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

/** The process's ONE fixed-window counter, as the invitation throttle spends it. */
class ApiInviteRateLimit extends OrganizationInviteRateLimitPort {
  constructor(
    private readonly consume: (
      input: Readonly<{ key: string; windowSeconds: number; max: number }>,
    ) => Promise<Readonly<{ allowed: boolean; resetAt: number }>>,
  ) {
    super();
  }

  limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>> {
    return this.consume(input);
  }
}

/**
 * The two join-request writes the invitation surface performs.
 *
 * A narrow shape rather than the whole `JoinRequestTrpcPorts`, because these
 * are the only two an invitation ever reaches, and a process that composes the
 * identity half can satisfy it without this file learning what else is on it.
 */
export interface ApiOrganizationInviteJoinRequests {
  resolveByInvitation(
    input: Readonly<{ userId: string; organizationId: string; inviteId: string }>,
  ): Promise<void>;
  withdrawOnInvitationAccepted(
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<void>;
}

/** The join-request ledger this deployment did not compose, refused by name. */
class ApiJoinRequestLedgerUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "This deployment has no join-request ledger.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiJoinRequestLedgerUnavailableError";
  }
}

/** The eleven procedures the invitation half answers, named once. */
type OrganizationInvitePortShape = Pick<
  OrganizationTrpcPorts<never>,
  | "createInvites"
  | "revokeInvite"
  | "assertInviteSendAllowed"
  | "resendInvite"
  | "listInvites"
  | "matchInviteToAcceptor"
  | "maskInvitedAddress"
  | "applyInvite"
  | "findLandingProjectSlug"
  | "resolveJoinRequestByInvitation"
  | "withdrawJoinRequestOnInvitationAccepted"
>;

export type ApiOrganizationInvitesOptions = Readonly<{
  /** The one guarded connection every invitation row is read and written on. */
  prisma: PrismaClient;
  /** The ledger an accepted invitation's grants are written through. */
  grants: AuthzGrantsService;
  /** Where custom-role assignability is defined, for both write and accept. */
  roles: RoleService;
  /** Which plan the organization is on, and therefore how many seats it holds. */
  plans: PlanProvider;
  /** The process's ONE fixed-window counter. */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  /** This deployment's public origin, for the accept link. */
  baseHost: string;
  /**
   * The join-request ledger, where the deployment composed one. It is the
   * identity half's, and the two procedures below are the only place the
   * invitation surface touches it.
   */
  joinRequests?: ApiOrganizationInviteJoinRequests | undefined;
  /** The mail gateway, where a host composed one. */
  mail?: OrganizationInviteMailPort | undefined;
}>;

/**
 * Composes the invitation service and the eleven ports `organization.*` reads
 * it through.
 *
 * The two pure ones — `matchInviteToAcceptor` and `maskInvitedAddress` — are
 * the service module's own functions rather than methods, so they answer here
 * with no service instance behind them.
 */
/**
 * The invitation half, as this process's two doors take it.
 *
 * ONE service behind both. The tRPC surface and the management REST family
 * administer the same invitations, and a second service would let the listing
 * one door returns disagree with what the other just created — including on
 * the acceptance link, which is minted from the deployment's base host and is
 * the only thing an administrator has to hand somebody when no mail gateway is
 * composed.
 */
export type ApiOrganizationInvites = Readonly<{
  /** The eleven ports `organization.*` reads the invitation half through. */
  trpc: ApiOrganizationInvitePort;
  /** The three operations `/api/organization`'s invitation routes make. */
  rest: OrganizationRestInviteService;
  /** The acceptance link, from the SAME base host the listing embeds. */
  buildInviteAcceptUrl(inviteCode: string): string;
}>;

export function composeApiOrganizationInvites(
  options: ApiOrganizationInvitesOptions,
): ApiOrganizationInvites {
  const throttle = new InviteSendThrottleService(new ApiInviteRateLimit(options.rateLimit));
  const invites = new InviteService({
    prisma: options.prisma,
    seats: new ApiInviteSeatCensus(PrismaUsageMembershipRepository.create(options.prisma)),
    plans: options.plans,
    grants: options.grants,
    roles: options.roles,
    throttle,
    baseHost: options.baseHost,
    ...(options.mail ? { mail: options.mail } : {}),
  });

  // The identity read fork, over the client this process already composed.
  // Not process-bound: it reads the `Identifier` projection and one
  // migration-state row, which is the reason `api-auth.composition.ts` builds
  // one of these for itself rather than being handed it.
  const identityEmails = PostgresIdentityEmailAdapter.create({
    database: options.prisma,
  }).build();
  const joinRequests = options.joinRequests;

  const ports: OrganizationInvitePortShape = {
    createInvites: (_ctx, input) =>
      invites.createInvites({
        organizationId: input.organizationId,
        invites: input.invites.map((invite) => ({
          email: invite.email,
          role: invite.role,
          ...(invite.teamIds === undefined ? {} : { teamIds: invite.teamIds }),
          ...(invite.teams === undefined ? {} : { teams: invite.teams }),
        })),
        // The invite form's rule: an invitation naming a team the caller may
        // not reach is dropped rather than refusing the whole batch, which is
        // what the tRPC surface has always done. `"strict"` belongs to the
        // provisioning API, where a tool given less than it asked for would
        // believe the grant took effect.
        validation: "lenient",
      }),
    revokeInvite: async (_ctx, input) => {
      await invites.revokeInvite(input);
    },
    assertInviteSendAllowed: (_ctx, input) => throttle.assertInviteSendAllowed(input),
    resendInvite: (_ctx, input) => invites.resendInvite(input),
    listInvites: (_ctx, input) => invites.listInvites(input),
    matchInviteToAcceptor: async (_ctx, input) => {
      // A user not yet on identifiers keeps the legacy case-insensitive
      // session-email comparison byte for byte, and `null` is what says so.
      const matchable = await identityEmails.tryVerifiedEmailsOf({ userId: input.userId });
      return matchInviteToAcceptor({
        inviteEmail: input.inviteEmail,
        sessionEmail: input.sessionEmail,
        matchable,
      });
    },
    maskInvitedAddress: (email) => maskInvitedAddress(email),
    applyInvite: (_ctx, input) =>
      invites.applyInvite({
        userId: input.userId,
        invite: input.invite,
        ...(input.viaIdentifierId === undefined ? {} : { viaIdentifierId: input.viaIdentifierId }),
      }),
    findLandingProjectSlug: (_ctx, input) => invites.findLandingProjectSlug(input.invite),
    // Both of these tidy a request the same person already made — an
    // invitation that ANSWERS one, and an acceptance that WITHDRAWS one — and
    // the transport wraps each in its own try/catch because the invitation and
    // the membership are the durable outcomes. Absent, they refuse BY NAME
    // rather than resolving: a silent resolve would leave the request open on
    // the admins' panel with nothing anywhere saying why.
    resolveJoinRequestByInvitation: (_ctx, input) =>
      joinRequests
        ? joinRequests.resolveByInvitation(input)
        : Promise.reject(new ApiJoinRequestLedgerUnavailableError()),
    withdrawJoinRequestOnInvitationAccepted: (_ctx, input) =>
      joinRequests
        ? joinRequests.withdrawOnInvitationAccepted(input)
        : Promise.reject(new ApiJoinRequestLedgerUnavailableError()),
  };

  return {
    trpc: { ports },
    // The service itself satisfies the REST family's three operations, which
    // is deliberate: the family asks for exactly what it uses, and narrowing
    // it here would be a second place for the shapes to drift apart.
    rest: invites,
    buildInviteAcceptUrl: (inviteCode) => buildInviteAcceptUrl(options.baseHost, inviteCode),
  };
}
