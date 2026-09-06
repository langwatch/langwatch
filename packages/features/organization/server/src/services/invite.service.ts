import { type AuthzGrantsService } from "@langwatch/authz-contract";
import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import { type OrganizationInvite, OrganizationUserRole } from "@langwatch/organization-contract";
import type { OrganizationInviteRepository } from "../repositories/organization-invite.repository.ts";
import type { RoleService } from "@langwatch/role-contract";
import { ORGANIZATION_TO_TEAM_ROLE_MAP } from "../rules/member-role-constraints.rules.ts";
import { InviteNotFoundError } from "@langwatch/organization-contract";

import { TeamUserRole } from "@langwatch/organization-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { OrganizationInviteMailPort } from "../ports/invite.port.ts";
import { buildInviteAcceptUrl } from "../rules/invite-link.rules.ts";
import {
  resolveInviteDisplayStatus,
  type InviteDisplayStatus,
} from "../rules/invite-display-status.rules.ts";
import { type InviteServiceDependencies } from "../rules/invite-contracts.rules.ts";

import { InviteCreationService } from "./invite-creation.service.ts";
import { InviteAcceptanceService } from "./invite-acceptance.service.ts";
import { InviteTeamAssignmentService } from "./invite-team-assignment.service.ts";
import { InviteLifecycleService } from "./invite-lifecycle.service.ts";

/**
 * Team assignment input for invite creation.
 */
export class InviteService {
  private readonly creation: InviteCreationService;
  private readonly teams: InviteTeamAssignmentService;
  private readonly lifecycle: InviteLifecycleService;
  private readonly acceptance: InviteAcceptanceService;

  private constructor(private readonly deps: InviteServiceDependencies) {
    this.creation = InviteCreationService.create(deps);
    this.teams = InviteTeamAssignmentService.create(deps);
    this.lifecycle = InviteLifecycleService.create(deps);
    this.acceptance = InviteAcceptanceService.create(deps);
  }

  static create(deps: InviteServiceDependencies): InviteService {
    return new InviteService(deps);
  }

  /**
   * Whether the signed-in person may accept an invitation targeting
   * `inviteEmail`, and through which identifier (D11).
   */
  static matchInviteToAcceptor({
    inviteEmail,
    sessionEmail,
    matchable,
  }: {
    inviteEmail: string;
    sessionEmail: string;
    matchable: Array<{ identifierId: string; value: string }> | null;
  }): { matches: boolean; viaIdentifierId: string | null } {
    if (matchable === null) {
      return {
        matches: sessionEmail.toLowerCase() === inviteEmail.trim().toLowerCase(),
        viaIdentifierId: null,
      };
    }

    const normalizedInviteEmail = normalizeIdentifierValue(inviteEmail);
    const hit = matchable.find((candidate) => candidate.value === normalizedInviteEmail);

    return {
      matches: hit !== undefined,
      viaIdentifierId: hit?.identifierId ?? null,
    };
  }

  /**
   * The invited address as somebody signed in as the wrong account is allowed to
   * see it: first character, then the domain — `s•••@acme.com`.
   */
  static maskInvitedAddress(email: string): string {
    const trimmed = email.trim();
    const at = trimmed.lastIndexOf("@");
    if (at <= 0 || at === trimmed.length - 1) {
      return "•••";
    }

    const local = trimmed.slice(0, at);
    const domain = trimmed.slice(at + 1);

    return `${local[0]}•••@${domain}`;
  }

