import {
  type CustomRole,
  type Organization,
  type OrganizationUser,
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
  type Project,
  type Team,
  type TeamUser,
  TeamUserRole,
  type User,
} from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";

import { env } from "~/env.mjs";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  isViewOnlyCustomRole,
  LicenseEnforcementRepository,
} from "../../license-enforcement/license-enforcement.repository";
import { getRoleChangeType } from "../../license-enforcement/member-classification";
import {
  assertMemberTypeLimitNotExceeded,
  LICENSE_LIMIT_ERRORS,
} from "../../license-enforcement/license-limit-guard";
import { scheduleUsageStatsForOrganization } from "~/server/background/queues/usageStatsQueue";
import { decrypt, encrypt } from "~/utils/encryption";
import { isTeamRoleAllowedForOrganizationRole, type TeamRoleValue } from "~/utils/memberRoleConstraints";
import { slugify } from "~/utils/slugify";
import { dependencies } from "../../../injection/dependencies.server";
import { elasticsearchMigrate } from "../../../tasks/elasticMigrate";
import {
  INVITE_EXPIRATION_MS,
  InviteService,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
} from "../../invites/invite.service";
import {
  DuplicateInviteError,
  InviteNotFoundError,
  LicenseLimitError,
  OrganizationNotFoundError,
} from "../../invites/errors";
import { skipPermissionCheck } from "../rbac";
import { checkOrganizationPermission, checkTeamPermission } from "../rbac";
import { signUpDataSchema } from "./onboarding";

export type TeamWithProjects = Team & {
  projects: Project[];
};

export type TeamWithProjectsAndMembers = TeamWithProjects & {
  members: (TeamUser & {
    assignedRole?: CustomRole | null;
  })[];
};

export type OrganizationFeature = {
  feature: string;
  trialEndDate: Date | null;
};

export type FullyLoadedOrganization = Organization & {
  members: OrganizationUser[];
  teams: TeamWithProjectsAndMembers[];
  features: OrganizationFeature[];
};

export type TeamMemberWithUser = TeamUser & {
  user: User;
  assignedRole?: CustomRole | null;
};

export type TeamMemberWithTeam = TeamUser & {
  team: Team;
};

export type TeamWithProjectsAndMembersAndUsers = Team & {
  members: TeamMemberWithUser[];
  projects: Project[];
};

export type UserWithTeams = User & {
  teamMemberships: TeamMemberWithTeam[];
};

export type OrganizationMemberWithUser = OrganizationUser & {
  user: UserWithTeams;
};

export type OrganizationWithMembersAndTheirTeams = Organization & {
  members: OrganizationMemberWithUser[];
};

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const customTeamRoleInputSchema = z
  .string()
  .regex(
    /^custom:[a-zA-Z0-9_-]+$/,
    "Custom role must be in format 'custom:{roleId}'",
  );
const builtInTeamRoleInputSchema = z.enum([
  TeamUserRole.ADMIN,
  TeamUserRole.MEMBER,
  TeamUserRole.VIEWER,
]);
const teamRoleInputSchema = z.union([
  builtInTeamRoleInputSchema,
  customTeamRoleInputSchema,
]);

export const LITE_MEMBER_VIEWER_ONLY_ERROR =
  "Lite Member users can only have Viewer team role";

/**
 * Gets permissions for a custom role by its ID.
 */
async function getCustomRolePermissions(
  tx: TransactionClient,
  customRoleId: string | null | undefined
): Promise<string[] | undefined> {
  if (!customRoleId) return undefined;

  const role = await tx.customRole.findUnique({
    where: { id: customRoleId },
    select: { permissions: true },
  });

  return role?.permissions as string[] | undefined;
}

/**
 * Gets a user's merged custom role permissions across all their team assignments.
 */
async function getUserCustomRolePermissions(
  tx: TransactionClient,
  userId: string,
  organizationId: string
): Promise<string[] | undefined> {
  // Get teams in org
  const teams = await tx.team.findMany({
    where: { organizationId },
    select: { id: true },
  });

  if (teams.length === 0) return undefined;

  // Get user's team assignments with custom roles
  const teamUsers = await tx.teamUser.findMany({
    where: {
      userId,
      teamId: { in: teams.map((t) => t.id) },
      assignedRoleId: { not: null },
    },
    include: { assignedRole: true },
  });

  // Merge all permissions
  const allPermissions: string[] = [];
  for (const tu of teamUsers) {
    if (tu.assignedRole?.permissions) {
      allPermissions.push(...(tu.assignedRole.permissions as string[]));
    }
  }

  return allPermissions.length > 0 ? allPermissions : undefined;
}

interface TeamRoleUpdate {
  teamId: string;
  role: TeamRoleValue;
  customRoleId?: string;
}

interface CurrentTeamMembership {
  teamId: string;
  role: TeamUserRole;
}

/**
 * Computes the effective set of team role updates to apply when changing a
 * member's organization role.
 *
 * Cases:
 * 1. Requested updates present + non-EXTERNAL org role: use requested updates as-is.
 * 2. Requested updates present + EXTERNAL org role: use requested updates plus
 *    fallback any uncovered existing memberships to VIEWER.
 * 3. No requested updates + EXTERNAL org role: auto-correct all non-VIEWER
 *    memberships to VIEWER.
 * 4. No requested updates + MEMBER org role: auto-upgrade all VIEWER
 *    memberships to MEMBER.
 * 5. No requested updates + other org role (e.g. ADMIN): no changes needed.
 */
