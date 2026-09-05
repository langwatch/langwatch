/**
 * Creating invitations: the duplicate and membership guards, the seat-licence check, the team
 * assignments each invite carries, and the batch transaction that persists them.
 */
import { nanoid } from "nanoid";
import { createLogger } from "@langwatch/observability";
import {
  AlreadyOrganizationMemberError,
  DuplicateInviteError,
  LiteMemberViewerOnlyError,
  MemberSeatLimitReachedError,
  OrganizationNotFoundError,
  OrganizationUserRole,
  PersonalWorkspaceNotManagedHereError,
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
  type OrganizationInvite,
  type OrganizationUser,
} from "@langwatch/organization-contract";
import type { PlanProvider, PlanProviderUser } from "@langwatch/entitlement-contract";
import type { RoleService } from "@langwatch/role-contract";
import type { OrganizationInviteRepository } from "../repositories/organization-invite.repository";
import type { OrganizationInviteMailPort } from "../ports/invite.port";
import { buildInviteAcceptUrl } from "../rules/invite-link.rules";
import { InviteService } from "./invite.service";
import { InviteTeamAssignmentService } from "./invite-team-assignment.service";
import {
  INVITE_BATCH_TXN_MAX_WAIT_MS,
  INVITE_BATCH_TXN_TIMEOUT_MS,
  INVITE_EXPIRATION_MS,
  type CreateAdminInviteInput,
  type CreateInvitesInviteInput,
  type InviteServiceDependencies,
  type TeamAssignmentInput,
} from "../rules/invite-contracts.rules";

const logger = createLogger("langwatch:invites");

export class InviteCreationService {
  static create(deps: InviteServiceDependencies): InviteCreationService {
    return new InviteCreationService(deps);
  }

  private readonly teams: InviteTeamAssignmentService;