  /**
   * The team memberships an accepted invitation grants. Pure, like
   * `classifyInvitesByMemberType`, so the correction is testable in isolation.
   */
  static resolveInviteTeamMemberships({
    role,
    teamIds,
    teamAssignments,
  }: {
    role: OrganizationUserRole;
    teamIds: string;
    teamAssignments: unknown;
  }): Array<{ teamId: string; role: TeamUserRole; customRoleId?: string }> {
    let memberships: Array<{
      teamId: string;
      role: TeamUserRole;
      customRoleId?: string;
    }>;

    if (teamAssignments && Array.isArray(teamAssignments)) {
      const assignments = teamAssignments as unknown as Array<{
        teamId: string;
        role: TeamUserRole;
        customRoleId?: string;
      }>;
      memberships = assignments.map((a) => ({
        teamId: a.teamId,
        role: a.role,
        customRoleId: a.customRoleId,
      }));
    } else {
      const dedupedTeamIds = Array.from(
        new Set(
          teamIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      );
      memberships = dedupedTeamIds.map((teamId) => ({
        teamId,
        role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
      }));
    }

    if (role !== OrganizationUserRole.EXTERNAL) {
      return memberships;
    }

    return memberships.map((membership) =>
      membership.role === TeamUserRole.VIEWER && !membership.customRoleId
        ? membership
        : {
            teamId: membership.teamId,
            role: TeamUserRole.VIEWER,
            customRoleId: undefined,
          },
    );
  }

  /**
   * @param invites - Array of invites with role and optional team assignments
   * @param customRoleMap - Map of custom role ID to permissions array
   * @returns Count of full members and lite members
   */

  static classifyInvitesByMemberType({
    invites,
    customRoleMap,
    isViewOnlyCustomRole,
  }: {
    invites: Array<{
      role: OrganizationUserRole;
      teams?: Array<{ customRoleId?: string }>;
    }>;
    customRoleMap: Map<string, string[]>;
    /**
     * The lite-seat rule, from whichever vertical owns it. Passed rather than imported: it is
     * the entitlement feature's answer, and a core package reaching into that one for a
     * predicate is how two counts of the same organization start disagreeing.
     */
    isViewOnlyCustomRole: (permissions: string[]) => boolean;
  }): { fullMembers: number; liteMembers: number } {
    let fullMembers = 0;
    let liteMembers = 0;

    for (const invite of invites) {
      if (
        invite.role === OrganizationUserRole.ADMIN ||
        invite.role === OrganizationUserRole.MEMBER
      ) {
        fullMembers++;
      } else if (invite.role === OrganizationUserRole.EXTERNAL) {
        const hasNonViewRole = invite.teams?.some((t) => {
          if (!t.customRoleId) {
            return false;
          }

          const permissions = customRoleMap.get(t.customRoleId);

          return permissions && !isViewOnlyCustomRole(permissions);
        });
        if (hasNonViewRole) {
          fullMembers++;
        } else {
          liteMembers++;
        }
      }
    }

    return { fullMembers, liteMembers };
  }

  private get invites(): OrganizationInviteRepository {
    return this.deps.invites;
  }

  private get planProvider(): PlanProvider {
    return this.deps.plans;
  }

  private get roleService(): RoleService {
    return this.deps.roles;
  }

  private get mailer(): OrganizationInviteMailPort | undefined {
    return this.deps.mail;
  }

  private get writer(): AuthzGrantsService {
    return this.deps.grants;
  }

  /**
   * The same service bound to another repository — the batch path rebinds onto
   * the transaction it opened, so the duplicate check and the insert run on
   * the connection that transaction owns.
   */
  private onRepository(invites: OrganizationInviteRepository): InviteService {
    return new InviteService({ ...this.deps, invites });
  }

  async tryCheckDuplicateInvite(
    params: Parameters<InviteCreationService["tryCheckDuplicateInvite"]>[0],
  ): ReturnType<InviteCreationService["tryCheckDuplicateInvite"]> {
    return this.creation.tryCheckDuplicateInvite(params);
  }

  async assertNotAlreadyMembers(
    params: Parameters<InviteCreationService["assertNotAlreadyMembers"]>[0],
  ): Promise<void> {
    await this.creation.assertNotAlreadyMembers(params);
  }

  async validateTeamIds(
    params: Parameters<InviteTeamAssignmentService["validateTeamIds"]>[0],
  ): Promise<void> {
    await this.teams.validateTeamIds(params);
  }

  async checkLicenseLimits(
    params: Parameters<InviteCreationService["checkLicenseLimits"]>[0],
  ): Promise<void> {
    await this.creation.checkLicenseLimits(params);
  }

  async createAdminInviteRecord(
    params: Parameters<InviteCreationService["createAdminInviteRecord"]>[0],
  ): ReturnType<InviteCreationService["createAdminInviteRecord"]> {
    return this.creation.createAdminInviteRecord(params);
  }

  async sendInviteEmail(
    params: Parameters<InviteCreationService["sendInviteEmail"]>[0],
  ): ReturnType<InviteCreationService["sendInviteEmail"]> {
    return this.creation.sendInviteEmail(params);
  }

  async createInvites(
    params: Parameters<InviteCreationService["createInvites"]>[0],
  ): ReturnType<InviteCreationService["createInvites"]> {
    return this.creation.createInvites(params);
  }

  async applyInvite(
    params: Parameters<InviteAcceptanceService["applyInvite"]>[0],
  ): ReturnType<InviteAcceptanceService["applyInvite"]> {
    return this.acceptance.applyInvite(params);
  }

  async listInvites({ organizationId }: { organizationId: string }): Promise<
    Array<
      OrganizationInvite & {
        inviteUrl: string;
        displayStatus: InviteDisplayStatus;
        requestedByUser: {
          id: string;
          name: string | null;
          email: string | null;
        } | null;
      }
    >
  > {
    const invites = await this.invites.findListableInvites({ organizationId });

    return invites.map((invite) => ({
      ...invite,
      inviteUrl: buildInviteAcceptUrl(this.deps.baseHost, invite.inviteCode),
      displayStatus: resolveInviteDisplayStatus(invite),
    }));
  }

  /**
   * Revocation is a state, not a delete (D11): the row stays, visible as REVOKED, and the
   * code on it stops opening anything. Organization-scoped: an invite id from another
   * organization reads as not found, never as someone else's invite.
   */
  async revokeInvite({
    organizationId,
    inviteId,
  }: {
    organizationId: string;
    inviteId: string;
  }): Promise<{ success: true }> {
    const revoked = await this.invites.revokeOpenInvite({ inviteId, organizationId });
    if (revoked === 0) {
      throw new InviteNotFoundError("Invitation not found");
    }

    return { success: true };
  }

  async tryFindLandingProjectSlug(invite: OrganizationInvite): Promise<string | null> {
    // Collect all invited team IDs from either format
    const invitedTeamIds = (() => {
      if (invite.teamAssignments && Array.isArray(invite.teamAssignments)) {
        const assignments = invite.teamAssignments as Array<{ teamId: string }>;

        return assignments.map((a) => a.teamId).filter(Boolean);
      }

      return invite.teamIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    })();

    // Look for a project in any of the invited teams
    const project =
      (invitedTeamIds.length > 0
        ? await this.invites.tryFindProjectSlugForTeams({ teamIds: invitedTeamIds })
        : null) ??
      // Org-wide fallback only for roles with broad access (ADMIN/MEMBER)
      (invite.role === OrganizationUserRole.ADMIN || invite.role === OrganizationUserRole.MEMBER
        ? await this.invites.tryFindProjectSlugInOrganization({
            organizationId: invite.organizationId,
          })
        : null);

    return project;
  }

  /**
   * Finds a PENDING, non-expired invite matching the given organization and
   * email (case-insensitive). Returns null when no such invite exists.
   */
  async resendInvite(
    params: Parameters<InviteLifecycleService["resendInvite"]>[0],
  ): ReturnType<InviteLifecycleService["resendInvite"]> {
    return this.lifecycle.resendInvite(params);
  }

  async requestFreshInvite(
    params: Parameters<InviteLifecycleService["requestFreshInvite"]>[0],
  ): ReturnType<InviteLifecycleService["requestFreshInvite"]> {
    return this.lifecycle.requestFreshInvite(params);
  }

  async createPaymentPendingInvite(
    params: Parameters<InviteLifecycleService["createPaymentPendingInvite"]>[0],
  ): ReturnType<InviteLifecycleService["createPaymentPendingInvite"]> {
    return this.lifecycle.createPaymentPendingInvite(params);
  }

  async approvePaymentPendingInvites(
    params: Parameters<InviteLifecycleService["approvePaymentPendingInvites"]>[0],
  ): ReturnType<InviteLifecycleService["approvePaymentPendingInvites"]> {
    return this.lifecycle.approvePaymentPendingInvites(params);
  }

  async tryFindPendingByOrgAndEmail({
    organizationId,
    email,
  }: {
    organizationId: string;
    email: string;
  }): Promise<OrganizationInvite | null> {
    return this.invites.tryFindPendingInviteForEmail({ organizationId, email });
  }
}
