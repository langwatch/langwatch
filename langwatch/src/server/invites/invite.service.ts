import {
  type OrganizationInvite,
  OrganizationUserRole,
  type PrismaClient,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import type { JsonArray } from "@prisma/client/runtime/library";

import { env } from "~/env.mjs";
import {
  isViewOnlyCustomRole,
  LicenseEnforcementRepository,
} from "../license-enforcement/license-enforcement.repository";
import { LICENSE_LIMIT_ERRORS } from "../license-enforcement/license-limit-guard";
import { sendInviteEmail } from "../mailer/inviteEmail";
import { dependencies } from "../../injection/dependencies.server";
import type { TeamUserRole } from "@prisma/client";
import type { Session } from "next-auth";

/**
 * Team assignment input for invite creation.
 */
interface TeamAssignmentInput {
  teamId: string;
  role: TeamUserRole;
  customRoleId?: string;
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
 * Input for approving a WAITING_APPROVAL invite.
 */
interface ApproveInviteInput {
  inviteId: string;
  organizationId: string;
}

/**
 * Service that encapsulates invite creation, validation, and approval logic.
 * Extracted from the organization router to enable both admin and member invite flows.
 */
export class InviteService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Validates that an invite can be created:
   * - No duplicate invitations across PENDING and WAITING_APPROVAL statuses
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
        status: { in: ["PENDING", "WAITING_APPROVAL"] },
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
    const subscriptionLimits =
      await dependencies.subscriptionHandler.getActivePlan(
        organizationId,
        user
      );

    const licenseRepo = new LicenseEnforcementRepository(this.prisma);
    const currentFullMembers = await licenseRepo.getMemberCount(organizationId);
    const currentMembersLite =
      await licenseRepo.getMembersLiteCount(organizationId);

    const customRoles = await this.prisma.customRole.findMany({
      where: { organizationId },
      select: { id: true, permissions: true },
    });
    const customRoleMap = new Map(
      customRoles.map((r) => [r.id, r.permissions as string[]])
    );

    let newFullMembers = 0;
    let newLiteMembers = 0;

    for (const invite of newInvites) {
      if (
        invite.role === OrganizationUserRole.ADMIN ||
        invite.role === OrganizationUserRole.MEMBER
      ) {
        newFullMembers++;
      } else if (invite.role === OrganizationUserRole.EXTERNAL) {
        const hasNonViewRole = invite.teams?.some((t) => {
          if (!t.customRoleId) return false;
          const permissions = customRoleMap.get(t.customRoleId);
          return permissions && !isViewOnlyCustomRole(permissions);
        });
        if (hasNonViewRole) {
          newFullMembers++;
        } else {
          newLiteMembers++;
        }
      }
    }

    if (!subscriptionLimits.overrideAddingLimitations) {
      if (
        currentFullMembers + newFullMembers >
        subscriptionLimits.maxMembers
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: LICENSE_LIMIT_ERRORS.FULL_MEMBER_LIMIT,
        });
      }
      if (
        currentMembersLite + newLiteMembers >
        subscriptionLimits.maxMembersLite
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: LICENSE_LIMIT_ERRORS.MEMBER_LITE_LIMIT,
        });
      }
    }
  }

  /**
   * Creates a direct invite with PENDING status (admin flow).
   * Sets 48-hour expiration and sends invitation email.
   */
  async createAdminInvite(
    input: CreateAdminInviteInput
  ): Promise<{ invite: OrganizationInvite; noEmailProvider: boolean }> {
    const inviteCode = nanoid();

    const organization = await this.prisma.organization.findFirst({
      where: { id: input.organizationId },
    });

    if (!organization) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization not found",
      });
    }

    const savedInvite = await this.prisma.organizationInvite.create({
      data: {
        email: input.email,
        inviteCode,
        expiration: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 48 hours
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

    if (env.SENDGRID_API_KEY) {
      await sendInviteEmail({
        email: input.email,
        organization,
        inviteCode,
      });
    }

    return {
      invite: savedInvite,
      noEmailProvider: !env.SENDGRID_API_KEY,
    };
  }

  /**
   * Creates an invite request with WAITING_APPROVAL status (member flow).
   * No expiration is set, and no email is sent.
   * Tracks the requestedBy user ID.
   */
  async createMemberInviteRequest(
    input: CreateMemberInviteRequestInput
  ): Promise<{ invite: OrganizationInvite }> {
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
   * - Sends invitation email
   */
  async approveInvite(
    input: ApproveInviteInput
  ): Promise<{ invite: OrganizationInvite }> {
    const invite = await this.prisma.organizationInvite.findFirst({
      where: {
        id: input.inviteId,
        organizationId: input.organizationId,
        status: "WAITING_APPROVAL",
      },
    });

    if (!invite) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invitation not found or is not waiting for approval",
      });
    }

    const organization = await this.prisma.organization.findFirst({
      where: { id: input.organizationId },
    });

    if (!organization) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    const updatedInvite = await this.prisma.organizationInvite.update({
      where: { id: invite.id, organizationId: input.organizationId },
      data: {
        status: "PENDING",
        expiration: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 48 hours
      },
    });

    if (env.SENDGRID_API_KEY) {
      await sendInviteEmail({
        email: invite.email,
        organization,
        inviteCode: invite.inviteCode,
      });
    }

    return { invite: updatedInvite };
  }
}
