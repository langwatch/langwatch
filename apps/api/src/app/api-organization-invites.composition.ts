/**
 * The invitation half of `organization.*`, composed on this process's own graph. It was
 * an injected port with a refusing default, because the service lived in the retired
 * platform application and reached four verticals that had not moved.
 */
import {
  buildInviteAcceptUrl,
  InviteService,
  PrismaOrganizationInviteRepository,
  InviteSendThrottleService,
  OrganizationInviteRateLimitPort,
  OrganizationInviteSeatCensusPort,
  type OrganizationInviteMailPort,
  type OrganizationRestInviteService,
  type OrganizationTrpcPorts,
} from "@langwatch/organization-server";
import {
  MemberClassificationService,
  PrismaUsageMembershipRepository,
} from "@langwatch/entitlement-server";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { PostgresIdentityEmailAdapter } from "@langwatch/identity-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RoleService } from "@langwatch/role-contract";
import type { ApiOrganizationInvitePort } from "../features/organization/organization.composition";

/**
 * The seat census, over the SAME reading the usage panel shows.
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
    return MemberClassificationService.isViewOnlyCustomRole(permissions);
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
  | "tryFindLandingProjectSlug"
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
 * Composes the invitation service and the eleven ports `organization.*` reads it through.
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
  const throttle = InviteSendThrottleService.create(new ApiInviteRateLimit(options.rateLimit));
  const invites = InviteService.create({
    invites: PrismaOrganizationInviteRepository.create({ database: options.prisma }),
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
      return InviteService.matchInviteToAcceptor({
        inviteEmail: input.inviteEmail,
        sessionEmail: input.sessionEmail,
        matchable,
      });
    },
    maskInvitedAddress: (email) => InviteService.maskInvitedAddress(email),
    applyInvite: (_ctx, input) =>
      invites.applyInvite({
        userId: input.userId,
        invite: input.invite,
        ...(input.viaIdentifierId === undefined ? {} : { viaIdentifierId: input.viaIdentifierId }),
      }),
    tryFindLandingProjectSlug: (_ctx, input) => invites.tryFindLandingProjectSlug(input.invite),
    // Both of these tidy a request the same person already made — an invitation that
    // ANSWERS one, and an acceptance that WITHDRAWS one — and the transport wraps each in
    // its own try/catch because the invitation and the membership are the durable
    // outcomes. Absent, they refuse BY NAME rather than resolving: a silent resolve would
    // leave the request open on the admins' panel with nothing anywhere saying why.
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
