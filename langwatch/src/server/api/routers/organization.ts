import {
  type CustomRole,
  type Organization,
  type OrganizationUser,
  OrganizationUserRole,
  type Prisma,
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
import { scheduleUsageStatsForOrganization } from "~/server/background/queues/usageStatsQueue";
import { decrypt, encrypt } from "~/utils/encryption";
import { slugify } from "~/utils/slugify";
import { dependencies } from "../../../injection/dependencies.server";
import { elasticsearchMigrate } from "../../../tasks/elasticMigrate";
import { sendInviteEmail } from "../../mailer/inviteEmail";
import { skipPermissionCheck } from "../permission";
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

      const subscriptionLimits =
        await dependencies.subscriptionHandler.getActivePlan(
          input.organizationId,
          ctx.session.user,
        );

      // Count existing members by type
      const fullMemberCount = organization.members.filter(
        (m) => m.role !== OrganizationUserRole.EXTERNAL
      ).length;
      const liteMemberCount = organization.members.filter(
        (m) => m.role === OrganizationUserRole.EXTERNAL
      ).length;

      // Count new invites by type
      const newFullMembers = input.invites.filter(
        (i) => i.role !== OrganizationUserRole.EXTERNAL
      ).length;
      const newLiteMembers = input.invites.filter(
        (i) => i.role === OrganizationUserRole.EXTERNAL
      ).length;

      // Check limits separately for full members and lite members
      if (!subscriptionLimits.overrideAddingLimitations) {
        if (fullMemberCount + newFullMembers > subscriptionLimits.maxMembers) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Over the limit of full members allowed",
          });
        }
        if (liteMemberCount + newLiteMembers > subscriptionLimits.maxMembersLite) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Over the limit of lite members allowed",
          });
        }
      }

      const invites = await Promise.all(
        input.invites.map(async (invite) => {
          // Support both new teams array and legacy teamIds string
          let teamAssignments: Array<{
            teamId: string;
            role: TeamUserRole;
            customRoleId?: string;
          }> = [];
          let teamIdsString = "";

          if (invite.teams && invite.teams.length > 0) {
            // New format: teams array with roles
            const teamIds = invite.teams.map((t) => t.teamId);

            // Filter out team IDs that do not belong to the organization
            const validTeams = await prisma.team.findMany({
              where: {
                id: { in: teamIds },
                organizationId: input.organizationId,
              },
              select: { id: true },
            });

            const validTeamIds = validTeams.map((team) => team.id);

            // If no valid team IDs are found, skip this invite
            if (validTeamIds.length === 0) {
              return null;
            }

            // Build teamAssignments with only valid teams
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
                // Validate custom roles have customRoleId
                if (t.role === TeamUserRole.CUSTOM && !t.customRoleId) {
                  return false;
                }
                return true;
              });

            teamIdsString = validTeamIds.join(",");
          } else if (invite.teamIds?.trim()) {
            // Legacy format: comma-separated teamIds string
            const teamIdArray = invite.teamIds
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);

            // Filter out team IDs that do not belong to the organization
            const validTeams = await prisma.team.findMany({
              where: {
                id: { in: teamIdArray },
                organizationId: input.organizationId,
              },
              select: { id: true },
            });

            const validTeamIds = validTeams.map((team) => team.id);

            // If no valid team IDs are found, skip this invite
            if (validTeamIds.length === 0) {
              return null;
            }

            // For legacy format, use organization role mapping (backward compatibility)
            const organizationToTeamRoleMap: {
              [K in OrganizationUserRole]: TeamUserRole;
            } = {
              [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
              [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
              [OrganizationUserRole.EXTERNAL]: TeamUserRole.VIEWER,
            };

            teamAssignments = validTeamIds.map((teamId) => ({
              teamId,
              role: organizationToTeamRoleMap[invite.role],
            }));

            teamIdsString = validTeamIds.join(",");
          } else {
            // No teams provided
            return null;
          }

          if (!invite.email.trim()) {
            return null;
          }

          // Checks that a valid pending invite does not already exist for this email and organization
          const existingInvite = await prisma.organizationInvite.findFirst({
            where: {
              email: invite.email,
              organizationId: input.organizationId,
              expiration: { gt: new Date() },
              status: "PENDING",
            },
          });

          if (existingInvite) {
            return null;
          }

          const inviteCode = nanoid();
          const savedInvite = await prisma.organizationInvite.create({
            data: {
              email: invite.email,
              inviteCode: inviteCode,
              expiration: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
              organizationId: input.organizationId,
              teamIds: teamIdsString,
              teamAssignments:
                teamAssignments.length > 0 ? teamAssignments : undefined,
              role: invite.role,
            },
          });

          if (env.SENDGRID_API_KEY) {
            await sendInviteEmail({
              email: invite.email,
              organization,
              inviteCode,
            });
          }

          return {
            invite: savedInvite,
            noEmailProvider: !env.SENDGRID_API_KEY,
          };
        }),
      );

      // Filter out any null values (skipped invites)
      return invites.filter(Boolean);
    }),
  deleteInvite: protectedProcedure
    .input(z.object({ inviteId: z.string(), organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      await prisma.organizationInvite.delete({
        where: { id: input.inviteId, organizationId: input.organizationId },
      });
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
          expiration: { gt: new Date() },
          status: "PENDING",
        },
      });

      return invites;
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

      if (!invite || invite.expiration < new Date()) {
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
          const organizationToTeamRoleMap: {
            [K in OrganizationUserRole]: TeamUserRole;
          } = {
            [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
            [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
            [OrganizationUserRole.EXTERNAL]: TeamUserRole.VIEWER,
          };

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
            role: organizationToTeamRoleMap[invite.role],
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
            select: { organizationId: true },
          });
          if (!role || role.organizationId !== team.organizationId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Role does not belong to team's organization",
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
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      return await prisma.$transaction(async (tx) => {
        if (input.role !== OrganizationUserRole.ADMIN) {
          // Lock the target user's membership row to prevent concurrent modifications
          const currentMember = await tx.organizationUser.findUnique({
            where: {
              userId_organizationId: {
                userId: input.userId,
                organizationId: input.organizationId,
              },
            },
          });

          if (currentMember?.role === OrganizationUserRole.ADMIN) {
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
        }

        await tx.organizationUser.update({
          where: {
            userId_organizationId: {
              userId: input.userId,
              organizationId: input.organizationId,
            },
          },
          data: { role: input.role },
        });

        // Post-update validation: ensure we still have at least one admin
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
