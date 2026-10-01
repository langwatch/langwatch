/** Invitation ceremony: non-fatal paths preserve membership as durable outcome. */

import {
  SignedInAddressRequiredError,
  InviteAlreadyAcceptedError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteNotReadyForAcceptanceError,
  InviteWrongAccountError,
  MemberSeatLimitReachedError,
  OrganizationNotFoundError,
  isOrganizationApiCustomRole,
  type OrganizationApiCreateInvitationsInput,
  type OrganizationApiInviteScope,
  type OrganizationCaller,
  type OrganizationInvite,
  type OrganizationInviteAccepted,
  type OrganizationInviteCreated,
  type OrganizationInviteExtended,
  type OrganizationInviteResent,
  type OrganizationListedInvite,
  type OrganizationPendingInviteApplied,
  type OrganizationUserRole,
} from "@langwatch/organization-contract";
import { toDate } from "@langwatch/time";

import type {
  OrganizationInvitations,
  OrganizationJoinRequests,
  OrganizationPlanGate,
  OrganizationSignals,
} from "../app/organization.members.ts";
import { grantCallerOf } from "../rules/grant-caller.rules.ts";
import { ORGANIZATION_TO_TEAM_ROLE_MAP } from "../rules/member-role-constraints.rules.ts";
import { readSeatRefusal } from "../rules/seat-limit-refusal.rules.ts";
import type { InviteCreationThrottleService } from "./invite-creation-throttle.service.ts";
import type {
  OrganizationGrantCeilingService,
  OrganizationIntendedGrant,
} from "./organization-grant-ceiling.service.ts";
import type { OrganizationLifecycleNoticeService } from "./organization-lifecycle-notice.service.ts";

/** What the ceremony needs beside the invitation service itself. */
export interface OrganizationInvitationDoorDependencies {
  readonly invitations: OrganizationInvitations;
  readonly joinRequests: OrganizationJoinRequests | null;
  readonly plans: OrganizationPlanGate;
  readonly signals: OrganizationSignals;
  /** Where an invitation batch and an acceptance are recorded as organization's events. */
  readonly lifecycle: Pick<OrganizationLifecycleNoticeService, "membersInvited" | "inviteAccepted">;
  /** Authz's escalation rule: nobody invites anyone to more than the inviter holds. */
  readonly ceiling: Pick<OrganizationGrantCeilingService, "assertWithinCaller">;
  /** The sender-scoped per-hour creation counter, spent before a batch is written. */
  readonly creationThrottle: Pick<InviteCreationThrottleService, "assertCreationAllowed">;
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
   * Invites a batch in the validation mode the caller chose. `strict` refuses
   * the whole batch by name on an unassignable team or role; `lenient` drops
   * that assignment (or invitation) and creates the rest.
   */
  async create(
    input: OrganizationApiCreateInvitationsInput,
    by: OrganizationCaller,
  ): Promise<OrganizationInviteCreated[]> {
    // Spent first, one per invited address: a refused batch never writes, and
    // a flooding sender spends against the counter, not the seat census.
    await this.deps.creationThrottle.assertCreationAllowed({
      organizationId: input.organizationId,
      senderUserId: by.id,
      count: input.invites.length,
    });

    const namesCustomRole = input.invites.some((invite) =>
      (invite.teams ?? []).some((team) => isOrganizationApiCustomRole(team.role)),
    );
    if (namesCustomRole) {
      await this.deps.plans.assertCustomRolesAllowed({ organizationId: input.organizationId });
    }
    // Acceptance writes these grants as a consequence, so the inviter's ceiling is asked here.
    await this.deps.ceiling.assertWithinCaller({
      organizationId: input.organizationId,
      caller: grantCallerOf(by),
      grants: input.invites.flatMap((invite) => intendedGrants(input.organizationId, invite)),
    });

    const created = await this.#createOrRefuse(input);
    const withUrls = created.invites.map((record) => ({
      ...record,
      invite: inviteOnWire(record.invite),
      inviteUrl: this.deps.invitations.acceptUrl(record.invite.inviteCode),
    }));

    if (withUrls.length === 0) return withUrls;

    await this.#answerOpenJoinRequests(created.invites);

    this.deps.lifecycle.membersInvited({
      organizationId: input.organizationId,
      userId: by.id,
      inviteIds: created.invites.map((record) => record.invite.id),
      roles: created.invites.map((record) => record.invite.role),
      teamMemberCount: created.organization.members.length + created.invites.length,
    });

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

    return {
      invite: inviteOnWire(invite),
      emailNotSent,
      inviteUrl: this.deps.invitations.acceptUrl(invite.inviteCode),
    };
  }

