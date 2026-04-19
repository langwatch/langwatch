import {
  type Organization,
  type OrganizationInvite,
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  DuplicateInviteError,
  InviteNotFoundError,
  OrganizationNotFoundError,
} from "./errors";
import { LimitExceededError } from "../license-enforcement/errors";
import { nanoid } from "nanoid";
import type { JsonArray } from "@prisma/client/runtime/library";

/** Duration in milliseconds before an invite expires (48 hours). */
export const INVITE_EXPIRATION_MS = 2 * 24 * 60 * 60 * 1000;

/** Mapping from organization roles to default team roles. */
export const ORGANIZATION_TO_TEAM_ROLE_MAP: Record<
  OrganizationUserRole,
  TeamUserRole
> = {
  [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
  [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
  [OrganizationUserRole.EXTERNAL]: TeamUserRole.VIEWER,
} as const;

import { env } from "~/env.mjs";
import {
  isViewOnlyCustomRole,
  type ILicenseEnforcementRepository,
  LicenseEnforcementRepository,
} from "../license-enforcement/license-enforcement.repository";
import { sendInviteEmail } from "../mailer/inviteEmail";
import { TeamUserRole } from "@prisma/client";
import type { Session } from "~/server/auth";
import type { PlanProvider } from "../app-layer/subscription/plan-provider";
import { getApp } from "../app-layer/app";
import { createLogger } from "~/utils/logger";

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
export function classifyInvitesByMemberType(
  invites: Array<{
    role: OrganizationUserRole;
    teams?: Array<{ customRoleId?: string }>;
  }>,
  customRoleMap: Map<string, string[]>
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
    private readonly planProvider: PlanProvider
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
    options?: { planProvider?: PlanProvider }
  ): InviteService {
    const licenseRepo = new LicenseEnforcementRepository(prisma);
    const provider: PlanProvider = options?.planProvider ?? {
      getActivePlan: (params) => getApp().planProvider.getActivePlan(params),
    };
    return new InviteService(prisma, licenseRepo, provider);
  }

  /**
   * Validates that an invite can be created:
   * - No duplicate invitations across PENDING, WAITING_APPROVAL, and PAYMENT_PENDING statuses
   * - Returns the existing invite if a duplicate is found (null if no duplicate)
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
        email,
        organizationId,
        status: { in: ["PENDING", "WAITING_APPROVAL", "PAYMENT_PENDING"] },
        OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
      },
    });
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
    user: Session["user"];
  }): Promise<void> {
    const subscriptionLimits = await this.planProvider.getActivePlan({
      organizationId,
      user,
    });

    const currentFullMembers = await this.licenseRepo.getMemberCount(
      organizationId
    );
    const currentMembersLite = await this.licenseRepo.getMembersLiteCount(
      organizationId
    );

    const customRoles = await this.prisma.customRole.findMany({
      where: { organizationId },
      select: { id: true, permissions: true },
    });
    const customRoleMap = new Map(
      customRoles.map((r) => [r.id, (r.permissions as string[] | null) ?? []])
    );

    const { fullMembers: newFullMembers, liteMembers: newLiteMembers } =
      classifyInvitesByMemberType(newInvites, customRoleMap);

    if (!subscriptionLimits.overrideAddingLimitations) {
      if (
        currentFullMembers + newFullMembers >
        subscriptionLimits.maxMembers
      ) {
        throw new LimitExceededError(
          "members",
          currentFullMembers,
          subscriptionLimits.maxMembers
        );
      }
      if (
        currentMembersLite + newLiteMembers >
        subscriptionLimits.maxMembersLite
      ) {
        throw new LimitExceededError(
          "membersLite",
          currentMembersLite,
          subscriptionLimits.maxMembersLite
        );
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
    input: CreateAdminInviteInput
  ): Promise<{ invite: OrganizationInvite; organization: Organization }> {
    const inviteCode = nanoid();

    const organization = await this.prisma.organization.findFirst({
      where: { id: input.organizationId },
    });

    if (!organization) {
      throw new OrganizationNotFoundError();
    }

    const savedInvite = await this.prisma.organizationInvite.create({
      data: {
        email: input.email,
        inviteCode,
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

    return { invite: savedInvite, organization };
  }

  /**
   * Attempts to send an invite email, catching failures gracefully.
   * Returns whether the email was not sent (due to missing provider or error).
   */
  async trySendInviteEmail({ email, organization, inviteCode }: {
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
   * Creates an invite request with WAITING_APPROVAL status (member flow).
   * No expiration is set, and no email is sent.
   * Tracks the requestedBy user ID.
   */
  async createMemberInviteRequest(
    input: CreateMemberInviteRequestInput
  ): Promise<{ invite: OrganizationInvite }> {
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
    input: ApproveInviteInput
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
    input: CreatePaymentPendingInviteInput
  ): Promise<OrganizationInvite> {
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
  async findLandingProjectSlug(invite: OrganizationInvite): Promise<string | null> {
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
      (invite.role === OrganizationUserRole.ADMIN || invite.role === OrganizationUserRole.MEMBER
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

    let teamMembershipData: Array<{
      teamId: string;
      role: TeamUserRole;
      customRoleId?: string;
    }> = [];

    if (invite.teamAssignments && Array.isArray(invite.teamAssignments)) {
      const assignments = invite.teamAssignments as unknown as Array<{
        teamId: string;
        role: TeamUserRole;
        customRoleId?: string;
      }>;
      teamMembershipData = assignments.map((a) => ({
        teamId: a.teamId,
        role: a.role,
        customRoleId: a.customRoleId,
      }));
    } else {
      const dedupedTeamIds = Array.from(
        new Set(
          invite.teamIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      );
      teamMembershipData = dedupedTeamIds.map((teamId) => ({
        teamId,
        role: ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role],
      }));
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
