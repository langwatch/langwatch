import {
  type Organization,
  type OrganizationUser,
  type Project,
  type Team,
  type TeamUser,
  type User,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import slugify from "slugify";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export type TeamWithProjects = Team & {
  projects: Project[];
};

export type FullyLoadedOrganization = Organization & {
  teams: TeamWithProjects[];
};

export type TeamMemberWithUser = TeamUser & {
  user: User;
};

export type TeamMemberWithTeam = TeamUser & {
  team: Team;
};

export type TeamWithMembersAndProjects = Team & {
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

      const orgId = nanoid();
      const orgSlug =
        slugify(input.orgName, { lower: true, strict: true }) +
        "-" +
        orgId.substring(0, 6);

      const teamId = nanoid();
      const teamSlug =
        slugify(input.orgName, { lower: true, strict: true }) +
        "-" +
        teamId.substring(0, 6);

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
          teams: {
            include: {
              projects: true,
            },
          },
        },
      });

    return organizations;
  }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string(),
        joinAllTeams: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const organizationUser = await prisma.organizationUser.findFirst({
        where: {
          userId: userId,
          organizationId: input.id,
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
          id: input.id,
        },
        data: {
          name: input.name,
          joinAllTeams: input.joinAllTeams,
        },
      });

      return { success: true };
    }),

  getOrganizationWithMembersAndTheirTeams: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const organization = await prisma.organization.findFirst({
        where: {
          id: input.id,
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
});
