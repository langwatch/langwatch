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
import slugify from "slugify";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { sendInviteEmail } from "../../mailer/inviteEmail";
import {
  OrganizationRoleGroup,
  TeamRoleGroup,
  checkUserPermissionForOrganization,
  checkUserPermissionForTeam,
} from "../permission";

export type TeamWithProjects = Team & {
  projects: Project[];
};

export type TeamWithProjectsAndMembers = TeamWithProjects & {
  members: TeamUser[];
};

export type FullyLoadedOrganization = Organization & {
  members: OrganizationUser[];
  teams: TeamWithProjectsAndMembers[];
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
        orgName: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const orgNanoId = nanoid();
      const orgId = `organization_${orgNanoId}`;
      const orgSlug =
        slugify(input.orgName, { lower: true, strict: true }) +
        "-" +
        orgNanoId.substring(0, 6);

      const teamNanoId = nanoid();
      const teamId = `team_${teamNanoId}`;
      const teamSlug =
        slugify(input.orgName, { lower: true, strict: true }) +
        "-" +
        teamNanoId.substring(0, 6);

      await prisma.$transaction(async (prisma) => {
        // 1. Create the organization
        const organization = await prisma.organization.create({
          data: {
            id: orgId,
            name: input.orgName,
            slug: orgSlug,
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
            name: input.orgName, // Same name as organization
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
      });

      // Return success response
      return { success: true, teamSlug };
    }),

  getAll: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const prisma = ctx.prisma;

    const organizations: FullyLoadedOrganization[] =
      await prisma.organization.findMany({
        where: {
          members: {
            some: {
              userId: userId,
            },
          },
        },
        include: {
          members: true,
          teams: {
            include: {
              members: true,
              projects: true,
            },
          },
        },
      });

    for (const organization of organizations) {
      organization.members = organization.members.filter(
        (member) => member.userId === userId
      );
      const isExternal =
        organization.members[0]?.role !== "ADMIN" &&
        organization.members[0]?.role !== "MEMBER";

      organization.teams = organization.teams.filter((team) => {
        team.members = team.members.filter(
          (member) => member.userId === userId
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
      z.object({
        organizationId: z.string(),
        name: z.string(),
      })
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
        },
      });

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
      const userId = ctx.session.user.id;

      // Check if the user is an admin of the organization
      const organization = await prisma.organization.findFirst({
        where: {
          id: input.organizationId,
          members: {
            some: {
              userId: userId,
              role: "ADMIN",
            },
          },
        },
      });

      if (!organization) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must be an admin to send invites.",
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

          await sendInviteEmail({
            email: invite.email,
            organization,
            inviteCode,
          });

          return savedInvite;
        })
      );

      // Filter out any null values (skipped invites)
      return invites.filter(Boolean);
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
          where: { id: invite.id },
          data: { status: "ACCEPTED" },
        });
      });

      return { success: true, invite };
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
});
