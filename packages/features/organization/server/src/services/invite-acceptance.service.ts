/**
 * Accepting an invitation: the membership write and the grant tail that follows it, both
 * idempotent so a retry repairs rather than duplicates.
 */
import { ledgerActorFor } from "@langwatch/actor";
import { CustomRoleIdRequiredError, type AuthzGrantsService } from "@langwatch/authz-contract";
import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { createLogger } from "@langwatch/observability";
import {
  AlreadyOrganizationMemberError,
  CustomRoleNotAssignableError,
  DuplicateInviteError,
  InviteNotFoundError,
  InviteNotReadyError,
  LiteMemberViewerOnlyError,
  MemberSeatLimitReachedError,
  OrganizationNotFoundError,
  OrganizationUserRole,
  PersonalWorkspaceNotManagedHereError,
  RoleBindingScopeType,
  TeamNotInOrganizationError,
  TeamUserRole,
  type Organization,
  type OrganizationInvite,
  type OrganizationUser,
} from "@langwatch/organization-contract";
import type { PlanProvider, PlanProviderUser } from "@langwatch/entitlement-contract";
import type { RoleService } from "@langwatch/role-contract";
import type { OrganizationInviteRepository } from "../repositories/organization-invite.repository";
import type {
  OrganizationInviteMailPort,
  OrganizationInviteSeatCensusPort,
} from "../ports/invite.port";
import { isCustomRole } from "../rules/custom-role-naming.rules";
import { ORGANIZATION_TO_TEAM_ROLE_MAP } from "../rules/member-role-constraints.rules";
import { buildInviteAcceptUrl } from "../rules/invite-link.rules";
import { InviteService } from "./invite.service";
import {
  INVITE_BATCH_TXN_MAX_WAIT_MS,
  INVITE_BATCH_TXN_TIMEOUT_MS,
  INVITE_EXPIRATION_MS,
  ROLE_BINDING_KSUID_RESOURCE,
  type CreateAdminInviteInput,
  type CreateInvitesInviteInput,
  type CreatePaymentPendingInviteInput,
  type InviteServiceDependencies,
  type ResolvedInviteTeams,
  type TeamAssignmentInput,
} from "../rules/invite-contracts.rules";

const logger = createLogger("langwatch:invites");

export class InviteAcceptanceService {
  static create(deps: InviteServiceDependencies): InviteAcceptanceService {
    return new InviteAcceptanceService(deps);
  }

  private constructor(private readonly deps: InviteServiceDependencies) {}

  private get invites(): OrganizationInviteRepository {
    return this.deps.invites;
  }

  private get roleService(): RoleService {
    return this.deps.roles;
  }

  private get writer(): AuthzGrantsService {
    return this.deps.grants;
  }

  async applyInvite({
    userId,
    invite,
    viaIdentifierId,
  }: {
    userId: string;
    invite: OrganizationInvite;
    /** The VERIFIED identifier the acceptance matched on, when the user is
     *  on identifiers; null/absent for the legacy User.email match. */
    viaIdentifierId?: string | null;
  }): Promise<void> {
    if (invite.status !== "PENDING") {
      const isCallerRetryingItsOwnAccept =
        invite.status === "ACCEPTED" &&
        (await this.callerHoldsMembership({
          userId,
          organizationId: invite.organizationId,
        }));
      if (isCallerRetryingItsOwnAccept) {
        await this.applyInviteGrants({ userId, invite });

        return;
      }

      throw new InviteNotReadyError(invite.id, invite.status);
    }

    // Root client only, and it always was: the grants below are ledger commands that cannot ride a
    // caller's transaction, and the acceptance now opens one of its own. The acceptance CLAIMS the row
    // (D11): a conditional update on the expected (status, inviteCode) pair, inside the same transaction
    // as the membership write. Two racers on one PENDING invite cannot both win — the loser's update
    // matches nothing, the transaction rolls back, and no membership row is written for them.
    const claimed = await this.invites.withTransaction(async (transaction) => {
      const claim = await transaction.claimInviteForAcceptance({
        inviteId: invite.id,
        organizationId: invite.organizationId,
        inviteCode: invite.inviteCode,
        acceptedByUserId: userId,
        acceptedViaIdentifierId: viaIdentifierId ?? null,
      });
      if (claim === 0) {
        return false;
      }

      await transaction.addMembership({
        userId,
        organizationId: invite.organizationId,
        role: invite.role,
      });

      return true;
    });

    if (!claimed) {
      // The row moved between the caller's read and the claim. If it moved
      // because THIS user's own concurrent accept won, the grant tail is a
      // repair, exactly as in the retry path above; anyone else sees the
      // stale-code refusal.
      const current = await this.invites.tryFindInviteStatus({ inviteId: invite.id });
      const isCallerRacingItself =
        current?.status === "ACCEPTED" &&
        (await this.callerHoldsMembership({
          userId,
          organizationId: invite.organizationId,
        }));
      if (isCallerRacingItself) {
        await this.applyInviteGrants({ userId, invite });

        return;
      }

      throw new InviteNotFoundError("Invitation is no longer open");
    }

    await this.applyInviteGrants({ userId, invite });
  }