export function computeEffectiveTeamRoleUpdates(params: {
  requestedTeamRoleUpdates: TeamRoleUpdate[];
  currentMemberships: CurrentTeamMembership[];
  newOrganizationRole: OrganizationUserRole;
}): TeamRoleUpdate[] {
  const { requestedTeamRoleUpdates, currentMemberships, newOrganizationRole } =
    params;

  if (requestedTeamRoleUpdates.length > 0) {
    if (newOrganizationRole !== OrganizationUserRole.EXTERNAL) {
      return requestedTeamRoleUpdates;
    }

    const requestedTeamIdSet = new Set(
      requestedTeamRoleUpdates.map((update) => update.teamId),
    );
    const externalFallbackUpdates = currentMemberships
      .filter((membership) => !requestedTeamIdSet.has(membership.teamId))
      .map((membership) => ({
        teamId: membership.teamId,
        role: TeamUserRole.VIEWER,
        customRoleId: undefined,
      }));

    return [...requestedTeamRoleUpdates, ...externalFallbackUpdates];
  }

  if (newOrganizationRole === OrganizationUserRole.EXTERNAL) {
    return currentMemberships
      .filter((membership) => membership.role !== TeamUserRole.VIEWER)
      .map((membership) => ({
        teamId: membership.teamId,
        role: TeamUserRole.VIEWER,
        customRoleId: undefined,
      }));
  }

  if (newOrganizationRole === OrganizationUserRole.MEMBER) {
    return currentMemberships
      .filter((membership) => membership.role === TeamUserRole.VIEWER)
      .map((membership) => ({
        teamId: membership.teamId,
        role: TeamUserRole.MEMBER,
        customRoleId: undefined,
      }));
  }

  return [];
}

