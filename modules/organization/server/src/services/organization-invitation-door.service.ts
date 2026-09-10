/**
 * The invitation half of `organization.*`, as one ceremony rather than a
 * handler: create, revoke, resend, list and accept.
 *
 * Every path that touches a join request here is non-fatal on purpose. The
 * membership is the durable outcome, and a request left open is answered by
 * the next approval or by its own expiry - refusing the invitation because a
 * request could not be tidied would trade the outcome for the bookkeeping.
 */

import {
  InviteAlreadyAcceptedError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteNotReadyForAcceptanceError,
  InviteWrongAccountError,
  MemberSeatLimitReachedError,
  OrganizationNotFoundError,
  isOrganizationApiCustomRole,
  type OrganizationApiCreateInvitesInput,
  type OrganizationApiInviteScope,
  type OrganizationCaller,
  type OrganizationInviteAccepted,
  type OrganizationInviteCreated,
  type OrganizationInviteResent,
  type OrganizationListedInvite,
} from "@langwatch/organization-contract";
import { HandledError } from "@langwatch/handled-error";

import type {
  OrganizationInvitations,
  OrganizationJoinRequests,
  OrganizationPlanGate,
  OrganizationSignals,
} from "../app/organization.infrastructure.ts";

/** What the ceremony needs beside the invitation service itself. */
export interface OrganizationInvitationDoorDependencies {
  readonly invitations: OrganizationInvitations;
  readonly joinRequests: OrganizationJoinRequests | null;
  readonly plans: OrganizationPlanGate;
  readonly signals: OrganizationSignals;
  /** Provisions the accepting person's personal workspace for this tenant. */
  ensurePersonalWorkspace(
    input: Readonly<{
      organizationId: string;
      displayName?: string | null;
      displayEmail?: string | null;
    }>,
    by: OrganizationCaller,
  ): Promise<unknown>;
}

export class OrganizationInvitationDoorService {
  static create(
    dependencies: OrganizationInvitationDoorDependencies,
  ): OrganizationInvitationDoorService {
    return new OrganizationInvitationDoorService(dependencies);
  }

  private constructor(private readonly deps: OrganizationInvitationDoorDependencies) {}

  /**
   * Invites a batch. Validation stays lenient, as this door has always been:
   * an invalid team or custom role drops that assignment rather than refusing
   * the whole batch.
   */
  async create(
    input: OrganizationApiCreateInvitesInput,
    by: OrganizationCaller,
  ): Promise<OrganizationInviteCreated[]> {
    const namesCustomRole = input.invites.some((invite) =>
      (invite.teams ?? []).some((team) => isOrganizationApiCustomRole(team.role)),
    );
    if (namesCustomRole) {
      await this.deps.plans.assertCustomRolesAllowed({ organizationId: input.organizationId });
    }

    const created = await this.#createOrRefuse(input);
    const withUrls = created.invites.map((record) => ({
      ...record,
      inviteUrl: this.deps.invitations.acceptUrl(record.invite.inviteCode),
    }));

    if (withUrls.length === 0) return withUrls;

    await this.#answerOpenJoinRequests(created.invites);

    this.deps.signals.trackServerEvent({
      userId: by.id,
      event: "team_member_invited",
      properties: { inviteCount: created.invites.length },
    });

    const memberCount = created.organization.members.length + created.invites.length;
    for (const record of created.invites) {
      this.deps.signals.fireTeamMemberInvitedNurturing({
        userId: by.id,
        teamMemberCount: memberCount,
        role: record.invite.role,
      });
    }

    return withUrls;
  }

  revoke(input: OrganizationApiInviteScope): Promise<void> {
    return this.deps.invitations.revoke(input);
  }

  /**
   * Throttled per INVITATION, and checked before the resend so a refused
   * attempt leaves the live code and the already-sent link alone.
   */
  async resend(input: OrganizationApiInviteScope): Promise<OrganizationInviteResent> {
    await this.deps.invitations.assertSendAllowed({ inviteId: input.inviteId });

    const { invite, emailNotSent } = await this.deps.invitations.resend(input);

    return { invite, emailNotSent, inviteUrl: this.deps.invitations.acceptUrl(invite.inviteCode) };
  }

  async list(input: Readonly<{ organizationId: string }>): Promise<OrganizationListedInvite[]> {
    return [...(await this.deps.invitations.list(input))];
  }