  /**
   * Whether `userId` holds the organization membership `applyInvite`'s transaction writes — the two
   * commit together, so holding it means THIS user's own accept is what committed, and retrying the
   * grant tail is therefore a repair rather than a different person reaching for someone else's invite.
   */
  private async callerHoldsMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    return await this.invites.hasMembership({ userId, organizationId });
  }

  /** The ORGANIZATION-scoped grant an invitation carries, replacing whatever stood before it. */
  private async attachOrganizationGrant({
    userId,
    invite,
    actor,
  }: {
    userId: string;
    invite: OrganizationInvite;
    actor: ReturnType<typeof ledgerActorFor>;
  }): Promise<void> {
    const writer = this.writer;
    await writer.revokeBindingsWhere({
      organizationId: invite.organizationId,
      where: {
        userId,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: invite.organizationId,
      },
      actor,
      reason: "replaced by the invite's organization role",
    });
    await writer.attachBindings({
      organizationId: invite.organizationId,
      bindings: [
        {
          bindingId: generate(ROLE_BINDING_KSUID_RESOURCE).toString(),
          principal: { userId },
          // The declared mapping, not a cast through `unknown`: the two enums
          // share three names by coincidence and EXTERNAL is not one of them,
          // so a cast would be right until somebody adds a seat.
          role: ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role],
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: invite.organizationId,
        },
      ],
      actor,
      source: "invite",
      onDuplicate: "skip",
    });
  }

  /**
   * The team memberships the invitation names, minus any whose custom role this organization
   * may no longer assign — dropped with a warning rather than failing the accept.
   */
  private async assignableTeamMemberships(
    invite: OrganizationInvite,
  ): Promise<ReturnType<typeof InviteService.resolveInviteTeamMemberships>> {
    const teamMembershipData = InviteService.resolveInviteTeamMemberships({
      role: invite.role,
      teamIds: invite.teamIds,
      teamAssignments: invite.teamAssignments,
    });
    const customRoleIds = teamMembershipData
      .filter((m) => m.role === TeamUserRole.CUSTOM && m.customRoleId)
      .map((m) => m.customRoleId!);
    if (customRoleIds.length === 0) {
      return teamMembershipData;
    }

    const validRoles = await this.roleService.filterAssignable({
      roleIds: customRoleIds,
      organizationId: invite.organizationId,
    });
    const validIds = new Set(validRoles);
    const invalidAssignments = teamMembershipData.filter(
      (m) => m.customRoleId && !validIds.has(m.customRoleId),
    );
    if (invalidAssignments.length > 0) {
      logger.warn(
        { inviteId: invite.id, invalidAssignments },
        "dropping team assignments with invalid/non-assignable custom roles at invite accept",
      );
    }

    return teamMembershipData.filter((m) => !m.customRoleId || validIds.has(m.customRoleId));
  }

  /**
   * The grant tail of `applyInvite`: the ORGANIZATION-scoped grant (skipped for EXTERNAL)
   * and each team's grant. Idempotent (revoke-then-attach, duplicates skipped), so both the
   * fresh-accept caller and the retry-repair caller in `applyInvite` can run it safely.
   */
  private async applyInviteGrants({
    userId,
    invite,
  }: {
    userId: string;
    invite: OrganizationInvite;
  }): Promise<void> {
    const writer = this.writer;
    // Who decided this access: the person who sent the invitation, not the
    // person receiving it. The invitee never granted themselves anything, and
    // an audit trail that says they did answers the wrong question. An invite
    // with no recorded sender (the older rows, and the ones a subscription
    // approval creates) is attributed to the service.
    const actor = ledgerActorFor({
      userId: invite.requestedBy,
      fallback: "inviteService",
    });

    if (invite.role !== OrganizationUserRole.EXTERNAL) {
      await this.attachOrganizationGrant({ userId, invite, actor });
    }

    const teamMembershipData = await this.assignableTeamMemberships(invite);

    // Each team's stale grants go first, one team at a time — the revoke is
    // scoped to a single team and cannot be widened without widening what it
    // takes away. The grants that replace them are one command for the whole
    // invite: the invitee gets every team the invitation named, or none of
    // them, instead of arriving in the first three teams of five.
    for (const member of teamMembershipData) {
      await writer.revokeBindingsWhere({
        organizationId: invite.organizationId,
        where: {
          userId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: member.teamId,
        },
        actor,
        reason: "replaced by the invite's team role",
      });
    }

    if (teamMembershipData.length > 0) {
      await writer.attachBindings({
        organizationId: invite.organizationId,
        bindings: teamMembershipData.map((member) => ({
          bindingId: generate(ROLE_BINDING_KSUID_RESOURCE).toString(),
          principal: { userId },
          role: member.role,
          customRoleId: member.customRoleId ?? null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: member.teamId,
        })),
        actor,
        source: "invite",
        onDuplicate: "skip",
      });
    }
  }

  /**
   * Approves all PAYMENT_PENDING invites for a given subscription:
   * - Transitions each to PENDING with a fresh INVITE_EXPIRATION_MS window
   * - Sends invite emails
   */
}