  async extend(input: OrganizationApiInviteScope): Promise<OrganizationInviteExtended> {
    const { invite } = await this.deps.invitations.extend(input);

    return { invite: inviteOnWire(invite) };
  }

  /** Payment is no barrier: the inviter's ceiling is asked here, as for any invitation. */
  async createPaymentPending(
    input: Readonly<{
      organizationId: string;
      subscriptionId: string;
      invites: readonly Readonly<{ email: string; role: OrganizationUserRole; teamIds: string }>[];
    }>,
    by: OrganizationCaller,
  ): Promise<void> {
    await this.deps.ceiling.assertWithinCaller({
      organizationId: input.organizationId,
      caller: grantCallerOf(by),
      grants: input.invites.flatMap((invite) => intendedGrants(input.organizationId, invite)),
    });

    return this.deps.invitations.createPaymentPending(input);
  }

  cancelPaymentPending(
    input: Readonly<{ organizationId: string; subscriptionIds: readonly string[] }>,
  ): Promise<void> {
    return this.deps.invitations.cancelPaymentPending(input);
  }

  approvePaymentPending(
    input: Readonly<{ subscriptionId: string; organizationId: string }>,
  ): Promise<void> {
    return this.deps.invitations.approvePaymentPending(input);
  }

  async list(input: Readonly<{ organizationId: string }>): Promise<OrganizationListedInvite[]> {
    const invites = await this.deps.invitations.list(input);
    return invites.map((invite) => ({ ...invite, ...inviteOnWire(invite) }));
  }

  /**
   * Applies the PENDING invitation an arriving address already holds, for a
   * caller that never saw an invitation code: the address IS the match.
   */
  applyPending(
    input: Readonly<{ userId: string; organizationId: string; email: string }>,
  ): Promise<OrganizationPendingInviteApplied> {
    return this.deps.invitations.applyPending(input);
  }

  /**
   * Spends one invitation link. A revoked invitation reads exactly like a
   * missing one, revealing nothing about the organization or inviter.
   * Expired is different: the inviter resends in one click, its own refusal.
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

    this.deps.lifecycle.inviteAccepted({
      organizationId: invite.organization.id,
      userId: by.id,
      inviteId: invite.id,
      organizationName: invite.organization.name,
    });

    const projectSlug = await this.deps.invitations.findLandingProjectSlug({ invite });

    return {
      success: true,
      invite: { ...invite, ...inviteOnWire(invite) },
      project: projectSlug ? { slug: projectSlug } : null,
    } as OrganizationInviteAccepted;
  }

  async #createOrRefuse(input: OrganizationApiCreateInvitationsInput) {
    try {
      return await this.deps.invitations.create(input);
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) throw error;

      const refusal = readSeatRefusal(error);
      if (refusal.kind === "other") throw error;
      const { limit } = refusal;

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
   * not roll the membership back — the next session's lazy backfill recovers
   * it. Reported so a systemic regression is visible before workspaces go missing.
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

function inviteOnWire(invite: OrganizationInvite): OrganizationInviteCreated["invite"] {
  return {
    ...invite,
    expiration: invite.expiration === null ? null : toDate(invite.expiration),
    createdAt: toDate(invite.createdAt),
    updatedAt: toDate(invite.updatedAt),
  };
}

/** The grants accepting this invitation would write: its organization role and each team role. */
function intendedGrants(
  organizationId: string,
  invite: Readonly<{
    role: OrganizationUserRole;
    teamIds?: string;
    teams?: OrganizationApiCreateInvitationsInput["invites"][number]["teams"];
  }>,
): OrganizationIntendedGrant[] {
  const organizationGrant: OrganizationIntendedGrant = {
    role: ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role],
    scopeType: "ORGANIZATION",
    scopeId: organizationId,
  };
  // As invite-team-assignment.service.ts resolves: explicit teams, else legacy ids at the
  // default team role.
  if (!invite.teams || invite.teams.length === 0) {
    const legacyTeamIds = (invite.teamIds ?? "")
      .split(",")
      .map((teamId) => teamId.trim())
      .filter(Boolean);
    return [
      organizationGrant,
      ...legacyTeamIds.map((teamId): OrganizationIntendedGrant => ({
        role: ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role],
        scopeType: "TEAM",
        scopeId: teamId,
      })),
    ];
  }
  const teamGrants = invite.teams.map((team): OrganizationIntendedGrant => {
    if (team.role === "ADMIN" || team.role === "MEMBER" || team.role === "VIEWER") {
      return { role: team.role, scopeType: "TEAM", scopeId: team.teamId };
    }
    return {
      role: "CUSTOM",
      customRoleId: team.customRoleId ?? null,
      scopeType: "TEAM",
      scopeId: team.teamId,
    };
  });
  return [organizationGrant, ...teamGrants];
}