  private constructor(private readonly deps: InviteServiceDependencies) {
    this.teams = InviteTeamAssignmentService.create(deps);
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

  /**
   * The same service bound to another repository — the batch path rebinds onto the transaction
   * it opened, so the duplicate check and the insert run on the connection it owns.
   */
  private onRepository(invites: OrganizationInviteRepository): InviteCreationService {
    return new InviteCreationService({ ...this.deps, invites });
  }

  /**
   * Validates that an invite can be created:
   */
  async tryCheckDuplicateInvite({
    email,
    organizationId,
  }: {
    email: string;
    organizationId: string;
  }): Promise<OrganizationInvite | null> {
    return this.invites.tryFindOpenInviteForEmail({ email, organizationId });
  }

  /**
   * Refuses any address that already belongs to a member of this organization.
   */
  async assertNotAlreadyMembers({
    emails,
    organizationId,
  }: {
    emails: string[];
    organizationId: string;
  }): Promise<void> {
    if (emails.length === 0) {
      return;
    }

    // The stored address, not the typed one: it is the one shown in the
    // members table the admin is being sent back to.
    const memberEmail = await this.invites.tryFindMemberEmail({ organizationId, emails });
    if (memberEmail !== null) {
      throw new AlreadyOrganizationMemberError(memberEmail);
    }
  }

  async checkLicenseLimits({
    organizationId,
    newInvites,
    user,
  }: {
    organizationId: string;
    newInvites: Array<{
      role: OrganizationUserRole;
      teams?: Array<{ customRoleId?: string }>;
    }>;
    user?: PlanProviderUser;
  }): Promise<void> {
    const subscriptionLimits = await this.planProvider.getActivePlan({
      organizationId,
      user,
    });

    const currentFullMembers = await this.deps.seats.getMemberCount(organizationId);
    const currentMembersLite = await this.deps.seats.getMembersLiteCount(organizationId);

    const customRoles = await this.invites.findCustomRolePermissions({ organizationId });
    const customRoleMap = new Map(
      customRoles.map((r) => [r.id, (r.permissions as string[] | null) ?? []]),
    );

    const { fullMembers: newFullMembers, liteMembers: newLiteMembers } =
      InviteService.classifyInvitesByMemberType({
        invites: newInvites,
        customRoleMap,
        isViewOnlyCustomRole: (permissions) => this.deps.seats.isViewOnlyCustomRole(permissions),
      });

    if (!subscriptionLimits.overrideAddingLimitations) {
      if (currentFullMembers + newFullMembers > subscriptionLimits.maxMembers) {
        throw new MemberSeatLimitReachedError({
          meta: {
            limitType: "members",
            current: currentFullMembers,
            max: subscriptionLimits.maxMembers,
          },
        });
      }

      if (currentMembersLite + newLiteMembers > subscriptionLimits.maxMembersLite) {
        throw new MemberSeatLimitReachedError({
          meta: {
            limitType: "membersLite",
            current: currentMembersLite,
            max: subscriptionLimits.maxMembersLite,
          },
        });
      }
    }
  }

  /**
   * A Lite Member seat allows the Viewer team role only, and a custom role requires a full seat, so an invitation
   * cannot be written promising more. Refused here, where the admin choosing the roles can act on it; an invitation
   * stored before this rule is corrected at acceptance instead (`resolveInviteTeamMemberships`).
   */
  assertAssignmentsWithinInvitedSeat({
    role,
    teamAssignments,
  }: {
    role: OrganizationUserRole;
    teamAssignments?: TeamAssignmentInput[];
  }): void {
    if (role !== OrganizationUserRole.EXTERNAL) {
      return;
    }

    for (const assignment of teamAssignments ?? []) {
      if (assignment.customRoleId || assignment.role !== TeamUserRole.VIEWER) {
        throw new LiteMemberViewerOnlyError();
      }
    }
  }

  /**
   * Creates an invite record with PENDING status (DB-only, no email). Use this
   * inside transactions to avoid sending emails before commit.
   * @returns The created invite and its organization (for email sending later)
   */
  async createAdminInviteRecord(
    input: CreateAdminInviteInput,
  ): Promise<{ invite: OrganizationInvite; organization: Organization }> {
    const organization = await this.invites.tryFindOrganization({
      organizationId: input.organizationId,
    });

    if (!organization) {
      throw new OrganizationNotFoundError();
    }

    return { invite: await this.createInviteRow(input), organization };
  }

  /**
   * The pending invite row itself, with no organization lookup attached.
   */
  private async createInviteRow(input: CreateAdminInviteInput): Promise<OrganizationInvite> {
    // Every writer of a pending invite passes through here, including the
    // batch path, so the seat rule is checked here rather than once per
    // caller: a Lite Member invited through the batch endpoint would
    // otherwise be promised a team role their seat cannot hold.
    this.assertAssignmentsWithinInvitedSeat(input);

    return this.invites.createPendingInvite({
      email: input.email,
      inviteCode: nanoid(),
      expiration: new Date(Date.now() + INVITE_EXPIRATION_MS),
      organizationId: input.organizationId,
      teamIds: input.teamIds,
      ...(input.teamAssignments && input.teamAssignments.length > 0
        ? { teamAssignments: input.teamAssignments }
        : {}),
      role: input.role,
    });
  }

  /**
   * Attempts to send an invite email, catching failures gracefully.
   * Returns whether the email was not sent (due to missing provider or error).
   */
  async sendInviteEmail({
    email,
    organization,
    inviteCode,
  }: {
    email: string;
    organization: Organization;
    inviteCode: string;
  }): Promise<{ emailNotSent: boolean }> {
    const mailer = this.mailer;
    if (!mailer) {
      return { emailNotSent: true };
    }

    try {
      await mailer.sendInvite({
        email,
        organization,
        acceptInviteUrl: buildInviteAcceptUrl(this.deps.baseHost, inviteCode),
      });

      return { emailNotSent: false };
    } catch (error) {
      logger.error({ error }, "Failed to send invite email");

      return { emailNotSent: true };
    }
  }

  /**
   * The whole admin batch-invite flow in one place: membership and licence
   * checks, team and custom-role validation, duplicate handling, transactional
   * creation, then email delivery with per-invite `emailNotSent` reporting.
   */
  async createInvites({
    organizationId,
    invites,
    user,
    validation,
  }: {
    organizationId: string;
    invites: CreateInvitesInviteInput[];
    user?: PlanProviderUser;
    validation: "strict" | "lenient";
  }): Promise<{
    organization: Organization & { members: OrganizationUser[] };
    invites: Array<{ invite: OrganizationInvite; emailNotSent: boolean }>;
  }> {
    const isStrict = validation === "strict";

    const organization = await this.invites.tryFindOrganizationWithMembers({ organizationId });
    if (!organization) {
      throw new OrganizationNotFoundError();
    }

    // Before anything is written, and ahead of the licence limit: inviting
    // someone who is already a member is refused rather than silently
    // duplicated as a pending invite beside the membership, so an admin who
    // is at their seat cap is told the real reason rather than being sold
    // an upgrade for a seat they already own.
    await this.assertNotAlreadyMembers({
      emails: invites.map((invite) => invite.email),
      organizationId,
    });

    await this.checkLicenseLimits({
      organizationId,
      newInvites: invites.map((invite) => ({
        role: invite.role,
        teams: invite.teams,
      })),
      user,
    });

    const validInvites = await this.validatedInvites({ organizationId, invites, isStrict });

    // Phase 1: DB operations in a transaction, no side effects.
    const createdRecords = await this.invites.withTransaction(
      (transaction) =>
        this.persistInvites({
          transaction,
          invites: validInvites,
          organization,
          isStrict,
        }),
      {
        timeoutMs: INVITE_BATCH_TXN_TIMEOUT_MS,
        maxWaitMs: INVITE_BATCH_TXN_MAX_WAIT_MS,
      },
    );

    // Phase 2: emails outside the transaction, so a provider failure can
    // never roll back a committed invite.
    const results = await Promise.all(
      createdRecords.map(async (record) => {
        const { emailNotSent } = await this.sendInviteEmail({
          email: record.invite.email,
          organization: record.organization,
          inviteCode: record.invite.inviteCode,
        });

        return { invite: record.invite, emailNotSent };
      }),
    );

    return { organization, invites: results };
  }

  /**
   * Read-only validation outside the transaction. A personal workspace is refused on every
   * path, lenient mode included: accepting an invite against it would hand a second person
   * the workspace its owner was promised privacy in (issue #6338).
   */
  private async validatedInvites({
    organizationId,
    invites,
    isStrict,
  }: {
    organizationId: string;
    invites: CreateInvitesInviteInput[];
    isStrict: boolean;
  }): Promise<CreateAdminInviteInput[]> {
    const preparedInvites = await Promise.all(
      invites.map((invite) => this.prepareInvite({ organizationId, invite, isStrict })),
    );
    const validInvites = preparedInvites.filter(
      (invite): invite is NonNullable<typeof invite> => invite !== null,
    );
    const personalTeam = await this.invites.tryFindPersonalTeamInScopes({
      scopes: validInvites.flatMap(
        (invite) =>
          invite.teamAssignments?.map((assignment) => ({
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: assignment.teamId,
          })) ?? [],
      ),
    });
    if (personalTeam) {
      throw new PersonalWorkspaceNotManagedHereError(personalTeam.name);
    }

    return validInvites;
  }

  /**
   * Writes the prepared invites inside the caller's transaction, skipping the
   * ones an existing invite already covers (or refusing them in strict mode).
   */
  private async persistInvites({
    transaction,
    invites,
    organization,
    isStrict,
  }: {
    transaction: OrganizationInviteRepository;
    invites: CreateAdminInviteInput[];
    organization: Organization;
    isStrict: boolean;
  }): Promise<Array<{ invite: OrganizationInvite; organization: Organization }>> {
    const txInviteService = this.onRepository(transaction);
    const records: Array<{
      invite: OrganizationInvite;
      organization: Organization;
    }> = [];

    for (const invite of invites) {
      const existingInvite = await txInviteService.tryCheckDuplicateInvite({
        email: invite.email,
        organizationId: invite.organizationId,
      });

      if (existingInvite) {
        if (isStrict) {
          throw new DuplicateInviteError(invite.email);
        }

        continue;
      }

      records.push({
        invite: await txInviteService.createInviteRow(invite),
        organization,
      });
    }

    return records;
  }

  /**
   * Validates and normalizes one requested invite into the record shape
   * `createAdminInviteRecord` persists. Returns null when lenient validation drops the
   * invite entirely (no valid teams, blank email, or an invalid custom role).
   */
  private async prepareInvite({
    organizationId,
    invite,
    isStrict,
  }: {
    organizationId: string;
    invite: CreateInvitesInviteInput;
    isStrict: boolean;
  }): Promise<CreateAdminInviteInput | null> {
    const resolvedTeams = await this.teams.tryResolveInviteTeams({
      organizationId,
      invite,
      isStrict,
    });
    if (!resolvedTeams) {
      return null;
    }

    const email = invite.email.trim();
    if (!email) {
      return null;
    }

    return {
      // Stored trimmed, because the reads look the address up as it was
      // typed: `tryCheckDuplicateInvite` and `tryFindPendingByOrgAndEmail` both miss
      // a row written as " a@b.com ", so the duplicate check never fires and
      // SSO onboarding never finds the invite it should adopt.
      email,
      role: invite.role,
      organizationId,
      teamIds: resolvedTeams.teamIdsString,
      teamAssignments:
        resolvedTeams.teamAssignments.length > 0 ? resolvedTeams.teamAssignments : undefined,
    };
  }
}
