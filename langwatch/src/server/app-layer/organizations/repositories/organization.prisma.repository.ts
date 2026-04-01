import {
  OrganizationUserRole,
  PricingModel,
  TeamUserRole,
  type Currency,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { GROWTH_SEAT_PLAN_TYPES } from "../../../../../ee/billing/utils/growthSeatEvent";
import { encrypt } from "~/utils/encryption";
import {
  isTeamRoleAllowedForOrganizationRole,
  type TeamRoleValue,
} from "~/utils/memberRoleConstraints";
import { isCustomRole } from "../../../api/enterprise";
import { LITE_MEMBER_VIEWER_ONLY_ERROR } from "../compute-effective-team-role-updates";
import type { OrganizationFeatureName } from "../organization.service";
import type {
  AuditLogFilters,
  CreateAndAssignInput,
  CreateAndAssignResult,
  DeleteMemberInput,
  EnrichedAuditLog,
  FullyLoadedOrganization,
  OrganizationFeatureRow,
  OrganizationForBilling,
  OrganizationMemberWithUser,
  OrganizationRepository,
  OrganizationWithAdmins,
  OrganizationWithMembersAndTheirTeams,
  UpdateMemberRoleInput,
  UpdateOrganizationInput,
  UpdateTeamMemberRoleInput,
} from "./organization.repository";
import type { User } from "@prisma/client";

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrganizationIdByTeamId(teamId: string): Promise<string | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }

  async getProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  async getFeature(
    organizationId: string,
    feature: OrganizationFeatureName,
  ): Promise<OrganizationFeatureRow | null> {
    return this.prisma.organizationFeature.findUnique({
      where: {
        feature_organizationId: { feature, organizationId },
      },
    });
  }

  async findWithAdmins(
    organizationId: string,
  ): Promise<OrganizationWithAdmins | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        members: {
          where: { role: "ADMIN" },
          include: {
            user: true,
          },
        },
      },
    }) as Promise<OrganizationWithAdmins | null>;
  }

  async updateSentPlanLimitAlert(
    organizationId: string,
    timestamp: Date,
  ): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { sentPlanLimitAlert: timestamp },
    });
  }

  async findProjectsWithName(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async clearTrialLicense(organizationId: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
    });
  }

  async updateCurrency(input: {
    organizationId: string;
    currency: string;
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: input.organizationId },
      data: { currency: input.currency as Currency },
    });
  }

  async getPricingModel(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return org?.pricingModel ?? null;
  }

  async getStripeCustomerId(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });
    return org?.stripeCustomerId ?? null;
  }

  async findNameById(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    return org ?? null;
  }

  async getOrganizationForBilling(
    organizationId: string,
  ): Promise<OrganizationForBilling | null> {
    return this.prisma.organization.findFirst({
      where: { id: organizationId, pricingModel: PricingModel.SEAT_EVENT },
      select: {
        id: true,
        stripeCustomerId: true,
        subscriptions: {
          where: {
            status: "ACTIVE",
            plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
          },
          take: 1,
          select: { id: true },
          orderBy: { startDate: "desc" },
        },
      },
    });
  }

  async createAndAssign(
    input: CreateAndAssignInput,
  ): Promise<CreateAndAssignResult> {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          id: input.orgId,
          name: input.orgName,
          slug: input.orgSlug,
          phoneNumber: input.phoneNumber,
          signupData: input.signUpData as Prisma.InputJsonValue | undefined,
          pricingModel: input.pricingModel,
        },
      });

      await tx.organizationUser.create({
        data: {
          userId: input.userId,
          organizationId: organization.id,
          role: "ADMIN",
        },
      });

      const team = await tx.team.create({
        data: {
          id: input.teamId,
          name: input.orgName,
          slug: input.teamSlug,
          organizationId: organization.id,
        },
      });

      await tx.teamUser.create({
        data: {
          userId: input.userId,
          teamId: team.id,
          role: "ADMIN",
        },
      });

      return {
        organization: { id: organization.id, name: organization.name },
        team: { id: team.id, slug: team.slug, name: team.name },
      };
    });
  }

  async getAllForUser(params: {
    userId: string;
    isDemo: boolean;
    demoProjectUserId: string;
    demoProjectId: string;
  }): Promise<FullyLoadedOrganization[]> {
    const { userId, isDemo, demoProjectId } = params;

    return this.prisma.organization.findMany({
      where: {
        OR: [
          ...(isDemo
            ? [
                {
                  teams: {
                    some: {
                      archivedAt: null,
                      projects: {
                        some: { id: demoProjectId },
                      },
                    },
                  },
                },
              ]
            : []),
          {
            members: {
              some: {
                userId,
              },
            },
          },
        ],
      },
      include: {
        members: {
          where: {
            userId,
          },
        },
        features: true,
        teams: {
          where: {
            archivedAt: null,
          },
          include: {
            members: {
              include: {
                assignedRole: true,
              },
            },
            projects: {
              where: {
                archivedAt: null,
              },
            },
          },
        },
      },
    }) as Promise<FullyLoadedOrganization[]>;
  }

  async getOrganizationWithMembers(params: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null> {
    const { organizationId, userId, includeDeactivated } = params;

    return this.prisma.organization.findFirst({
      where: {
        id: organizationId,
        members: {
          some: {
            userId,
          },
        },
      },
      include: {
        members: {
          ...(!includeDeactivated
            ? { where: { user: { deactivatedAt: null } } }
            : {}),
          include: {
            user: {
              include: {
                teamMemberships: {
                  where: { team: { archivedAt: null } },
                  include: {
                    team: true,
                    assignedRole: true,
                  },
                },
              },
            },
          },
        },
      },
    }) as Promise<OrganizationWithMembersAndTheirTeams | null>;
  }

  async getMemberById(params: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null> {
    const { organizationId, userId, currentUserId } = params;

    const currentUserMembership =
      await this.prisma.organizationUser.findFirst({
        where: {
          organizationId,
          userId: currentUserId,
        },
      });

    if (!currentUserMembership) {
      return null;
    }

    return this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId,
      },
      include: {
        user: {
          include: {
            teamMemberships: {
              where: { team: { archivedAt: null } },
              include: {
                team: true,
                assignedRole: true,
              },
            },
          },
        },
      },
    }) as Promise<OrganizationMemberWithUser | null>;
  }

  async getAllMembers(organizationId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        deactivatedAt: null,
        orgMemberships: {
          some: {
            organizationId,
          },
        },
      },
    });
  }

  async update(input: UpdateOrganizationInput): Promise<void> {
    await this.prisma.organization.update({
      where: { id: input.organizationId },
      data: {
        name: input.name,
        s3Endpoint: input.s3Endpoint ? encrypt(input.s3Endpoint) : null,
        s3AccessKeyId: input.s3AccessKeyId
          ? encrypt(input.s3AccessKeyId)
          : null,
        s3SecretAccessKey: input.s3SecretAccessKey
          ? encrypt(input.s3SecretAccessKey)
          : null,
        elasticsearchNodeUrl: input.elasticsearchNodeUrl
          ? encrypt(input.elasticsearchNodeUrl)
          : null,
        elasticsearchApiKey: input.elasticsearchApiKey
          ? encrypt(input.elasticsearchApiKey)
          : null,
        s3Bucket: input.s3Bucket,
      },
    });
  }

  async deleteMember(input: DeleteMemberInput): Promise<void> {
    const { organizationId, userId } = input;

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationUser.delete({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
      });
      await tx.teamUser.deleteMany({
        where: {
          userId,
          team: {
            organizationId,
          },
        },
      });
    });
  }

  async updateMemberRole(input: UpdateMemberRoleInput): Promise<void> {
    const {
      organizationId,
      userId,
      role,
      effectiveTeamRoleUpdates,
    } = input;

    await this.prisma.$transaction(async (tx) => {
      const currentMember = await tx.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
      });

      if (!currentMember) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      if (
        role !== OrganizationUserRole.ADMIN &&
        currentMember.role === OrganizationUserRole.ADMIN
      ) {
        const adminCount = await tx.organizationUser.count({
          where: {
            organizationId,
            role: OrganizationUserRole.ADMIN,
          },
        });

        if (adminCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last admin from an organization",
          });
        }
      }

      await tx.organizationUser.update({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
        data: { role },
      });

      const organizationTeams = await tx.team.findMany({
        where: { organizationId },
        select: { id: true },
      });
      const organizationTeamIds = organizationTeams.map((team) => team.id);

      const currentMemberships = await tx.teamUser.findMany({
        where: {
          userId,
          teamId: { in: organizationTeamIds },
        },
        select: {
          teamId: true,
          role: true,
          assignedRoleId: true,
        },
      });
      const currentMembershipByTeamId = new Map(
        currentMemberships.map((membership) => [
          membership.teamId,
          membership,
        ]),
      );

      const dedupedTeamRoleUpdates = new Map(
        effectiveTeamRoleUpdates.map((u) => [u.teamId, u]),
      );

      for (const [teamId, teamRoleUpdate] of dedupedTeamRoleUpdates.entries()) {
        const currentMembership = currentMembershipByTeamId.get(teamId);
        if (!currentMembership) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User is not a member of this team",
          });
        }

        if (
          !isTeamRoleAllowedForOrganizationRole({
            organizationRole: role,
            teamRole: teamRoleUpdate.role as TeamRoleValue,
          })
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: LITE_MEMBER_VIEWER_ONLY_ERROR,
          });
        }

        const updateIsCustomRole = isCustomRole(teamRoleUpdate.role);
        if (updateIsCustomRole && !teamRoleUpdate.customRoleId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Custom role ID is required for custom role updates",
          });
        }

        if (updateIsCustomRole && teamRoleUpdate.customRoleId) {
          const customRole = await tx.customRole.findUnique({
            where: { id: teamRoleUpdate.customRoleId },
            select: { organizationId: true },
          });
          if (!customRole || customRole.organizationId !== organizationId) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Custom role not found",
            });
          }
        }

        const nextRole = updateIsCustomRole
          ? TeamUserRole.CUSTOM
          : (teamRoleUpdate.role as TeamUserRole);
        const shouldClearCustomRole = !updateIsCustomRole;
        const isDemotingLastAdmin =
          currentMembership.role === TeamUserRole.ADMIN &&
          nextRole !== TeamUserRole.ADMIN;

        if (isDemotingLastAdmin) {
          const teamAdminCount = await tx.teamUser.count({
            where: { teamId, role: TeamUserRole.ADMIN },
          });
          if (teamAdminCount <= 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Cannot remove or demote the last admin from this team",
            });
          }
        }

        const roleUnchanged =
          currentMembership.role === nextRole &&
          (shouldClearCustomRole
            ? currentMembership.assignedRoleId === null
            : currentMembership.assignedRoleId ===
              teamRoleUpdate.customRoleId);
        if (roleUnchanged) continue;

        await tx.teamUser.update({
          where: {
            userId_teamId: {
              userId,
              teamId,
            },
          },
          data: {
            role: nextRole,
            assignedRoleId: shouldClearCustomRole
              ? null
              : teamRoleUpdate.customRoleId,
          },
        });
      }

      const finalAdminCount = await tx.organizationUser.count({
        where: {
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });

      if (finalAdminCount === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Operation would result in no admins for this organization",
        });
      }
    });
  }

  async updateTeamMemberRole(input: UpdateTeamMemberRoleInput): Promise<void> {
    const { teamId, userId, role, customRoleId, currentUserId } = input;
    const inputIsCustomRole = customRoleId !== undefined;

    if (inputIsCustomRole && customRoleId) {
      const storedCustomRoleId = customRoleId;

      await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId },
          select: { organizationId: true },
        });
        if (!team) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }
        const customRole = await tx.customRole.findUnique({
          where: { id: storedCustomRoleId },
          select: { organizationId: true, permissions: true },
        });
        if (!customRole || customRole.organizationId !== team.organizationId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Role does not belong to team's organization",
          });
        }

        const orgMembership = await tx.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId,
              organizationId: team.organizationId,
            },
          },
        });

        if (orgMembership?.role === OrganizationUserRole.EXTERNAL) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: LITE_MEMBER_VIEWER_ONLY_ERROR,
          });
        }

        const adminCount = await tx.teamUser.count({
          where: {
            teamId,
            role: TeamUserRole.ADMIN,
          },
        });

        if (adminCount === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No admin found for this team",
          });
        }

        const targetUserMembership = await tx.teamUser.findUnique({
          where: {
            userId_teamId: {
              userId,
              teamId,
            },
          },
          select: { role: true },
        });

        if (!targetUserMembership) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User is not a member of this team",
          });
        }

        const isTargetUserAdmin =
          targetUserMembership.role === TeamUserRole.ADMIN;

        if (adminCount === 1 && isTargetUserAdmin) {
          if (userId === currentUserId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "You cannot demote yourself from the last admin position in this team",
            });
          }

          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot remove or demote the last admin from this team",
          });
        }

        await tx.teamUser.update({
          where: {
            userId_teamId: {
              userId,
              teamId,
            },
          },
          data: {
            role: TeamUserRole.CUSTOM,
            assignedRoleId: storedCustomRoleId,
          },
        });

        const finalAdminCount = await tx.teamUser.count({
          where: {
            teamId,
            role: TeamUserRole.ADMIN,
          },
        });

        if (finalAdminCount === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Operation would result in no admins for this team",
          });
        }
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId },
          select: { organizationId: true },
        });
        if (!team) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }

        const orgMembership = await tx.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId,
              organizationId: team.organizationId,
            },
          },
        });

        if (orgMembership?.role === OrganizationUserRole.EXTERNAL) {
          if (
            !isTeamRoleAllowedForOrganizationRole({
              organizationRole: OrganizationUserRole.EXTERNAL,
              teamRole: role as TeamRoleValue,
            })
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: LITE_MEMBER_VIEWER_ONLY_ERROR,
            });
          }

        }

        const adminCount = await tx.teamUser.count({
          where: {
            teamId,
            role: TeamUserRole.ADMIN,
          },
        });

        if (adminCount === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No admin found for this team",
          });
        }

        const targetUserMembership = await tx.teamUser.findUnique({
          where: {
            userId_teamId: {
              userId,
              teamId,
            },
          },
          select: { role: true },
        });

        if (!targetUserMembership) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User is not a member of this team",
          });
        }

        const isTargetUserAdmin =
          targetUserMembership.role === TeamUserRole.ADMIN;
        const wouldDemoteAdmin =
          isTargetUserAdmin && role !== TeamUserRole.ADMIN;

        if (adminCount === 1 && wouldDemoteAdmin) {
          if (userId === currentUserId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "You cannot demote yourself from the last admin position in this team",
            });
          }

          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot remove or demote the last admin from this team",
          });
        }

        await tx.teamUser.update({
          where: {
            userId_teamId: {
              userId,
              teamId,
            },
          },
          data: {
            role,
            assignedRoleId: null,
          },
        });

        const finalAdminCount = await tx.teamUser.count({
          where: {
            teamId,
            role: TeamUserRole.ADMIN,
          },
        });

        if (finalAdminCount === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Operation would result in no admins for this team",
          });
        }
      });
    }
  }

  async getAuditLogs(
    filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    const {
      organizationId,
      projectId,
      userId,
      pageOffset,
      pageSize,
      action,
      startDate,
      endDate,
    } = filters;

    const orgUserIds = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const orgUserIdsList = orgUserIds.map((ou) => ou.userId);

    const orgIdConditions: Prisma.AuditLogWhereInput[] = [
      { organizationId },
    ];

    if (orgUserIdsList.length > 0) {
      orgIdConditions.push({
        organizationId: null,
        userId: { in: orgUserIdsList },
        projectId: { not: null },
      });
    }

    const where: Prisma.AuditLogWhereInput = {};
    const andConditions: Prisma.AuditLogWhereInput[] = [
      { OR: orgIdConditions },
    ];

    if (userId) {
      andConditions.push({ userId });
    }

    if (action) {
      andConditions.push({
        action: {
          contains: action,
          mode: "insensitive" as const,
        },
      });
    }

    if (projectId) {
      andConditions.push({
        OR: [{ projectId }, { projectId: null }],
      });
    }

    if (startDate !== undefined || endDate !== undefined) {
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (startDate !== undefined) {
        dateFilter.gte = new Date(startDate);
      }
      if (endDate !== undefined) {
        dateFilter.lte = new Date(endDate);
      }
      andConditions.push({ createdAt: dateFilter });
    }

    if (andConditions.length > 1) {
      where.AND = andConditions;
    } else {
      Object.assign(where, andConditions[0]);
    }

    const totalCount = await this.prisma.auditLog.count({ where });

    const auditLogs = await this.prisma.auditLog.findMany({
      where,
      take: pageSize,
      skip: pageOffset,
      orderBy: { createdAt: "desc" },
    });

    const userIds = [...new Set(auditLogs.map((log) => log.userId))];
    const projectIds = [
      ...new Set(
        auditLogs
          .map((log) => log.projectId)
          .filter((id): id is string => !!id),
      ),
    ];

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });

    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    const enrichedAuditLogs: EnrichedAuditLog[] = auditLogs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      userId: log.userId,
      organizationId: log.organizationId,
      projectId: log.projectId,
      action: log.action,
      payload: log.args,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      error: log.error,
      args: log.args,
      user: userMap.get(log.userId) ?? null,
      project: log.projectId ? (projectMap.get(log.projectId) ?? null) : null,
    }));

    return { auditLogs: enrichedAuditLogs, totalCount };
  }
}