export const organizationRouter = createTRPCRouter({
  createAndAssign: protectedProcedure
    .input(
      z.object({
        orgName: z.string().optional(),
        phoneNumber: z.string().optional(),
        signUpData: signUpDataSchema.optional(),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const orgName = input.orgName
        ? input.orgName
        : (ctx.session.user.name ?? "My Organization");
      const orgNanoId = nanoid();
      const orgId = `organization_${orgNanoId}`;
      const orgSlug =
        slugify(orgName, { lower: true, strict: true }) +
        "-" +
        orgNanoId.substring(0, 6);

      const teamNanoId = nanoid();
      const teamId = `team_${teamNanoId}`;
      const teamSlug =
        slugify(orgName, { lower: true, strict: true }) +
        "-" +
        teamNanoId.substring(0, 6);

      const { organization, team } = await prisma.$transaction(
        async (prisma) => {
          // 1. Create the organization
          const organization = await prisma.organization.create({
            data: {
              id: orgId,
              name: orgName,
              slug: orgSlug,
              phoneNumber: input.phoneNumber,
              signupData: input.signUpData,
              pricingModel: "SEAT_USAGE",
            },
          });

          // 2. Assign the user to the organization
          await prisma.organizationUser.create({
            data: {
              userId: userId,
              organizationId: organization.id,
              role: "ADMIN", // Assuming the user becomes an admin of the created organization
            },
          });

          // 3. Create the default team
          const team = await prisma.team.create({
            data: {
              id: teamId,
              name: orgName, // Same name as organization
              slug: teamSlug, // Same as organization
              organizationId: organization.id,
            },
          });

          // 4. Assign the user to the team
          await prisma.teamUser.create({
            data: {
              userId: userId,
              teamId: team.id,
              role: "ADMIN", // Assuming the user becomes an admin of the created team
            },
          });

          return { organization, team };
        },
      );

      // Add usage stats job for the new organization
      await scheduleUsageStatsForOrganization(organization);

      return {
        success: true,
        organization: {
          id: organization.id,
          name: organization.name,
        },
        team: {
          id: team.id,
          slug: team.slug,
          name: team.name,
        },
      };
    }),
  deleteMember: protectedProcedure
    .input(z.object({ userId: z.string(), organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = input;
      const prisma = ctx.prisma;

      // Prevent self-deletion
      if (userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself from the organization",
        });
      }

      await prisma.organizationUser.delete({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
      });
      await prisma.teamUser.deleteMany({
        where: {
          userId,
          team: {
            organizationId,
          },
        },
      });

      return { success: true };
    }),

  getAll: protectedProcedure
    .input(
      z.object({
        isDemo: z.boolean().optional(),
      }),
    )
    .use(skipPermissionCheck)
    .query(async ({ ctx, input }) => {
      const isDemo = input?.isDemo;
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;
      const demoProjectUserId = isDemo ? env.DEMO_PROJECT_USER_ID : "";
      const demoProjectId = isDemo ? env.DEMO_PROJECT_ID : "";

      const organizations: FullyLoadedOrganization[] =
        await prisma.organization.findMany({
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
                    userId: userId,
                  },
                },
              },
            ],
          },
          include: {
            members: {
              where: {
                userId: userId,
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
        });

      for (const organization of organizations) {
        for (const project of organization.teams.flatMap(
          (team) => team.projects,
        )) {
          if (project.s3AccessKeyId) {
            project.s3AccessKeyId = decrypt(project.s3AccessKeyId);
          }
          if (project.s3SecretAccessKey) {
            project.s3SecretAccessKey = decrypt(project.s3SecretAccessKey);
          }
          if (project.s3Endpoint) {
            project.s3Endpoint = decrypt(project.s3Endpoint);
          }
          if (isDemo) {
            project.apiKey = "";
          }
        }
      }
      for (const organization of organizations) {
        // For demo mode, just filter members (permission checks handle demo projects separately)
        const isDemoOrg =
          isDemo &&
          organization.teams.some((team) =>
            team.projects.some((project) => project.id === demoProjectId),
          );

        // Filter members to only include demo user and current user
        organization.members = organization.members.filter(
          (member) =>
            member.userId === userId || member.userId === demoProjectUserId,
        );
        if (organization.s3AccessKeyId) {
          organization.s3AccessKeyId = decrypt(organization.s3AccessKeyId);
        }
        if (organization.s3SecretAccessKey) {
          organization.s3SecretAccessKey = decrypt(
            organization.s3SecretAccessKey,
          );
        }
        if (organization.s3Endpoint) {
          organization.s3Endpoint = decrypt(organization.s3Endpoint);
        }
        if (organization.elasticsearchNodeUrl) {
          organization.elasticsearchNodeUrl = decrypt(
            organization.elasticsearchNodeUrl,
          );
        }
        if (organization.elasticsearchApiKey) {
          organization.elasticsearchApiKey = decrypt(
            organization.elasticsearchApiKey,
          );
        }

        const isExternal =
          organization.members[0]?.role !== "ADMIN" &&
          organization.members[0]?.role !== "MEMBER";

        // For demo orgs, skip the isExternal filtering since we'll add virtual members
        organization.teams = organization.teams.filter((team) => {
          team.members = team.members.filter(
            (member) =>
              member.userId === userId || member.userId === demoProjectUserId,
          );
          if (isDemoOrg) return true;
          return isExternal
            ? team.members.some((member) => member.userId === userId)
            : true;
        });

        if (isDemoOrg) {
          organization.teams = organization.teams.flatMap((team) => {
            if (team.projects.some((project) => project.id === demoProjectId)) {
              team.projects = team.projects.filter(
                (project) => project.id === demoProjectId,
              );

              // Filter members to only include demo user and current user
              // Permission checks handle demo projects separately
              team.members = team.members.filter(
                (member) =>
                  member.userId === demoProjectUserId ||
                  member.userId === userId,
              );
              return [team];
            } else {
              return [];
            }
          });
        }
      }

      return organizations;
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string(),
          name: z.string(),
          s3Endpoint: z.string().optional(),
          s3AccessKeyId: z.string().optional(),
          s3SecretAccessKey: z.string().optional(),
          elasticsearchNodeUrl: z.string().optional(),
          elasticsearchApiKey: z.string().optional(),
          s3Bucket: z.string().optional(),
        })
        .refine((data) => {
          const hasNodeUrl = !!data.elasticsearchNodeUrl?.trim();
          const hasApiKey = !!data.elasticsearchApiKey?.trim();
          return (hasNodeUrl && hasApiKey) || (!hasNodeUrl && !hasApiKey);
        })
        .refine(
          (data) => {
            const hasEndpoint = !!data.s3Endpoint?.trim();
            const hasAccessKey = !!data.s3AccessKeyId?.trim();
            const hasSecretKey = !!data.s3SecretAccessKey?.trim();

            return (
              (hasEndpoint && hasAccessKey && hasSecretKey) ||
              (!hasEndpoint && !hasAccessKey && !hasSecretKey)
            );
          },
          {
            message:
              "S3 Endpoint, Access Key ID, and Secret Access Key must all be provided together",
          },
        ),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const organizationUser = await prisma.organizationUser.findFirst({
        where: {
          userId: userId,
          organizationId: input.organizationId,
          role: "ADMIN",
        },
      });

      if (!organizationUser) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have the necessary permissions",
        });
      }

      await prisma.organization.update({
        where: {
          id: input.organizationId,
        },
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

      if (input.elasticsearchNodeUrl && input.elasticsearchApiKey) {
        await elasticsearchMigrate(input.organizationId);
      }

      return { success: true };
    }),

  getOrganizationWithMembersAndTheirTeams: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const organization = await prisma.organization.findFirst({
        where: {
          id: input.organizationId,
          members: {
            some: {
              userId: userId,
            },
          },
        },
        include: {
          members: {
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
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      return organization;
    }),

  getMemberById: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      // Check that the current user has access to this organization
      const currentUserMembership = await prisma.organizationUser.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: ctx.session.user.id,
        },
      });

      if (!currentUserMembership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // Get the requested member
      const member = await prisma.organizationUser.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: input.userId,
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
      });

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      return member;
    }),

  createInvites: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        invites: z.array(
          z.object({
            email: z.string().email(),
            teamIds: z.string().optional(), // Keep for backward compatibility
            teams: z
              .array(
                z.object({
                  teamId: z.string(),
                  role: teamRoleInputSchema,
                  customRoleId: z.string().optional(),
                }),
              )
              .optional(),
            role: z.nativeEnum(OrganizationUserRole),
          }),
        ),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const organization = await prisma.organization.findFirst({
        where: {
          id: input.organizationId,
        },
        include: {
          members: true,
        },
      });

      if (!organization) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Organization not found",
        });
      }

      const inviteService = InviteService.create(prisma);

      // Check license limits using the service
      try {
        await inviteService.checkLicenseLimits({
          organizationId: input.organizationId,
          newInvites: input.invites.map((invite) => ({
            role: invite.role,
            teams: invite.teams,
          })),
          user: ctx.session.user,
        });
      } catch (error) {
        if (error instanceof LicenseLimitError) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
          });
        }
        throw error;
      }
      // Prepare invite data (read-only validation) outside transaction
      const preparedAdminInvites = await Promise.all(
        input.invites.map(async (invite) => {
          let teamAssignments: Array<{
            teamId: string;
            role: TeamUserRole;
            customRoleId?: string;
          }> = [];
          let teamIdsString = "";

          if (invite.teams && invite.teams.length > 0) {
            const teamIds = invite.teams.map((t) => t.teamId);

            const validTeams = await prisma.team.findMany({
              where: {
                id: { in: teamIds },
                organizationId: input.organizationId,
              },
              select: { id: true },
            });

            const validTeamIds = validTeams.map((team) => team.id);

            if (validTeamIds.length === 0) {
              return null;
            }

            teamAssignments = invite.teams
              .filter((t) => validTeamIds.includes(t.teamId))
              .map((t) => {
                const isCustomRole =
                  typeof t.role === "string" && t.role.startsWith("custom:");
                return {
                  teamId: t.teamId,
                  role: isCustomRole
                    ? TeamUserRole.CUSTOM
                    : (t.role as TeamUserRole),
                  customRoleId:
                    isCustomRole && t.customRoleId ? t.customRoleId : undefined,
                };
              })
              .filter((t) => {
                if (t.role === TeamUserRole.CUSTOM && !t.customRoleId) {
                  return false;
                }
                return true;
              });

            teamIdsString = validTeamIds.join(",");
          } else if (invite.teamIds?.trim()) {
            const teamIdArray = invite.teamIds
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);

            const validTeams = await prisma.team.findMany({
              where: {
                id: { in: teamIdArray },
                organizationId: input.organizationId,
              },
              select: { id: true },
            });

            const validTeamIds = validTeams.map((team) => team.id);

            if (validTeamIds.length === 0) {
              return null;
            }

            teamAssignments = validTeamIds.map((teamId) => ({
              teamId,
              role: ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role],
            }));

            teamIdsString = validTeamIds.join(",");
          } else {
            return null;
          }

          if (!invite.email.trim()) {
            return null;
          }

          return {
            email: invite.email,
            role: invite.role,
            organizationId: input.organizationId,
            teamIds: teamIdsString,
            teamAssignments:
              teamAssignments.length > 0 ? teamAssignments : undefined,
          };
        }),
      );

      const validInvites = preparedAdminInvites.filter(
        (inv): inv is NonNullable<typeof inv> => inv !== null,
      );

      // Phase 1: DB operations in transaction (no side-effects)
      const inviteRecords = await prisma.$transaction(async (tx) => {
        const txInviteService = InviteService.create(tx);
        return Promise.all(
          validInvites.map(async (invite) => {
            const existingInvite = await txInviteService.checkDuplicateInvite({
              email: invite.email,
              organizationId: invite.organizationId,
            });

            if (existingInvite) {
              return null;
            }

            return await txInviteService.createAdminInviteRecord(invite);
          }),
        );
      });

      // Phase 2: Send emails outside transaction
      const createdRecords = inviteRecords.filter(
        (r): r is NonNullable<typeof r> => r !== null,
      );
      const invites = await Promise.all(
        createdRecords.map(async (record) => {
          const { emailNotSent } = await inviteService.trySendInviteEmail({
            email: record.invite.email,
            organization: record.organization,
            inviteCode: record.invite.inviteCode,
          });
          return { invite: record.invite, emailNotSent };
        }),
      );

      return invites;
    }),
  deleteInvite: protectedProcedure
    .input(z.object({ inviteId: z.string(), organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      await prisma.organizationInvite.delete({
        where: { id: input.inviteId, organizationId: input.organizationId },
      });

      if (dependencies.onSeatsChanged) {
        const licenseRepo = new LicenseEnforcementRepository(prisma);
        const currentFullMembers = await licenseRepo.getMemberCount(
          input.organizationId
        );
        await dependencies.onSeatsChanged({
          organizationId: input.organizationId,
          newTotalSeats: currentFullMembers,
        });
      }
    }),
  getOrganizationPendingInvites: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const invites = await prisma.organizationInvite.findMany({
        where: {
          organizationId: input.organizationId,
          status: { in: ["PENDING", "WAITING_APPROVAL"] },
          OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
        },
        include: {
          requestedByUser: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      return invites;
    }),
  createInviteRequest: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        invites: z.array(
          z.object({
            email: z.string().email(),
            role: z.enum(["MEMBER", "EXTERNAL"]),
            teamIds: z.string().optional(),
            teams: z
              .array(
                z.object({
                  teamId: z.string(),
                  role: z.union([
                    z.nativeEnum(TeamUserRole),
                    z
                      .string()
                      .regex(
                        /^custom:[a-zA-Z0-9_-]+$/,
                        "Custom role must be in format 'custom:{roleId}'",
                      ),
                  ]),
                  customRoleId: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const inviteService = InviteService.create(prisma);

      try {
        // Check license limits for all invites at once
        await inviteService.checkLicenseLimits({
          organizationId: input.organizationId,
          newInvites: input.invites.map((invite) => ({
            role: invite.role as OrganizationUserRole,
            teams: invite.teams,
          })),
          user: ctx.session.user,
        });

        const normalizedPayloadEmails = input.invites.map((invite) =>
          invite.email.trim().toLowerCase(),
        );
        const duplicatePayloadEmails = normalizedPayloadEmails.filter(
          (email, index) => normalizedPayloadEmails.indexOf(email) !== index,
        );

        if (duplicatePayloadEmails.length > 0) {
          const uniqueDuplicatePayloadEmails = [
            ...new Set(duplicatePayloadEmails),
          ];
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Duplicate emails in request payload: ${uniqueDuplicatePayloadEmails.join(", ")}`,
          });
        }

        const preparedInvites = await Promise.all(
          input.invites.map(async (invite) => {
            const normalizedEmail = invite.email.trim().toLowerCase();

            // Validate team IDs
            let teamIdsString = "";
            let teamAssignments: Array<{
              teamId: string;
              role: TeamUserRole;
              customRoleId?: string;
            }> = [];

            if (invite.teams && invite.teams.length > 0) {
              const teamIds = invite.teams.map((t) => t.teamId);
              const validTeamIds = await inviteService.validateTeamIds({
                teamIds,
                organizationId: input.organizationId,
              });

              if (validTeamIds.length === 0) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "No valid teams provided",
                });
              }

              teamAssignments = invite.teams
                .filter((t) => validTeamIds.includes(t.teamId))
                .map((t) => {
                  const isCustomRole =
                    typeof t.role === "string" && t.role.startsWith("custom:");
                  return {
                    teamId: t.teamId,
                    role: isCustomRole
                      ? ("CUSTOM" as TeamUserRole)
                      : (t.role as TeamUserRole),
                    customRoleId:
                      isCustomRole && t.customRoleId
                        ? t.customRoleId
                        : undefined,
                  };
                });

              teamIdsString = validTeamIds.join(",");
            } else if (invite.teamIds?.trim()) {
              const teamIdArray = invite.teamIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);

              const validTeamIds = await inviteService.validateTeamIds({
                teamIds: teamIdArray,
                organizationId: input.organizationId,
              });

              if (validTeamIds.length === 0) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "No valid teams provided",
                });
              }

              teamAssignments = validTeamIds.map((teamId) => ({
                teamId,
                role: ORGANIZATION_TO_TEAM_ROLE_MAP[
                  invite.role as OrganizationUserRole
                ],
              }));

              teamIdsString = validTeamIds.join(",");
            } else {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "At least one team must be provided",
              });
            }

            return {
              email: normalizedEmail,
              role: invite.role as OrganizationUserRole,
              organizationId: input.organizationId,
              teamIds: teamIdsString,
              teamAssignments:
                teamAssignments.length > 0 ? teamAssignments : undefined,
              requestedBy: ctx.session.user.id,
            };
          }),
        );

        const results = await prisma.$transaction(async (tx) => {
          const transactionalInviteService = InviteService.create(tx);
          return Promise.all(
            preparedInvites.map((invite) =>
              transactionalInviteService.createMemberInviteRequest(invite),
            ),
          );
        });

        return results;
      } catch (error) {
        if (error instanceof LicenseLimitError) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
          });
        }
        if (error instanceof DuplicateInviteError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }
    }),
  approveInvite: protectedProcedure
    .input(
      z.object({
        inviteId: z.string(),
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const inviteService = InviteService.create(prisma);

      try {
        // Re-validate license limits before approving (org may have reached cap since request)
        const invite = await prisma.organizationInvite.findFirst({
          where: {
            id: input.inviteId,
            organizationId: input.organizationId,
            status: "WAITING_APPROVAL",
          },
        });

        if (!invite) {
          throw new InviteNotFoundError();
        }

        const teamAssignments =
          (invite.teamAssignments as Array<{ customRoleId?: string }>) ?? [];
        await inviteService.checkLicenseLimits({
          organizationId: input.organizationId,
          newInvites: [{ role: invite.role, teams: teamAssignments }],
          user: ctx.session.user,
        });

        return await inviteService.approveInvite({
          inviteId: input.inviteId,
          organizationId: input.organizationId,
        });
      } catch (error) {
        if (
          error instanceof InviteNotFoundError ||
          error instanceof OrganizationNotFoundError
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        if (error instanceof LicenseLimitError) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
          });
        }
        throw error;
      }
    }),
  acceptInvite: protectedProcedure
    .input(
      z.object({
        inviteCode: z.string(),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const session = ctx.session;
      const invite = await prisma.organizationInvite.findUnique({
        where: { inviteCode: input.inviteCode },
        include: { organization: true },
      });

      if (
        !invite ||
        (invite.expiration !== null && invite.expiration < new Date())
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite not found or has expired",
        });
      }

      if (!session || !session.user || !session.user.email) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be signed in to accept the invite",
        });
      }

      if (invite.status === "ACCEPTED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invite was already accepted",
        });
      }

      if (session.user.email !== invite.email) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `The invite was sent to ${invite.email}, but you are signed in as ${session.user.email}`,
        });
      }

      await prisma.$transaction(async (prisma) => {
        // Create org membership; skip if it already exists
        await prisma.organizationUser.createMany({
          data: [
            {
              userId: session.user.id,
              organizationId: invite.organizationId,
              role: invite.role,
            },
          ],
          skipDuplicates: true,
        });

        // Use teamAssignments if available (new format), otherwise fall back to legacy teamIds
        let teamMembershipData: Array<{
          userId: string;
          teamId: string;
          role: TeamUserRole;
          customRoleId?: string;
        }> = [];

        if (invite.teamAssignments && Array.isArray(invite.teamAssignments)) {
          // New format: use per-team roles from teamAssignments
          const assignments = invite.teamAssignments as Array<{
            teamId: string;
            role: TeamUserRole;
            customRoleId?: string;
          }>;
          teamMembershipData = assignments.map((assignment) => ({
            userId: session.user.id,
            teamId: assignment.teamId,
            role: assignment.role,
            customRoleId: assignment.customRoleId,
          }));
        } else {
          // Legacy format: use organization role mapping
          const dedupedTeamIds = Array.from(
            new Set(
              invite.teamIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          );

          teamMembershipData = dedupedTeamIds.map((teamId) => ({
            userId: session.user.id,
            teamId,
            role: ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role],
          }));
        }

        if (teamMembershipData.length > 0) {
          // Handle custom roles separately since createMany doesn't support assignedRoleId
          const builtInRoles = teamMembershipData.filter(
            (data) => data.role !== TeamUserRole.CUSTOM,
          );
          const customRoles = teamMembershipData.filter(
            (data) => data.role === TeamUserRole.CUSTOM && data.customRoleId,
          );

          // Create team memberships with built-in roles
          if (builtInRoles.length > 0) {
            await prisma.teamUser.createMany({
              data: builtInRoles.map(
                ({ customRoleId: _customRoleId, ...data }) => data,
              ),
              skipDuplicates: true,
            });
          }

          // Create team memberships with custom roles (requires individual creates for assignedRoleId)
          for (const customRole of customRoles) {
            try {
              await prisma.teamUser.create({
                data: {
                  userId: customRole.userId,
                  teamId: customRole.teamId,
                  role: TeamUserRole.CUSTOM,
                  assignedRoleId: customRole.customRoleId!,
                },
              });
            } catch (error: unknown) {
              // Ignore unique constraint violations (concurrent inserts)
              if (
                error instanceof PrismaClientKnownRequestError &&
                error.code === "P2002"
              ) {
                // Swallow the error - record already exists
                continue;
              }
              // Rethrow other errors
              throw error;
            }
          }
        }

        await prisma.organizationInvite.update({
          where: { id: invite.id, organizationId: invite.organizationId },
          data: { status: "ACCEPTED" },
        });
      });

      const project = await prisma.project.findFirst({
        where: { teamId: invite.teamIds.split(",")[0] },
        select: { slug: true },
      });

      return { success: true, invite, project };
    }),
  updateTeamMemberRole: protectedProcedure
    .input(
      z
        .object({
          teamId: z.string(),
          userId: z.string(),
          role: teamRoleInputSchema,
          customRoleId: z.string().optional(),
        })
        .superRefine((data, ctx) => {
          const isCustomRole = data.role.startsWith("custom:");

          if (isCustomRole) {
            if (!data.customRoleId || data.customRoleId.trim() === "") {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "customRoleId is required when using a custom role",
                path: ["customRoleId"],
              });
            }
          } else {
            if (data.customRoleId !== undefined) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                  "customRoleId must not be provided when using a built-in role",
                path: ["customRoleId"],
              });
            }
          }
        }),
    )
    .use(checkTeamPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      // Check if this is a custom role
      const isCustomRole = input.role.startsWith("custom:");

      if (isCustomRole && input.customRoleId) {
        const customRoleId = input.customRoleId; // Store in a const for TypeScript

        // Atomic transaction with admin validation
        await prisma.$transaction(async (tx) => {
          // Ensure the custom role belongs to the team's organization
          const team = await tx.team.findUnique({
            where: { id: input.teamId },
            select: { organizationId: true },
          });
          if (!team) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Team not found",
            });
          }
          const role = await tx.customRole.findUnique({
            where: { id: input.customRoleId },
            select: { organizationId: true, permissions: true },
          });
          if (!role || role.organizationId !== team.organizationId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Role does not belong to team's organization",
            });
          }

          // Check license limits for EXTERNAL users when changing custom roles
          const orgMembership = await tx.organizationUser.findUnique({
            where: {
              userId_organizationId: {
                userId: input.userId,
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

          // Lock and validate admin count within transaction
          const adminCount = await tx.teamUser.count({
            where: {
              teamId: input.teamId,
              role: TeamUserRole.ADMIN,
            },
          });

          if (adminCount === 0) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "No admin found for this team",
            });
          }

          // Lock the target user's membership row to prevent concurrent modifications
          const targetUserMembership = await tx.teamUser.findUnique({
            where: {
              userId_teamId: {
                userId: input.userId,
                teamId: input.teamId,
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
          const wouldDemoteAdmin = isTargetUserAdmin; // Custom roles always demote from ADMIN

          if (adminCount === 1 && wouldDemoteAdmin) {
            // Optional: Check for self-demotion
            if (input.userId === ctx.session.user.id) {
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

          // Perform the updates
          await tx.teamUser.update({
            where: {
              userId_teamId: {
                userId: input.userId,
                teamId: input.teamId,
              },
            },
            data: {
              role: TeamUserRole.CUSTOM, // Use CUSTOM role for custom role assignments
              assignedRoleId: customRoleId,
            },
          });

          // Post-update validation: ensure we still have at least one admin
          const finalAdminCount = await tx.teamUser.count({
            where: {
              teamId: input.teamId,
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
        // It's a built-in role - update it and remove any custom roles
        await prisma.$transaction(async (tx) => {
          // Get team for organization ID
          const team = await tx.team.findUnique({
            where: { id: input.teamId },
            select: { organizationId: true },
          });
          if (!team) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Team not found",
            });
          }

          // Check license limits for EXTERNAL users when removing custom roles
          const orgMembership = await tx.organizationUser.findUnique({
            where: {
              userId_organizationId: {
                userId: input.userId,
                organizationId: team.organizationId,
              },
            },
          });

          if (orgMembership?.role === OrganizationUserRole.EXTERNAL) {
            if (
              !isTeamRoleAllowedForOrganizationRole({
                organizationRole: OrganizationUserRole.EXTERNAL,
                teamRole: input.role as TeamRoleValue,
              })
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: LITE_MEMBER_VIEWER_ONLY_ERROR,
              });
            }

            // Get the current team user to find old custom role
            const currentTeamUser = await tx.teamUser.findUnique({
              where: {
                userId_teamId: {
                  userId: input.userId,
                  teamId: input.teamId,
                },
              },
              select: { assignedRoleId: true },
            });

            // Get old permissions
            const oldPermissions = await getCustomRolePermissions(
              tx,
              currentTeamUser?.assignedRoleId
            );

            // Built-in roles have no custom permissions
            const changeType = getRoleChangeType(
              OrganizationUserRole.EXTERNAL,
              oldPermissions,
              OrganizationUserRole.EXTERNAL,
              undefined // No custom permissions for built-in role
            );

            // Check license limits for member type changes
            const subscriptionLimits =
              await dependencies.subscriptionHandler.getActivePlan(
                team.organizationId,
                ctx.session.user
              );
            const licenseRepo = new LicenseEnforcementRepository(prisma);
            await assertMemberTypeLimitNotExceeded(
              changeType,
              team.organizationId,
              licenseRepo,
              subscriptionLimits
            );
          }

          // Lock and validate admin count within transaction
          const adminCount = await tx.teamUser.count({
            where: {
              teamId: input.teamId,
              role: TeamUserRole.ADMIN,
            },
          });

          if (adminCount === 0) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "No admin found for this team",
            });
          }

          // Lock the target user's membership row to prevent concurrent modifications
          const targetUserMembership = await tx.teamUser.findUnique({
            where: {
              userId_teamId: {
                userId: input.userId,
                teamId: input.teamId,
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
            isTargetUserAdmin &&
            (input.role as TeamUserRole) !== TeamUserRole.ADMIN;

          if (adminCount === 1 && wouldDemoteAdmin) {
            // Optional: Check for self-demotion
            if (input.userId === ctx.session.user.id) {
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

          // Perform the updates
          await tx.teamUser.update({
            where: {
              userId_teamId: {
                userId: input.userId,
                teamId: input.teamId,
              },
            },
            data: {
              role: input.role as TeamUserRole,
              assignedRoleId: null, // Clear custom role assignment
            },
          });

          // Post-update validation: ensure we still have at least one admin
          const finalAdminCount = await tx.teamUser.count({
            where: {
              teamId: input.teamId,
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

      return { success: true };
    }),
  getAllOrganizationMembers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const users = await prisma.user.findMany({
        where: {
          orgMemberships: {
            some: {
              organizationId: input.organizationId,
            },
          },
        },
      });

      return users;
    }),
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        organizationId: z.string(),
        role: z.nativeEnum(OrganizationUserRole),
        teamRoleUpdates: z
          .array(
            z.object({
              teamId: z.string(),
              userId: z.string(),
              role: teamRoleInputSchema,
              customRoleId: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      return await prisma.$transaction(async (tx) => {
        // Get the current member's role
        const currentMember = await tx.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: input.userId,
              organizationId: input.organizationId,
            },
          },
        });

        if (!currentMember) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member not found",
          });
        }

        // Check admin demotion constraints
        if (
          input.role !== OrganizationUserRole.ADMIN &&
          currentMember.role === OrganizationUserRole.ADMIN
        ) {
          const adminCount = await tx.organizationUser.count({
            where: {
              organizationId: input.organizationId,
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

        // Get current member's custom role permissions (if any)
        const userPermissions = await getUserCustomRolePermissions(
          tx,
          input.userId,
          input.organizationId
        );

        // Determine if this change affects member type
        const changeType = getRoleChangeType(
          currentMember.role,
          userPermissions,
          input.role,
          undefined // New role won't have custom permissions yet
        );

        // Check limits for member type changes
        const subscriptionLimits =
          await dependencies.subscriptionHandler.getActivePlan(
            input.organizationId,
            ctx.session.user
          );
        const licenseRepo = new LicenseEnforcementRepository(prisma);
        await assertMemberTypeLimitNotExceeded(
          changeType,
          input.organizationId,
          licenseRepo,
          subscriptionLimits
        );

        await tx.organizationUser.update({
          where: {
            userId_organizationId: {
              userId: input.userId,
              organizationId: input.organizationId,
            },
          },
          data: { role: input.role },
        });

        const organizationTeams = await tx.team.findMany({
          where: { organizationId: input.organizationId },
          select: { id: true },
        });
        const organizationTeamIds = organizationTeams.map((team) => team.id);
        const organizationTeamIdSet = new Set(organizationTeamIds);

        const currentMemberships = await tx.teamUser.findMany({
          where: {
            userId: input.userId,
            teamId: { in: organizationTeamIds },
          },
          select: {
            teamId: true,
            role: true,
            assignedRoleId: true,
          },
        });
        const currentMembershipByTeamId = new Map(
          currentMemberships.map((membership) => [membership.teamId, membership]),
        );

        const requestedTeamRoleUpdates = (input.teamRoleUpdates ?? []).reduce<
          Array<{
            teamId: string;
            role: TeamRoleValue;
            customRoleId?: string;
          }>
        >((acc, teamRoleUpdate) => {
          if (teamRoleUpdate.userId !== input.userId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Team role update user must match target member",
            });
          }
          if (!organizationTeamIdSet.has(teamRoleUpdate.teamId)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Team role update must belong to the organization",
            });
          }
          acc.push({
            teamId: teamRoleUpdate.teamId,
            role: teamRoleUpdate.role as TeamRoleValue,
            customRoleId: teamRoleUpdate.customRoleId,
          });
          return acc;
        }, []);

        const effectiveTeamRoleUpdates = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates,
          currentMemberships,
          newOrganizationRole: input.role,
        });

        const dedupedTeamRoleUpdates = new Map(
          effectiveTeamRoleUpdates.map((teamRoleUpdate) => [
            teamRoleUpdate.teamId,
            teamRoleUpdate,
          ]),
        );

        /**
         * Keep MEMBER + VIEWER allowed for backward compatibility.
         * TODO(pricing): when user roles change, apply the corresponding charges.
         */
        for (const membership of currentMemberships) {
          const desiredUpdate = dedupedTeamRoleUpdates.get(membership.teamId);
          if (!desiredUpdate) continue;

          if (
            !isTeamRoleAllowedForOrganizationRole({
              organizationRole: input.role,
              teamRole: desiredUpdate.role,
            })
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: LITE_MEMBER_VIEWER_ONLY_ERROR,
            });
          }
        }

        for (const [teamId, teamRoleUpdate] of dedupedTeamRoleUpdates.entries()) {
          const currentMembership = currentMembershipByTeamId.get(teamId);
          if (!currentMembership) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "User is not a member of this team",
            });
          }

          const isCustomRole = teamRoleUpdate.role.startsWith("custom:");
          if (isCustomRole && !teamRoleUpdate.customRoleId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Custom role ID is required for custom role updates",
            });
          }

          if (isCustomRole && teamRoleUpdate.customRoleId) {
            const customRole = await tx.customRole.findUnique({
              where: { id: teamRoleUpdate.customRoleId },
              select: { organizationId: true },
            });
            if (!customRole || customRole.organizationId !== input.organizationId) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Custom role not found",
              });
            }
          }

          const nextRole = isCustomRole
            ? TeamUserRole.CUSTOM
            : (teamRoleUpdate.role as TeamUserRole);
          const shouldClearCustomRole = !isCustomRole;
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
                message: "Cannot remove or demote the last admin from this team",
              });
            }
          }

          const roleUnchanged =
            currentMembership.role === nextRole &&
            (shouldClearCustomRole
              ? currentMembership.assignedRoleId === null
              : currentMembership.assignedRoleId === teamRoleUpdate.customRoleId);
          if (roleUnchanged) continue;

          await tx.teamUser.update({
            where: {
              userId_teamId: {
                userId: input.userId,
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

        // Post-update validation: ensure we still have at least one org admin
        const finalAdminCount = await tx.organizationUser.count({
          where: {
            organizationId: input.organizationId,
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

        return { success: true };
      });
    }),

  getAuditLogs: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        projectId: z.string().optional(),
        userId: z.string().optional(), // For searching by user
        pageOffset: z.number().min(0).default(0),
        pageSize: z.number().min(1).max(10000).default(25), // Increased max for exports
        action: z.string().optional(), // For filtering by action type
        startDate: z.number().optional(), // Start date timestamp (milliseconds)
        endDate: z.number().optional(), // End date timestamp (milliseconds)
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      // Get all user IDs that belong to this organization
      // This helps us filter logs with null organizationId to only show logs from org members
      const orgUserIds = await ctx.prisma.organizationUser.findMany({
        where: {
          organizationId: input.organizationId,
        },
        select: {
          userId: true,
        },
      });
      const orgUserIdsList = orgUserIds.map((ou) => ou.userId);

      // Build base conditions for organizationId
      const orgIdConditions: Prisma.AuditLogWhereInput[] = [
        { organizationId: input.organizationId },
      ];

      // Only include null organizationId logs if:
      // 1. The user list is not empty
      // 2. The log has a projectId (so we can determine it belongs to this org via the project)
      // We exclude logs where both organizationId and projectId are null
      if (orgUserIdsList.length > 0) {
        orgIdConditions.push({
          organizationId: null,
          userId: {
            in: orgUserIdsList,
          },
          projectId: {
            not: null,
          },
        });
      }

      // Build the where clause
      const where: Prisma.AuditLogWhereInput = {};

      // Build AND conditions
      const andConditions: Prisma.AuditLogWhereInput[] = [
        {
          OR: orgIdConditions,
        },
      ];

      // Add userId filter if provided
      if (input.userId) {
        andConditions.push({ userId: input.userId });
      }

      // Add action filter if provided
      if (input.action) {
        andConditions.push({
          action: {
            contains: input.action,
            mode: "insensitive" as const,
          },
        });
      }

      // Add projectId filter if provided
      if (input.projectId) {
        // When project is selected, show logs for that project OR organization-level (null projectId)
        andConditions.push({
          OR: [{ projectId: input.projectId }, { projectId: null }],
        });
      }

      // Add date range filter if provided
      if (input.startDate !== undefined || input.endDate !== undefined) {
        const dateFilter: {
          gte?: Date;
          lte?: Date;
        } = {};
        if (input.startDate !== undefined) {
          dateFilter.gte = new Date(input.startDate);
        }
        if (input.endDate !== undefined) {
          dateFilter.lte = new Date(input.endDate);
        }
        andConditions.push({
          createdAt: dateFilter,
        });
      }

      // If we have multiple conditions, use AND; otherwise use the single condition
      if (andConditions.length > 1) {
        where.AND = andConditions;
      } else {
        Object.assign(where, andConditions[0]);
      }

      // Get total count for pagination
      const totalCount = await ctx.prisma.auditLog.count({
        where,
      });

      // Get paginated audit logs
      const auditLogs = await ctx.prisma.auditLog.findMany({
        where,
        take: input.pageSize,
        skip: input.pageOffset,
        orderBy: {
          createdAt: "desc",
        },
      });

      // Get unique user IDs from audit logs
      const userIds = [...new Set(auditLogs.map((log) => log.userId))];

      // Get unique project IDs from audit logs
      const projectIds = [
        ...new Set(
          auditLogs
            .map((log) => log.projectId)
            .filter((id): id is string => !!id),
        ),
      ];

      // Fetch users in a single query
      const users = await ctx.prisma.user.findMany({
        where: {
          id: {
            in: userIds,
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      // Fetch projects in a single query
      const projects = await ctx.prisma.project.findMany({
        where: {
          id: {
            in: projectIds,
          },
        },
        select: {
          id: true,
          name: true,
        },
      });

      // Create maps for O(1) lookup
      const userMap = new Map(users.map((user) => [user.id, user]));
      const projectMap = new Map(
        projects.map((project) => [project.id, project]),
      );

      // Enrich audit logs with user and project data
      const enrichedAuditLogs = auditLogs.map((log) => ({
        ...log,
        user: userMap.get(log.userId) ?? null,
        project: log.projectId ? (projectMap.get(log.projectId) ?? null) : null,
      }));

      return {
        auditLogs: enrichedAuditLogs,
        totalCount,
      };
    }),
});
