import { generate } from "@langwatch/ksuid";
import type { JsonArray } from "@prisma/client/runtime/client";
import { nanoid } from "nanoid";
import {
  type Organization,
  type OrganizationInvite,
  type OrganizationUser,
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "~/generated/prisma/client";
import { isRootPrismaClient } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";
import { isCustomRole } from "../api/enterprise";
import { LimitExceededError } from "../license-enforcement/errors";
import { RoleService } from "../role/role.service";
import {
  CustomRoleIdRequiredError,
  CustomRoleNotAssignableError,
} from "../role-bindings/errors";
import {
  AlreadyOrganizationMemberError,
  DuplicateInviteError,
  InviteNotFoundError,
  InviteNotReadyError,
  OrganizationNotFoundError,
  TeamNotInOrganizationError,
} from "./errors";

/** Duration in milliseconds before an invite expires (48 hours). */
export const INVITE_EXPIRATION_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Ceiling on the batch-invite transaction, derived from the work it holds:
 * the batch endpoint accepts 50 invites and {@link InviteService.persistInvites}
 * issues one duplicate check and one insert per invite on the single
 * connection an interactive transaction owns, so 100 sequential indexed
 * statements. At 200ms apiece, which is already an unhappy database, that is
 * 20 seconds; Prisma's 5s default fails the whole batch with P2028 well before
 * a large batch is unhealthy.
 *
 * Not larger, because the transaction pins one pool connection for its whole
 * life: this number is the cap on how long one batch may hold a connection,
 * not a target. A batch that reaches it is failing for a real reason.
 */
const INVITE_BATCH_TXN_TIMEOUT_MS = 20_000;

/**
 * How long to wait for a connection before starting. Raised from Prisma's 2s
 * default for the same reason the dataset mutations raise it: a busy pool
 * should not fail a batch before it has done any work.
 */
const INVITE_BATCH_TXN_MAX_WAIT_MS = 10_000;

/** Mapping from organization roles to default team roles. */
export const ORGANIZATION_TO_TEAM_ROLE_MAP: Record<
  OrganizationUserRole,
  TeamUserRole
> = {
  [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
  [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
  [OrganizationUserRole.EXTERNAL]: TeamUserRole.VIEWER,
} as const;

import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import { TeamUserRole } from "~/generated/prisma/client";
import { LiteMemberViewerOnlyError } from "~/server/app-layer/teams/team.service";
import { getApp } from "../app-layer/app";
import type {
  PlanProvider,
  PlanProviderUser,
} from "../app-layer/subscription/plan-provider";
import {
  type ILicenseEnforcementRepository,
  LicenseEnforcementRepository,
} from "../license-enforcement/license-enforcement.repository";
import { isViewOnlyCustomRole } from "../license-enforcement/member-classification";
import { sendInviteEmail } from "../mailer/inviteEmail";
import { assertNoPersonalTeamScope } from "../role-bindings/personal-team-scope";
import { buildInviteAcceptUrl } from "./invite-link";

const logger = createLogger("langwatch:invites");

/**
 * Team assignment input for invite creation.
 */
interface TeamAssignmentInput {
  teamId: string;
  role: TeamUserRole;
  customRoleId?: string;
}

/**
 * Pure function that classifies invites by member type (full vs lite).
 * Testable in isolation without database or dependencies.
 *
 * @param invites - Array of invites with role and optional team assignments
 * @param customRoleMap - Map of custom role ID to permissions array
 * @returns Count of full members and lite members
 */
/**
 * The team memberships an accepted invitation grants. Pure, like
 * `classifyInvitesByMemberType`, so the correction is testable in isolation.
 *
 * A Lite Member seat allows the Viewer team role only, and a custom role
 * requires a full seat. New invitations are refused above that ceiling when
 * they are written, but invitations stored before the rule may still promise
 * more; the seat corrects them here, the same way a seat change corrects
 * stored access rows, rather than refusing the person who clicked the link.
 */
export function resolveInviteTeamMemberships({
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

  if (role !== OrganizationUserRole.EXTERNAL) return memberships;
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

export function classifyInvitesByMemberType(
  invites: Array<{
    role: OrganizationUserRole;
    teams?: Array<{ customRoleId?: string }>;
  }>,
  customRoleMap: Map<string, string[]>,
): { fullMembers: number; liteMembers: number } {
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
        if (!t.customRoleId) return false;
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

/**
 * Input for creating an admin invite (immediate PENDING status).
 */
interface CreateAdminInviteInput {
  email: string;
  role: OrganizationUserRole;
  organizationId: string;
  teamIds: string;
  teamAssignments?: TeamAssignmentInput[];
}

/**
 * One requested invite for the {@link InviteService.createInvites}
 * orchestrator. `teams` carries either built-in team roles, `CUSTOM` with a
 * `customRoleId`, or the `custom:{roleId}` string form the invite form sends;
 * `teamIds` is the legacy comma-separated form that assigns the default team
 * role for the organization role.
 */
interface CreateInvitesInviteInput {
  email: string;
  role: OrganizationUserRole;
  teamIds?: string;
  teams?: Array<{
    teamId: string;
    role: TeamUserRole | string;
    customRoleId?: string;
  }>;
}

/** The validated team side of one requested invite. */
interface ResolvedInviteTeams {
  teamAssignments: TeamAssignmentInput[];
  teamIdsString: string;
}

/**
 * Input for creating a member invite request (WAITING_APPROVAL status).
 */
interface CreateMemberInviteRequestInput {
  email: string;
  role: OrganizationUserRole;
  organizationId: string;
  teamIds: string;
  teamAssignments?: TeamAssignmentInput[];
  requestedBy: string;
}

/**
 * Input for creating a PAYMENT_PENDING invite (checkout flow).
 */
interface CreatePaymentPendingInviteInput {
  email: string;
  role: OrganizationUserRole;
  organizationId: string;
  teamIds: string;
  teamAssignments?: TeamAssignmentInput[];
  subscriptionId: string;
}

/**
 * Input for approving a WAITING_APPROVAL invite.
 */
interface ApproveInviteInput {
  inviteId: string;
  organizationId: string;
}

/**
 * Service that encapsulates invite creation, validation, and approval logic.
 * Extracted from the organization router to enable both admin and member invite flows.
 *
 * Dependencies are injected to follow DIP and enable testability.
 */
export class InviteService {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
    private readonly licenseRepo: ILicenseEnforcementRepository,
    private readonly planProvider: PlanProvider,
    private readonly roleService?: RoleService,
  ) {}

  /**
   * Factory method for creating InviteService with default dependencies.
   * Use this in production code for convenience.
   * Pass options.planProvider to override the default app singleton (useful in tests).
   *
   * planProvider is resolved lazily — callers that only use
   * invite-application methods (findPendingByOrgAndEmail, applyInvite,
   * findLandingProjectSlug, etc.) don't require the global App to be
   * initialized, so this factory is safe to call from unit-tested hooks
   * and from early-boot code paths.
   */
  static create(
    prisma: PrismaClient | Prisma.TransactionClient,
    options?: { planProvider?: PlanProvider },
  ): InviteService {
    const licenseRepo = new LicenseEnforcementRepository(prisma);
    const provider: PlanProvider = options?.planProvider ?? {
      getActivePlan: (params) => getApp().planProvider.getActivePlan(params),
    };
    const roleService = new RoleService(prisma);
    return new InviteService(prisma, licenseRepo, provider, roleService);
  }

  /**
   * Validates that an invite can be created:
   * - No duplicate invitations across PENDING, WAITING_APPROVAL, and PAYMENT_PENDING statuses
   * - Returns the existing invite if a duplicate is found (null if no duplicate)
   *
   * Case-insensitive on the address, like the membership check next door and
   * like `acceptInvite`'s own comparison: an exact match would let
   * `Alice@acme.com` and `alice@acme.com` both become pending invites for one
   * person, who could then accept both.
   */
  async checkDuplicateInvite({
    email,
    organizationId,
  }: {
    email: string;
    organizationId: string;
  }): Promise<OrganizationInvite | null> {
    return this.prisma.organizationInvite.findFirst({
      where: {
        email: { equals: email.trim(), mode: "insensitive" },
        organizationId,
        status: { in: ["PENDING", "WAITING_APPROVAL", "PAYMENT_PENDING"] },
        OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
      },
    });
  }

  /**
   * Refuses any address that already belongs to a member of this organization.
   *
   * Runs before the invites are written, and refuses the whole batch rather
   * than quietly dropping the offending row: an admin who typed five addresses
   * and got four invites with no comment on the fifth has been told nothing.
   *
   * Membership is by user, and an invite is by email, so the two are joined
   * through `User.email`. An address with no account cannot be a member yet, so
   * it is simply absent from the lookup.
   */
  async assertNotAlreadyMembers({
    emails,
    organizationId,
  }: {
    emails: string[];
    organizationId: string;
  }): Promise<void> {
    if (emails.length === 0) return;

    const existing = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        user: { email: { in: emails, mode: "insensitive" } },
      },
      select: { user: { select: { email: true } } },
    });

    if (existing) {
      // The stored address, not the typed one: it is the one shown in the
      // members table the admin is being sent back to.
      throw new AlreadyOrganizationMemberError(existing.user.email ?? "");
    }
  }

  /**
   * Validates that team IDs belong to the organization.
   * Returns the list of valid team IDs.
   */
  async validateTeamIds({
    teamIds,
    organizationId,
  }: {
    teamIds: string[];
    organizationId: string;
  }): Promise<string[]> {
    const validTeams = await this.prisma.team.findMany({
      where: {
        id: { in: teamIds },
        organizationId,
      },
      select: { id: true },
    });
    return validTeams.map((team) => team.id);
  }

  /**
   * Checks license member limits (counting both PENDING and WAITING_APPROVAL invites).
   * Throws FORBIDDEN if limits are exceeded.
   */
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

    const currentFullMembers =
      await this.licenseRepo.getMemberCount(organizationId);
    const currentMembersLite =
      await this.licenseRepo.getMembersLiteCount(organizationId);

    const customRoles = await this.prisma.customRole.findMany({
      where: { organizationId },
      select: { id: true, permissions: true },
    });
    const customRoleMap = new Map(
      customRoles.map((r) => [r.id, (r.permissions as string[] | null) ?? []]),
    );

    const { fullMembers: newFullMembers, liteMembers: newLiteMembers } =
      classifyInvitesByMemberType(newInvites, customRoleMap);

    if (!subscriptionLimits.overrideAddingLimitations) {
      if (currentFullMembers + newFullMembers > subscriptionLimits.maxMembers) {
        throw new LimitExceededError(
          "members",
          currentFullMembers,
          subscriptionLimits.maxMembers,
        );
      }
      if (
        currentMembersLite + newLiteMembers >
        subscriptionLimits.maxMembersLite
      ) {
        throw new LimitExceededError(
          "membersLite",
          currentMembersLite,
          subscriptionLimits.maxMembersLite,
        );
      }
    }
  }

  /**
   * A Lite Member seat allows the Viewer team role only, and a custom role
   * requires a full seat, so an invitation cannot be written promising more.
   * Refused here, where the admin choosing the roles can act on it; an
   * invitation stored before this rule is corrected at acceptance instead
   * (`resolveInviteTeamMemberships`).
   */
  private assertAssignmentsWithinInvitedSeat({
    role,
    teamAssignments,
  }: {
    role: OrganizationUserRole;
    teamAssignments?: TeamAssignmentInput[];
  }): void {
    if (role !== OrganizationUserRole.EXTERNAL) return;
    for (const assignment of teamAssignments ?? []) {
      if (assignment.customRoleId || assignment.role !== TeamUserRole.VIEWER) {
        throw new LiteMemberViewerOnlyError();
      }
    }
  }

  /**
   * Creates an invite record with PENDING status (DB-only, no email).
   * Use this inside transactions to avoid sending emails before commit.
   *
   * @returns The created invite and its organization (for email sending later)
   */
  async createAdminInviteRecord(
    input: CreateAdminInviteInput,
  ): Promise<{ invite: OrganizationInvite; organization: Organization }> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: input.organizationId },
    });

    if (!organization) {
      throw new OrganizationNotFoundError();
    }

    return { invite: await this.createInviteRow(input), organization };
  }

  /**
   * The pending invite row itself, with no organization lookup attached.
   *
   * Split out so a batch that has already loaded the organization writes each
   * row without re-reading it: {@link persistInvites} runs inside an
   * interactive transaction holding one connection, where fifty invites meant
   * fifty redundant reads of a row the caller was already holding.
   */
  private async createInviteRow(
    input: CreateAdminInviteInput,
  ): Promise<OrganizationInvite> {
    // Every writer of a pending invite passes through here, including the
    // batch path, so the seat rule is checked here rather than once per
    // caller: a Lite Member invited through the batch endpoint would
    // otherwise be promised a team role their seat cannot hold.
    this.assertAssignmentsWithinInvitedSeat(input);

    return this.prisma.organizationInvite.create({
      data: {
        email: input.email,
        inviteCode: nanoid(),
        expiration: new Date(Date.now() + INVITE_EXPIRATION_MS),
        organizationId: input.organizationId,
        teamIds: input.teamIds,
        teamAssignments:
          input.teamAssignments && input.teamAssignments.length > 0
            ? (input.teamAssignments as unknown as JsonArray)
            : undefined,
        role: input.role,
        status: "PENDING",
      },
    });
  }

  /**
   * Attempts to send an invite email, catching failures gracefully.
   * Returns whether the email was not sent (due to missing provider or error).
   */
  async trySendInviteEmail({
    email,
    organization,
    inviteCode,
  }: {
    email: string;
    organization: Organization;
    inviteCode: string;
  }): Promise<{ emailNotSent: boolean }> {
    if (!env.SENDGRID_API_KEY) {
      return { emailNotSent: true };
    }
    try {
      await sendInviteEmail({ email, organization, inviteCode });
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
   *
   * `validation` picks what happens to an invite that names an invalid team
   * or custom role. The invite form keeps `"lenient"`, which drops the
   * offending assignment or invite the way the tRPC router always has; the
   * API surface uses `"strict"`, which refuses the batch loudly, because a
   * provisioning tool that is silently given less than it asked for believes
   * the grant took effect.
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
    const prisma = this.requireRootClient();
    const isStrict = validation === "strict";

    const organization = await prisma.organization.findFirst({
      where: { id: organizationId },
      include: { members: true },
    });
    if (!organization) {
      throw new OrganizationNotFoundError();
    }

    // Before anything is written: inviting someone who is already a member
    // used to succeed silently, adding a pending invite beside the membership
    // it duplicated. Checked ahead of the licence limit so an admin who is at
    // their seat cap is told the real reason rather than being sold an
    // upgrade for a seat they already own.
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

    // Read-only validation outside the transaction.
    const preparedInvites = await Promise.all(
      invites.map((invite) =>
        this.prepareInvite({ organizationId, invite, isStrict }),
      ),
    );
    const validInvites = preparedInvites.filter(
      (invite): invite is NonNullable<typeof invite> => invite !== null,
    );

    // A personal workspace passes plain team validation because it does
    // belong to the organization, but an invite accepted against it would
    // hand a second person the workspace its owner was promised privacy in.
    // Refused loudly on every path, lenient mode included: this is an
    // invariant, not a strictness option (issue #6338).
    await assertNoPersonalTeamScope({
      client: prisma,
      scopes: validInvites.flatMap(
        (invite) =>
          invite.teamAssignments?.map((assignment) => ({
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: assignment.teamId,
          })) ?? [],
      ),
    });

    // Phase 1: DB operations in a transaction, no side effects.
    const createdRecords = await prisma.$transaction(
      (tx) =>
        this.persistInvites({
          tx,
          invites: validInvites,
          organization,
          isStrict,
        }),
      {
        timeout: INVITE_BATCH_TXN_TIMEOUT_MS,
        maxWait: INVITE_BATCH_TXN_MAX_WAIT_MS,
      },
    );

    // Phase 2: emails outside the transaction, so a provider failure can
    // never roll back a committed invite.
    const results = await Promise.all(
      createdRecords.map(async (record) => {
        const { emailNotSent } = await this.trySendInviteEmail({
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
   * Writes the prepared invites inside the caller's transaction, skipping the
   * ones an existing invite already covers (or refusing them in strict mode).
   *
   * One invite at a time: an interactive transaction holds a single
   * connection, so a parallel fan-out would not run in parallel anyway, and it
   * would let two invites for the same address in one batch both read "no
   * duplicate" and both be written.
   *
   * `organization` is the row the caller already loaded, paired with every
   * invite for the email phase, so a fifty-invite batch does not re-read it
   * fifty times on the transaction's one connection.
   */
  private async persistInvites({
    tx,
    invites,
    organization,
    isStrict,
  }: {
    tx: Prisma.TransactionClient;
    invites: CreateAdminInviteInput[];
    organization: Organization;
    isStrict: boolean;
  }): Promise<
    Array<{ invite: OrganizationInvite; organization: Organization }>
  > {
    const txInviteService = InviteService.create(tx, {
      planProvider: this.planProvider,
    });
    const records: Array<{
      invite: OrganizationInvite;
      organization: Organization;
    }> = [];

    for (const invite of invites) {
      const existingInvite = await txInviteService.checkDuplicateInvite({
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
   * `createAdminInviteRecord` persists. Returns null when lenient validation
   * drops the invite entirely (no valid teams, blank email, or an invalid
   * custom role).
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
    const resolvedTeams = await this.resolveInviteTeams({
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
      // typed: `checkDuplicateInvite` and `findPendingByOrgAndEmail` both miss
      // a row written as " a@b.com ", so the duplicate check never fires and
      // SSO onboarding never finds the invite it should adopt.
      email,
      role: invite.role,
      organizationId,
      teamIds: resolvedTeams.teamIdsString,
      teamAssignments:
        resolvedTeams.teamAssignments.length > 0
          ? resolvedTeams.teamAssignments
          : undefined,
    };
  }

  /**
   * The team side of one requested invite, from whichever form the request
   * used: explicit team role entries, or the legacy comma-separated team id
   * list. Returns null when the invite names no teams at all, or when
   * lenient validation drops it entirely.
   */
  private async resolveInviteTeams({
    organizationId,
    invite,
    isStrict,
  }: {
    organizationId: string;
    invite: CreateInvitesInviteInput;
    isStrict: boolean;
  }): Promise<ResolvedInviteTeams | null> {
    if (invite.teams && invite.teams.length > 0) {
      return this.resolveExplicitInviteTeams({
        organizationId,
        teams: invite.teams,
        isStrict,
      });
    }
    if (invite.teamIds?.trim()) {
      return this.resolveLegacyInviteTeams({
        organizationId,
        teamIds: invite.teamIds,
        role: invite.role,
        isStrict,
      });
    }
    return null;
  }

  /**
   * Resolves explicit team role entries: the teams must belong to the
   * organization, custom-role forms are normalized, and the custom roles
   * must be assignable. Returns null when lenient validation drops the
   * invite (no valid teams, or an invalid custom role).
   */
  private async resolveExplicitInviteTeams({
    organizationId,
    teams,
    isStrict,
  }: {
    organizationId: string;
    teams: NonNullable<CreateInvitesInviteInput["teams"]>;
    isStrict: boolean;
  }): Promise<ResolvedInviteTeams | null> {
    const teamIds = teams.map((team) => team.teamId);
    const validTeamIds = await this.validateTeamIds({
      teamIds,
      organizationId,
    });

    if (isStrict) {
      this.assertAllTeamIdsValid({ requestedTeamIds: teamIds, validTeamIds });
    }
    if (validTeamIds.length === 0) {
      return null;
    }

    const teamAssignments = this.normalizeTeamAssignments({
      teams,
      validTeamIds,
      isStrict,
    });

    const customRolesValid = await this.validateInviteCustomRoles({
      organizationId,
      teamAssignments,
      isStrict,
    });
    if (!customRolesValid) {
      return null;
    }

    return { teamAssignments, teamIdsString: validTeamIds.join(",") };
  }

  /**
   * Resolves the legacy comma-separated team id form: each valid team gets
   * the default team role for the invite's organization role. Returns null
   * when lenient validation leaves no valid teams.
   */
  private async resolveLegacyInviteTeams({
    organizationId,
    teamIds,
    role,
    isStrict,
  }: {
    organizationId: string;
    teamIds: string;
    role: OrganizationUserRole;
    isStrict: boolean;
  }): Promise<ResolvedInviteTeams | null> {
    const teamIdArray = teamIds
      .split(",")
      .map((teamId) => teamId.trim())
      .filter(Boolean);

    const validTeamIds = await this.validateTeamIds({
      teamIds: teamIdArray,
      organizationId,
    });

    if (isStrict) {
      this.assertAllTeamIdsValid({
        requestedTeamIds: teamIdArray,
        validTeamIds,
      });
    }
    if (validTeamIds.length === 0) {
      return null;
    }

    return {
      teamAssignments: validTeamIds.map((teamId) => ({
        teamId,
        role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
      })),
      teamIdsString: validTeamIds.join(","),
    };
  }

  /** Refuses the first requested team id that is not in the organization. */
  private assertAllTeamIdsValid({
    requestedTeamIds,
    validTeamIds,
  }: {
    requestedTeamIds: string[];
    validTeamIds: string[];
  }): void {
    const invalidTeamId = requestedTeamIds.find(
      (teamId) => !validTeamIds.includes(teamId),
    );
    if (invalidTeamId) {
      throw new TeamNotInOrganizationError(invalidTeamId);
    }
  }

  /**
   * Narrows explicit team role entries to valid teams only, folding the
   * `custom:{roleId}` string form and `CUSTOM` into TeamUserRole.CUSTOM. An
   * assignment naming a custom role without its id is refused in strict
   * mode and dropped in lenient mode.
   */
  private normalizeTeamAssignments({
    teams,
    validTeamIds,
    isStrict,
  }: {
    teams: NonNullable<CreateInvitesInviteInput["teams"]>;
    validTeamIds: string[];
    isStrict: boolean;
  }): TeamAssignmentInput[] {
    return teams
      .filter((team) => validTeamIds.includes(team.teamId))
      .map((team) => {
        const isCustomString =
          typeof team.role === "string" && isCustomRole(team.role);
        const isCustom = isCustomString || team.role === TeamUserRole.CUSTOM;
        return {
          teamId: team.teamId,
          role: isCustom ? TeamUserRole.CUSTOM : (team.role as TeamUserRole),
          customRoleId:
            isCustom && team.customRoleId ? team.customRoleId : undefined,
        };
      })
      .filter((team) => {
        if (team.role === TeamUserRole.CUSTOM && !team.customRoleId) {
          if (isStrict) {
            throw new CustomRoleIdRequiredError();
          }
          return false;
        }
        return true;
      });
  }

  /**
   * True when every custom role named by these assignments is assignable in
   * this organization. In strict mode an invalid custom role is refused
   * instead; in lenient mode the caller drops the whole invite.
   */
  private async validateInviteCustomRoles({
    organizationId,
    teamAssignments,
    isStrict,
  }: {
    organizationId: string;
    teamAssignments: TeamAssignmentInput[];
    isStrict: boolean;
  }): Promise<boolean> {
    const customRoleIds = teamAssignments
      .filter((team) => team.customRoleId)
      .map((team) => team.customRoleId!);
    if (customRoleIds.length === 0) {
      return true;
    }

    // Through the role service, which is where assignability is defined: an
    // invite validated against a different rule than `applyInvite` applies
    // would be accepted here and silently dropped on acceptance.
    const roleService = this.roleService ?? new RoleService(this.prisma);
    const validCustomRoleIds = new Set(
      await roleService.filterAssignableRoleIds({
        roleIds: customRoleIds,
        organizationId,
      }),
    );
    const invalidRoleId = customRoleIds.find(
      (id) => !validCustomRoleIds.has(id),
    );
    if (invalidRoleId) {
      if (isStrict) {
        throw new CustomRoleNotAssignableError(invalidRoleId);
      }
      return false;
    }
    return true;
  }

  /**
   * Pending and approval-waiting invites with the acceptance link each one
   * carries. The link is included because a provisioning tool with no email
   * provider configured has no other way to hand the invite to the person.
   */
  async listInvites({ organizationId }: { organizationId: string }): Promise<
    Array<
      OrganizationInvite & {
        inviteUrl: string;
        requestedByUser: {
          id: string;
          name: string | null;
          email: string | null;
        } | null;
      }
    >
  > {
    const invites = await this.prisma.organizationInvite.findMany({
      where: {
        organizationId,
        status: { in: ["PENDING", "WAITING_APPROVAL"] },
        OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
      },
      include: {
        requestedByUser: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return invites.map((invite) => ({
      ...invite,
      inviteUrl: buildInviteAcceptUrl(invite.inviteCode),
    }));
  }

  /**
   * Deletes a pending invite. Organization-scoped: an invite id from another
   * organization reads as not found, never as someone else's invite.
   */
  async revokeInvite({
    organizationId,
    inviteId,
  }: {
    organizationId: string;
    inviteId: string;
  }): Promise<{ success: true }> {
    const invite = await this.prisma.organizationInvite.findFirst({
      where: { id: inviteId, organizationId },
      select: { id: true },
    });
    if (!invite) {
      throw new InviteNotFoundError("Invitation not found");
    }
    await this.prisma.organizationInvite.delete({
      where: { id: invite.id, organizationId },
    });
    return { success: true };
  }

  /**
   * The orchestrators open their own transaction, so they cannot run on a
   * `TransactionClient`; everything else in this service can.
   */
  private requireRootClient(): PrismaClient {
    if (!isRootPrismaClient(this.prisma)) {
      throw new Error(
        "This orchestration requires a root Prisma client, not a transaction client",
      );
    }
    return this.prisma;
  }

  /**
   * Creates an invite request with WAITING_APPROVAL status (member flow).
   * No expiration is set, and no email is sent.
   * Tracks the requestedBy user ID.
   */
  async createMemberInviteRequest(
    input: CreateMemberInviteRequestInput,
  ): Promise<{ invite: OrganizationInvite }> {
    this.assertAssignmentsWithinInvitedSeat(input);
    const existingInvite = await this.checkDuplicateInvite({
      email: input.email,
      organizationId: input.organizationId,
    });

    if (existingInvite) {
      throw new DuplicateInviteError(input.email);
    }

    const inviteCode = nanoid();

    const savedInvite = await this.prisma.organizationInvite.create({
      data: {
        email: input.email,
        inviteCode,
        expiration: null,
        organizationId: input.organizationId,
        teamIds: input.teamIds,
        teamAssignments:
          input.teamAssignments && input.teamAssignments.length > 0
            ? (input.teamAssignments as unknown as JsonArray)
            : undefined,
        role: input.role,
        status: "WAITING_APPROVAL",
        requestedBy: input.requestedBy,
      },
    });

    return { invite: savedInvite };
  }

  /**
   * Approves a WAITING_APPROVAL invite:
   * - Transitions status to PENDING
   * - Sets 48-hour expiration
   * - Attempts to send invitation email (failure does not revert approval)
   */
  async approveInvite(
    input: ApproveInviteInput,
  ): Promise<{ invite: OrganizationInvite; emailNotSent: boolean }> {
    const invite = await this.prisma.organizationInvite.findFirst({
      where: {
        id: input.inviteId,
        organizationId: input.organizationId,
        status: "WAITING_APPROVAL",
      },
      include: { organization: true },
    });

    if (!invite) {
      throw new InviteNotFoundError();
    }

    if (!invite.organization) {
      throw new OrganizationNotFoundError();
    }

    const updatedInvite = await this.prisma.organizationInvite.update({
      where: { id: invite.id, organizationId: input.organizationId },
      data: {
        status: "PENDING",
        expiration: new Date(Date.now() + INVITE_EXPIRATION_MS),
      },
    });

    const { emailNotSent } = await this.trySendInviteEmail({
      email: invite.email,
      organization: invite.organization,
      inviteCode: invite.inviteCode,
    });

    return { invite: updatedInvite, emailNotSent };
  }

  /**
   * Creates an invite with PAYMENT_PENDING status (checkout flow).
   * No expiration, no email — waits for Stripe checkout success.
   */
  async createPaymentPendingInvite(
    input: CreatePaymentPendingInviteInput,
  ): Promise<OrganizationInvite> {
    this.assertAssignmentsWithinInvitedSeat(input);
    const inviteCode = nanoid();

    return this.prisma.organizationInvite.create({
      data: {
        email: input.email,
        inviteCode,
        expiration: null,
        organizationId: input.organizationId,
        teamIds: input.teamIds,
        teamAssignments:
          input.teamAssignments && input.teamAssignments.length > 0
            ? (input.teamAssignments as unknown as JsonArray)
            : undefined,
        role: input.role,
        status: "PAYMENT_PENDING",
        subscriptionId: input.subscriptionId,
      },
    });
  }

  /**
   * Finds the best project slug to redirect to after accepting an invite.
   * Tries the first assigned team first, then falls back to any non-archived
   * project in the org so the client can land directly in the app rather than
   * hitting the onboarding flow.
   */
  async findLandingProjectSlug(
    invite: OrganizationInvite,
  ): Promise<string | null> {
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
        ? await this.prisma.project.findFirst({
            where: { teamId: { in: invitedTeamIds }, archivedAt: null },
            select: { slug: true },
          })
        : null) ??
      // Org-wide fallback only for roles with broad access (ADMIN/MEMBER)
      (invite.role === OrganizationUserRole.ADMIN ||
      invite.role === OrganizationUserRole.MEMBER
        ? await this.prisma.project.findFirst({
            where: {
              team: { organizationId: invite.organizationId, archivedAt: null },
              archivedAt: null,
            },
            select: { slug: true },
          })
        : null);

    return project?.slug ?? null;
  }

  /**
   * Finds a PENDING, non-expired invite matching the given organization and
   * email (case-insensitive). Returns null when no such invite exists.
   *
   * Used by the SSO auto-onboarding hook so a new signup whose domain matches
   * an SSO-enforced org adopts the invite's role + team assignments rather
   * than the default MEMBER, and the invite gets marked ACCEPTED instead of
   * lingering as an outstanding link.
   */
  async findPendingByOrgAndEmail({
    organizationId,
    email,
  }: {
    organizationId: string;
    email: string;
  }): Promise<OrganizationInvite | null> {
    return this.prisma.organizationInvite.findFirst({
      where: {
        organizationId,
        email: { equals: email, mode: "insensitive" },
        status: "PENDING",
        OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
      },
    });
  }

  /**
   * Applies a PENDING invite to a user: writes OrganizationUser, the
   * ORGANIZATION-scoped RoleBinding (skipped for EXTERNAL — they get access
   * via team/project bindings), each team's RoleBinding, and marks the invite
   * ACCEPTED. All writes are idempotent — OrganizationUser uses
   * createMany+skipDuplicates, RoleBindings use delete-then-create to tolerate
   * prior partial state — so callers can safely retry on transient failure.
   *
   * Must be called with a TransactionClient: the four write groups must
   * commit or roll back together to avoid the "in-org-but-no-RoleBinding"
   * stuck state that originally motivated this helper.
   */
  async applyInvite({
    userId,
    invite,
  }: {
    userId: string;
    invite: OrganizationInvite;
  }): Promise<void> {
    if (invite.status !== "PENDING") {
      throw new InviteNotReadyError(invite.id, invite.status);
    }

    await this.prisma.organizationUser.createMany({
      data: [
        {
          userId,
          organizationId: invite.organizationId,
          role: invite.role,
        },
      ],
      skipDuplicates: true,
    });

    if (invite.role !== OrganizationUserRole.EXTERNAL) {
      await this.prisma.roleBinding.deleteMany({
        where: {
          organizationId: invite.organizationId,
          userId,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: invite.organizationId,
        },
      });
      await this.prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: invite.organizationId,
          userId,
          role: invite.role as unknown as TeamUserRole,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: invite.organizationId,
        },
      });
    }

    let teamMembershipData = resolveInviteTeamMemberships({
      role: invite.role,
      teamIds: invite.teamIds,
      teamAssignments: invite.teamAssignments,
    });

    if (this.roleService) {
      const customRoleIds = teamMembershipData
        .filter((m) => m.role === TeamUserRole.CUSTOM && m.customRoleId)
        .map((m) => m.customRoleId!);
      if (customRoleIds.length > 0) {
        const validRoles = await this.roleService.filterAssignableRoleIds({
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
        teamMembershipData = teamMembershipData.filter(
          (m) => !m.customRoleId || validIds.has(m.customRoleId),
        );
      }
    }

    for (const member of teamMembershipData) {
      await this.prisma.roleBinding.deleteMany({
        where: {
          organizationId: invite.organizationId,
          userId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: member.teamId,
        },
      });
      await this.prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: invite.organizationId,
          userId,
          role: member.role,
          customRoleId: member.customRoleId ?? null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: member.teamId,
        },
      });
    }

    await this.prisma.organizationInvite.update({
      where: { id: invite.id, organizationId: invite.organizationId },
      data: { status: "ACCEPTED" },
    });
  }

  /**
   * Approves all PAYMENT_PENDING invites for a given subscription:
   * - Transitions each to PENDING with 48-hour expiration
   * - Sends invite emails
   */
  async approvePaymentPendingInvites({
    subscriptionId,
    organizationId,
  }: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<OrganizationInvite[]> {
    const invites = await this.prisma.organizationInvite.findMany({
      where: {
        subscriptionId,
        organizationId,
        status: "PAYMENT_PENDING",
      },
      include: { organization: true },
    });

    const approved: OrganizationInvite[] = [];

    for (const invite of invites) {
      const updatedInvite = await this.prisma.organizationInvite.update({
        where: { id: invite.id, organizationId },
        data: {
          status: "PENDING",
          expiration: new Date(Date.now() + INVITE_EXPIRATION_MS),
        },
      });

      if (invite.organization) {
        await this.trySendInviteEmail({
          email: invite.email,
          organization: invite.organization,
          inviteCode: invite.inviteCode,
        });
      }

      approved.push(updatedInvite);
    }

    return approved;
  }
}
