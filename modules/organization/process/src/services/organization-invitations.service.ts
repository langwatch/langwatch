import { HandledError } from "@langwatch/handled-error";
import type { IdentityApi } from "@langwatch/identity-contract";
import type {
  LimitType,
  OrganizationInvite,
  OrganizationInviteValidation,
  OrganizationListedInvite,
  OrganizationPendingInviteApplied,
  OrganizationUserRole,
} from "@langwatch/organization-contract";

import type { OrganizationInviteRepository } from "../repositories/organization-invite.repository.ts";
import type { OrganizationUserDirectoryRepository } from "../repositories/organization-user-directory.repository.ts";
import { resolveInviteDisplayStatus } from "../rules/invite-display-status.rules.ts";
import { buildInviteAcceptUrl } from "../rules/invite-link.rules.ts";
import type { InviteSendThrottleService } from "./invite-send-throttle.service.ts";
import { InviteService } from "./invite.service.ts";
import type { SeatLimitNoticeService, SeatLimitReached } from "./seat-limit-notice.service.ts";

/** One invitation as the acceptance ceremony reads it: the row and its organization. */
export type OrganizationInviteWithOrganization = OrganizationInvite &
  Readonly<{ organization: Readonly<{ id: string; name: string }> }>;

/** One batch of invitations, and the organization they were written against. */
export type OrganizationInvitesCreated = Readonly<{
  organization: Readonly<{ members: readonly unknown[] }>;
  invites: readonly Readonly<{ invite: OrganizationInvite; emailNotSent: boolean }>[];
}>;

/**
 * The invitations an organization has outstanding. The SAME service the
 * management REST family administers, so an administrator and a provisioning
 * tool see one set of invitations with one acceptance link each.
 */
export type OrganizationInvitationsCreateInput = Readonly<{
  organizationId: string;
  invites: readonly Readonly<{
    email: string;
    teamIds?: string;
    teams?: readonly Readonly<{ teamId: string; role: string; customRoleId?: string }>[];
    role: OrganizationUserRole;
  }>[];
  /**
   * Chosen by the transport that asked, never by the composition: a batch naming a team
   * outside the organization is refused under `strict` and filtered under `lenient`.
   */
  validation: OrganizationInviteValidation;
}>;

export type OrganizationInvitationsResent = Readonly<{
  invite: OrganizationInvite;
  emailNotSent: boolean;
}>;

export type OrganizationInvitationsListing = OrganizationInvite &
  Omit<OrganizationListedInvite, keyof OrganizationInvite>;

/** The two facts an invitation's display status is read from. */
export type OrganizationInvitationsStatusFacts = Readonly<{
  status: string;
  expiration: OrganizationInvite["expiration"];
}>;

export interface OrganizationInvitations {
  create(input: OrganizationInvitationsCreateInput): Promise<OrganizationInvitesCreated>;
  revoke(input: Readonly<{ organizationId: string; inviteId: string }>): Promise<void>;
  /**
   * Throttled per INVITATION, because the thing protected is the recipient's
   * inbox rather than this server. Throws when throttled.
   */
  assertSendAllowed(input: Readonly<{ inviteId: string }>): Promise<void>;
  resend(
    input: Readonly<{ organizationId: string; inviteId: string }>,
  ): Promise<OrganizationInvitationsResent>;
  extend(
    input: Readonly<{ organizationId: string; inviteId: string }>,
  ): Promise<Readonly<{ invite: OrganizationInvite }>>;
  approvePaymentPending(
    input: Readonly<{ subscriptionId: string; organizationId: string }>,
  ): Promise<void>;
  createPaymentPending(
    input: Readonly<{
      organizationId: string;
      subscriptionId: string;
      invites: readonly Readonly<{ email: string; role: OrganizationUserRole; teamIds: string }>[];
    }>,
  ): Promise<void>;
  cancelPaymentPending(
    input: Readonly<{ organizationId: string; subscriptionIds: readonly string[] }>,
  ): Promise<void>;
  list(
    input: Readonly<{ organizationId: string }>,
  ): Promise<readonly OrganizationInvitationsListing[]>;
  findByCode(
    input: Readonly<{ inviteCode: string }>,
  ): Promise<OrganizationInviteWithOrganization | null>;
  /**
   * Whether ANY of the signed-in person's VERIFIED identifiers holds the
   * invited address, and which one vouched. Somebody not yet on identifiers
   * falls back to comparing the session address byte for byte.
   */
  matchToAcceptor(
    input: Readonly<{ inviteEmail: string; sessionEmail: string; userId: string }>,
  ): Promise<Readonly<{ matches: boolean; viaIdentifierId?: string | null }>>;
  apply(
    input: Readonly<{
      userId: string;
      invite: OrganizationInviteWithOrganization;
      viaIdentifierId?: string | null;
    }>,
  ): Promise<void>;
  /**
   * Applies the PENDING invitation this address already holds here, as one
   * decision: an invitation that exists wins, and its role and team
   * assignments replace a default membership entirely.
   */
  applyPending(
    input: Readonly<{ userId: string; organizationId: string; email: string }>,
  ): Promise<OrganizationPendingInviteApplied>;
  findLandingProjectSlug(
    input: Readonly<{ invite: OrganizationInviteWithOrganization }>,
  ): Promise<string | null>;
  /** The acceptance link this deployment mints for one invitation code. */
  acceptUrl(inviteCode: string): string;
  /** The invited address, masked: an invite code is a bearer token. */
  maskAddress(email: string): string;
  /** PENDING / ACCEPTED / EXPIRED / REVOKED, expiry included. */
  displayStatus(invite: OrganizationInvitationsStatusFacts): string;
  /** Records that a refused invitation reached a seat limit, for billing's ops alert. */
  notifySeatLimitReached(
    input: Readonly<{
      organizationId: string;
      limitType: LimitType;
      current: number;
      max: number;
    }>,
  ): Promise<void>;
  /** The person behind an invited address, when they already have an account. */
  findUserIdByEmail(input: Readonly<{ email: string }>): Promise<string | null>;
}

