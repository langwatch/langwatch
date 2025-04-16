import { TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  checkUserPermissionForOrganization,
  checkUserPermissionForTeam,
  OrganizationRoleGroup,
  TeamRoleGroup,
} from "../permission";
import { nanoid } from "nanoid";
import { slugify } from "~/utils/slugify";

export const teamRouter = createTRPCRouter({
  getBySlug: protectedProcedure
    .input(z.object({ organizationId: z.string(), slug: z.string() }))
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW
      )
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const team = await prisma.team.findFirst({
        where: {
          slug: input.slug,
          organizationId: input.organizationId,
          members: {
            some: {
              userId: userId,
            },
          },
        },
      });

      return team;
    }),
  getTeamsWithMembers: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW
      )
    )
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const teams = await prisma.team.findMany({
        where: {
          organizationId: input.organizationId,
        },
        include: {
          members: {
            include: {
              user: true,
            },
          },
          projects: true,
        },
      });

      return teams;
    }),
  getTeamWithMembers: protectedProcedure
    .input(z.object({ slug: z.string(), organizationId: z.string() }))
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW
      )
    )
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const team = await prisma.team.findFirst({
        where: {
          slug: input.slug,
          organizationId: input.organizationId,
        },
        include: {
          members: {
            include: {
              user: true,
            },
          },
          projects: true,
        },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      await checkUserPermissionForTeam(TeamRoleGroup.TEAM_MEMBERS_MANAGE)({
        ctx,
        input: { teamId: team.id },
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        next: () => {},
      });

      return team;
    }),
  update: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string(),
        members: z.array(
          z.object({
            userId: z.string(),
            role: z.nativeEnum(TeamUserRole),
          })
        ),
      })
    )
    .use(checkUserPermissionForTeam(TeamRoleGroup.TEAM_MEMBERS_MANAGE))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      return await prisma.$transaction(async (tx) => {
        await tx.team.update({
          where: {
            id: input.teamId,
          },
          data: {
            name: input.name,
          },
        });

        if (input.members.length > 0) {
          const currentMembers = await tx.teamUser.findMany({
            where: {
              teamId: input.teamId,
            },
            select: {
              userId: true,
              role: true,
            },
          });

          const currentMembersMap = new Map(
            currentMembers.map((member) => [member.userId, member.role])
          );

          const newMembersMap = new Map(
            input.members.map((member) => [member.userId, member.role])
          );

          const membersToRemove = currentMembers
            .filter((member) => !newMembersMap.has(member.userId))
            .map((member) => member.userId);

          const membersToAdd = input.members.filter(
            (member) => !currentMembersMap.has(member.userId)
          );

          const membersToUpdate = input.members.filter(
            (member) =>
              currentMembersMap.has(member.userId) &&
              currentMembersMap.get(member.userId) !== member.role
          );

          if (membersToRemove.length > 0) {
            await tx.teamUser.deleteMany({
              where: {
                teamId: input.teamId,
                userId: {
                  in: membersToRemove,
                },
              },
            });
          }

          if (membersToAdd.length > 0) {
            await tx.teamUser.createMany({
              data: membersToAdd.map((member) => ({
                userId: member.userId,
                teamId: input.teamId,
                role: member.role,
              })),
            });
          }

          for (const member of membersToUpdate) {
            await tx.teamUser.update({
              where: {
                userId_teamId: {
                  teamId: input.teamId,
                  userId: member.userId,
                },
              },
              data: {
                role: member.role,
              },
            });
          }
        }

        return { success: true };
      });
    }),
  createTeamWithMembers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string(),
        members: z.array(
          z.object({
            userId: z.string(),
            role: z.nativeEnum(TeamUserRole),
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
      const teamNanoId = nanoid();
      const teamId = `team_${teamNanoId}`;
      const teamSlug =
        slugify(input.name, { lower: true, strict: true }) +
        "-" +
        teamNanoId.substring(0, 6);

      const team = await prisma.team.create({
        data: {
          id: teamId,
          name: input.name,
          slug: teamSlug,
          organizationId: input.organizationId,
        },
      });

      await prisma.teamUser.createMany({
        data: input.members.map((member) => ({
          userId: member.userId,
          teamId: team.id,
          role: member.role,
        })),
      });

      return team;
    }),
});