  /**
   * Spends one invitation link. A revoked invitation reads exactly like a
   * missing one: the journey ends quietly, revealing nothing about the
   * organization or the inviter. Expired is different - the inviter resends in
   * one click - so it gets its own named refusal.
   */
  async accept(
    input: Readonly<{ inviteCode: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationInviteAccepted> {
    const invite = await this.deps.invitations.findByCode(input);

    if (!invite || invite.status === "REVOKED") throw new InviteNotFoundError();
    // An invitation targets an address, so a session carrying none cannot be
    // matched to one at all.
    if (!by.email) throw new SignedInAddressRequiredError();
    if (invite.status === "ACCEPTED") throw new InviteAlreadyAcceptedError();
    if (this.deps.invitations.displayStatus(invite) === "EXPIRED") throw new InviteExpiredError();
    if (invite.status !== "PENDING") throw new InviteNotReadyForAcceptanceError();

    // An invitation targets an ADDRESS, and any of this person's verified
    // identifiers holding it vouches for them. Somebody not yet on identifiers
    // falls back to a plain session-address comparison.
    const { matches, viaIdentifierId } = await this.deps.invitations.matchToAcceptor({
      inviteEmail: invite.email,
      sessionEmail: by.email,
      userId: by.id,
    });
    // Signed in as somebody else is a wrong turn, not a refusal: the screen
    // names which account is wanted and offers the way back. Masked, because
    // an invite code is a bearer token and a mismatch is not a hole to read
    // the invited address through.
    if (!matches) {
      throw new InviteWrongAccountError(this.deps.invitations.maskAddress(invite.email));
    }

    // No transaction: the invitation's grants are ledger commands, so the
    // membership row has to be committed before they are emitted, and the
    // invitation is marked ACCEPTED only once everything before it has landed.
    await this.deps.invitations.apply({ userId: by.id, invite, viaIdentifierId });

    await this.#withdrawOpenRequest({ userId: by.id, organizationId: invite.organizationId });
    await this.#provisionPersonalWorkspace({ organizationId: invite.organizationId, by });

    void this.deps.signals
      .sendSlackSignupEvent({
        userName: by.name,
        userEmail: by.email,
        organizationName: invite.organization.name,
      })
      .catch((failure: unknown) => this.deps.signals.reportError(failure));

    this.deps.signals.fireInviteAcceptedNurturing({
      userId: by.id,
      email: by.email,
      name: by.name,
      organizationId: invite.organization.id,
      organizationName: invite.organization.name,
    });

    const projectSlug = await this.deps.invitations.findLandingProjectSlug({ invite });

    return {
      success: true,
      invite,
      project: projectSlug ? { slug: projectSlug } : null,
    } as OrganizationInviteAccepted;
  }

  async #createOrRefuse(input: OrganizationApiCreateInvitesInput) {
    try {
      return await this.deps.invitations.create(input);
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) throw error;

      const limit = seatLimitOf(error);
      if (!limit) throw error;

      // Told, not just refused: an organization that has run out of seats is
      // something its administrators act on, and the refusal itself only
      // reaches whoever was inviting.
      void this.deps.invitations
        .notifySeatLimitReached({ organizationId: input.organizationId, ...limit })
        .catch((failure: unknown) => this.deps.signals.reportError(failure));

      throw new MemberSeatLimitReachedError({ meta: limit });
    }
  }

  /**
   * A formal invitation ANSWERS the same person's open request: it owns role
   * and teams, so the request resolves approved-by-invitation rather than
   * staying open beside it. Silent when nothing is open, never fatal.
   */
  async #answerOpenJoinRequests(
    invites: readonly Readonly<{ invite: { id: string; email: string; organizationId: string } }>[],
  ): Promise<void> {
    const joinRequests = this.deps.joinRequests;
    if (!joinRequests) return;

    await Promise.all(
      invites.map(async (record) => {
        const invitedUserId = await this.deps.invitations.findUserIdByEmail({
          email: record.invite.email,
        });
        if (!invitedUserId) return;

        try {
          await joinRequests.resolveByInvitation({
            userId: invitedUserId,
            organizationId: record.invite.organizationId,
            inviteId: record.invite.id,
          });
        } catch (error) {
          this.deps.signals.reportError(error, {
            tags: { organizationId: record.invite.organizationId },
          });
        }
      }),
    );
  }

  async #withdrawOpenRequest(input: { userId: string; organizationId: string }): Promise<void> {
    const joinRequests = this.deps.joinRequests;
    if (!joinRequests) return;

    try {
      await joinRequests.withdrawOnInvitationAccepted(input);
    } catch (error) {
      this.deps.signals.reportError(error, { tags: { organizationId: input.organizationId } });
    }
  }

  /**
   * Idempotent, and outside the acceptance: an unexpected failure here must
   * not roll the membership back, and the next session's lazy backfill
   * recovers it. Reported so a systemic regression is visible before people
   * start noticing missing workspaces.
   */
  async #provisionPersonalWorkspace(input: {
    organizationId: string;
    by: OrganizationCaller;
  }): Promise<void> {
    try {
      await this.deps.ensurePersonalWorkspace(
        {
          organizationId: input.organizationId,
          displayName: input.by.name,
          displayEmail: input.by.email,
        },
        input.by,
      );
    } catch (error) {
      this.deps.signals.reportError(error, {
        extra: {
          origin: "organization.acceptInvite",
          userId: input.by.id,
          organizationId: input.organizationId,
        },
      });
    }
  }
}

/**
 * The session carries no address, so there is nothing for an invitation to be
 * matched against. Named rather than degraded: signing in again with the
 * invited account is the one thing that fixes it.
 */
class SignedInAddressRequiredError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "You must be signed in to accept the invite", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "SignedInAddressRequiredError";
  }
}

/** The seat facts behind a refusal, whichever layer raised it. */
function seatLimitOf(
  error: unknown,
): Readonly<{ limitType: string; current: number; max: number }> | null {
  if (!HandledError.isHandled(error)) return null;
  if (error.code !== "resource_limit_exceeded" && error.code !== "member_seat_limit_reached") {
    return null;
  }

  const meta = error.meta as Readonly<{ limitType?: unknown; current?: unknown; max?: unknown }>;
  if (
    typeof meta.limitType !== "string" ||
    typeof meta.current !== "number" ||
    typeof meta.max !== "number"
  ) {
    return null;
  }

  return { limitType: meta.limitType, current: meta.current, max: meta.max };
}