/**
 * The invitations this deployment administers, in the shape the door reads.
 * The invite service, repository and throttle, under the method names the door's port uses.
 */
export class OrganizationInvitationsService implements OrganizationInvitations {
  static create(options: {
    invites: InviteService;
    repository: OrganizationInviteRepository;
    throttle: InviteSendThrottleService;
    baseHost: string;
    identity: Pick<IdentityApi, "verifiedEmailsOf">;
    userDirectory: OrganizationUserDirectoryRepository;
    notices: Pick<SeatLimitNoticeService, "record">;
  }): OrganizationInvitationsService {
    return new OrganizationInvitationsService(options);
  }

  private constructor(
    private readonly options: {
      invites: InviteService;
      repository: OrganizationInviteRepository;
      throttle: InviteSendThrottleService;
      baseHost: string;
      identity: Pick<IdentityApi, "verifiedEmailsOf">;
      userDirectory: OrganizationUserDirectoryRepository;
      notices: Pick<SeatLimitNoticeService, "record">;
    },
  ) {}

  create(input: OrganizationInvitationsCreateInput): Promise<OrganizationInvitesCreated> {
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
  ): Promise<OrganizationInvitationsResent> {
    return this.options.invites.resendInvite(input);
  }

  extend(
    input: Readonly<{ organizationId: string; inviteId: string }>,
  ): Promise<Readonly<{ invite: OrganizationInvite }>> {
    return this.options.invites.extendInvite(input);
  }

  createPaymentPending(
    input: Readonly<{
      organizationId: string;
      subscriptionId: string;
      invites: readonly Readonly<{ email: string; role: OrganizationUserRole; teamIds: string }>[];
    }>,
  ): Promise<void> {
    return this.options.invites.createPaymentPendingInvites(input);
  }

  cancelPaymentPending(
    input: Readonly<{ organizationId: string; subscriptionIds: readonly string[] }>,
  ): Promise<void> {
    return this.options.invites.cancelPaymentPendingInvites(input);
  }

  async approvePaymentPending(
    input: Readonly<{ subscriptionId: string; organizationId: string }>,
  ): Promise<void> {
    await this.options.invites.approvePaymentPendingInvites(input);
  }

  list(input: Readonly<{ organizationId: string }>): Promise<OrganizationInvitationsListing[]> {
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

  displayStatus(invite: OrganizationInvitationsStatusFacts): string {
    return resolveInviteDisplayStatus(invite);
  }

  /** Recorded as organization's seat-limit event; the worker tells billing's ops alert. */
  notifySeatLimitReached(input: SeatLimitReached): Promise<void> {
    return this.options.notices.record(input);
  }

  findUserIdByEmail(input: Readonly<{ email: string }>): Promise<string | null> {
    return this.options.userDirectory.findUserIdByEmail(input);
  }
}
