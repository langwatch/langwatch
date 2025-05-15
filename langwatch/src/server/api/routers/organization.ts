import {
  OrganizationUserRole,
  type Organization,
  type OrganizationUser,
  type Project,
  type Team,
  type TeamUser,
  type User,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { slugify } from "~/utils/slugify";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { sendInviteEmail } from "../../mailer/inviteEmail";
import {
  OrganizationRoleGroup,
  TeamRoleGroup,
  checkUserPermissionForOrganization,
  checkUserPermissionForTeam,
  skipPermissionCheck,
} from "../permission";
import { env } from "~/env.mjs";
import { decrypt, encrypt } from "~/utils/encryption";
import { signUpDataSchema } from "./onboarding";
import { dependencies } from "../../../injection/dependencies.server";
import { elasticsearchMigrate } from "../../../tasks/elasticMigrate";
import { usageStatsQueue } from "~/server/background/queues/usageStatsQueue";

export type TeamWithProjects = Team & {
  projects: Project[];
};

export type TeamWithProjectsAndMembers = TeamWithProjects & {
  members: TeamUser[];
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
      })
    )
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const orgName = input.orgName
        ? input.orgName
        : ctx.session.user.name ?? "My Organization";
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
        }
      );

      // Add usage stats job for the new organization
      if (
        process.env.DISABLE_USAGE_STATS !== "true" &&
        process.env.IS_SAAS !== "true"
      ) {
        const instanceId = `${organization.name}__${organization.id}`;
        await usageStatsQueue.add(
          "usage_stats",
          {
            instance_id: instanceId,
            timestamp: Date.now(),
          },
          {
            jobId: `usage_stats_${instanceId}_${
              new Date().toISOString().split("T")[0]
            }`,
          }
        );
      }

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
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_MANAGE
      )
    )
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
      })
    )
    .use(skipPermissionCheck)
    .query(async ({ ctx, input }) => {
      const isDemo = input?.isDemo;
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;
      const demoProjectUserId = isDemo ? env.DEMO_PROJECT_USER_ID : "";

      const organizations: FullyLoadedOrganization[] =
        await prisma.organization.findMany({
          where: {
            members: {
              some: {
                OR: [{ userId: demoProjectUserId }, { userId: userId }],
              },
            },
          },
          include: {
            members: true,
            features: true,
            teams: {
              include: {
                members: true,
                projects: true,
              },
            },
          },
        });

      for (const organization of organizations) {
        for (const project of organization.teams.flatMap(
          (team) => team.projects
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
        }
      }
      for (const organization of organizations) {
        organization.members = organization.members.filter(
          (member) =>
            member.userId === userId || member.userId === demoProjectUserId
        );
        if (organization.s3AccessKeyId) {
          organization.s3AccessKeyId = decrypt(organization.s3AccessKeyId);
        }
        if (organization.s3SecretAccessKey) {
          organization.s3SecretAccessKey = decrypt(
            organization.s3SecretAccessKey
          );
        }
        if (organization.s3Endpoint) {
          organization.s3Endpoint = decrypt(organization.s3Endpoint);
        }
        if (organization.elasticsearchNodeUrl) {
          organization.elasticsearchNodeUrl = decrypt(
            organization.elasticsearchNodeUrl
          );
        }
        if (organization.elasticsearchApiKey) {
          organization.elasticsearchApiKey = decrypt(
            organization.elasticsearchApiKey
          );
        }

        const isExternal =
          organization.members[0]?.role !== "ADMIN" &&
          organization.members[0]?.role !== "MEMBER";

        organization.teams = organization.teams.filter((team) => {
          team.members = team.members.filter(
            (member) =>
              member.userId === userId || member.userId === demoProjectUserId
          );
          return isExternal
            ? team.members.some((member) => member.userId === userId)
            : true;
        });
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
          }
        )
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_MANAGE
      )
    )
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
      })
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW
      )
    )
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
                    include: {
                      team: true,
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
  createInvites: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        invites: z.array(
          z.object({
            email: z.string().email(),
            teamIds: z.string(),
            role: z.nativeEnum(OrganizationUserRole),
          })
        ),
      })
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_MANAGE
      )
    )
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
          ctx.session.user
        );

      if (
        !subscriptionLimits.overrideAddingLimitations &&
        organization.members.length >= subscriptionLimits.maxMembers
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Over the limit of invites allowed",
        });
      }

      const invites = await Promise.all(
        input.invites.map(async (invite) => {
          if (!invite.email.trim() || !invite.teamIds.trim()) {
            return null;
          }

          // Filter out team IDs that do not belong to the organization
          const validTeamIds = (
            await prisma.team.findMany({
              where: {
                id: { in: invite.teamIds.split(",") },
                organizationId: input.organizationId,
              },
              select: { id: true },
            })
          ).map((team) => team.id);

          // If no valid team IDs are found, skip this invite
          if (validTeamIds.length === 0) {
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
              teamIds: validTeamIds.join(","),
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
        })
      );

      // Filter out any null values (skipped invites)
      return invites.filter(Boolean);
    }),
  deleteInvite: protectedProcedure
    .input(z.object({ inviteId: z.string(), organizationId: z.string() }))
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_MANAGE
      )
    )
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
      })
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW
      )
    )
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
      })
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
        await prisma.organizationUser.create({
          data: {
            userId: session.user.id,
            organizationId: invite.organizationId,
            role: invite.role,
          },
        });

        const organizationToTeamRoleMap: {
          [K in OrganizationUserRole]: TeamUserRole;
        } = {
          [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
          [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
          [OrganizationUserRole.EXTERNAL]: TeamUserRole.VIEWER,
        };

        const teamIds = invite.teamIds.split(",");
        for (const teamId of teamIds) {
          await prisma.teamUser.create({
            data: {
              userId: session.user.id,
              teamId: teamId,
              role: organizationToTeamRoleMap[invite.role],
            },
          });
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
      z.object({
        teamId: z.string(),
        userId: z.string(),
        role: z.nativeEnum(TeamUserRole),
      })
    )
    .use(checkUserPermissionForTeam(TeamRoleGroup.TEAM_MEMBERS_MANAGE))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      await prisma.teamUser.update({
        where: {
          userId_teamId: {
            userId: input.userId,
            teamId: input.teamId,
          },
        },
        data: {
          role: input.role,
        },
      });

      return { success: true };
    }),
  getAllOrganizationMembers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      })
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW
      )
    )
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
      })
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_MANAGE
      )
    )
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      if (input.role !== OrganizationUserRole.ADMIN) {
        const currentMember = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: input.userId,
              organizationId: input.organizationId,
            },
          },
        });

        if (currentMember?.role === OrganizationUserRole.ADMIN) {
          const adminCount = await prisma.organizationUser.count({
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

      await prisma.organizationUser.update({
        where: {
          userId_organizationId: {
            userId: input.userId,
            organizationId: input.organizationId,
          },
        },
        data: { role: input.role },
      });

      return { success: true };
    }),
});
