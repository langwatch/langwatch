import { TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  checkUserPermissionForOrganization,
  OrganizationRoleGroup,
} from "../permission";
import { checkTeamPermission } from "../rbac";
import { nanoid } from "nanoid";
import { slugify } from "~/utils/slugify";

export const teamRouter = createTRPCRouter({
  getBySlug: protectedProcedure
    .input(z.object({ organizationId: z.string(), slug: z.string() }))
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW,
      ),
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
        OrganizationRoleGroup.ORGANIZATION_VIEW,
      ),
    )
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const teams = await prisma.team.findMany({
        where: {
          organizationId: input.organizationId,
          archivedAt: null,
        },
        include: {
          members: {
            include: {
              user: true,
            },
          },
          customRoleMembers: {
            include: {
              customRole: true,
              user: true,
            },
          },
          projects: {
            where: {
              archivedAt: null,
            },
          },
        },
      });

      return teams;
    }),
  getTeamWithMembers: protectedProcedure
    .input(z.object({ slug: z.string(), organizationId: z.string() }))
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW,
      ),
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
          customRoleMembers: {
            include: {
              customRole: true,
              user: true,
            },
          },
          projects: true,
        },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      await checkTeamPermission("team:manage")({
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
            role: z.string(),
            customRoleId: z.string().optional(),
          }),
        ),
      }),
    )
    .use(checkTeamPermission("team:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      return await prisma.$transaction(async (tx) => {
        const updateData: any = {
          name: input.name,
        };

        await tx.team.update({
          where: {
            id: input.teamId,
          },
          data: updateData,
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
            currentMembers.map((member) => [member.userId, member.role]),
          );

          const newMembersMap = new Map(
            input.members.map((member) => [member.userId, member.role]),
          );

          const membersToRemove = currentMembers
            .filter((member) => !newMembersMap.has(member.userId))
            .map((member) => member.userId);

          const membersToAdd = input.members.filter(
            (member) => !currentMembersMap.has(member.userId),
          );

          const membersToUpdate = input.members.filter(
            (member) =>
              currentMembersMap.has(member.userId) &&
              currentMembersMap.get(member.userId) !== member.role,
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
            // Also remove custom role assignments
            await tx.teamUserCustomRole.deleteMany({
              where: {
                teamId: input.teamId,
                userId: {
                  in: membersToRemove,
                },
              },
            });
          }

          if (membersToAdd.length > 0) {
            for (const member of membersToAdd) {
              const isCustomRole = member.role.startsWith("custom:");

              if (isCustomRole) {
                // Validate custom role requirements
                if (!member.customRoleId) {
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: `customRoleId is required when role is a custom role for user ${member.userId}`,
                  });
                }

                // Validate custom role belongs to team's organization
                const [team, customRole] = await Promise.all([
                  tx.team.findUnique({
                    where: { id: input.teamId },
                    select: { organizationId: true },
                  }),
                  tx.customRole.findUnique({
                    where: { id: member.customRoleId },
                    select: { organizationId: true },
                  }),
                ]);

                if (!team) {
                  throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Team not found",
                  });
                }

                if (!customRole) {
                  throw new TRPCError({
                    code: "NOT_FOUND",
                    message: `Custom role ${member.customRoleId} not found`,
                  });
                }

                if (customRole.organizationId !== team.organizationId) {
                  throw new TRPCError({
                    code: "FORBIDDEN",
                    message: `Custom role ${member.customRoleId} does not belong to team's organization`,
                  });
                }

                // Create teamUser with VIEWER role and custom role assignment
                await tx.teamUser.create({
                  data: {
                    userId: member.userId,
                    teamId: input.teamId,
                    role: TeamUserRole.VIEWER,
                  },
                });

                await tx.teamUserCustomRole.create({
                  data: {
                    userId: member.userId,
                    teamId: input.teamId,
                    customRoleId: member.customRoleId,
                  },
                });
              } else {
                // Built-in role - create teamUser with the specified role
                await tx.teamUser.create({
                  data: {
                    userId: member.userId,
                    teamId: input.teamId,
                    role: member.role as TeamUserRole,
                  },
                });
              }
            }
          }

          for (const member of membersToUpdate) {
            const isCustomRole = member.role.startsWith("custom:");

            if (isCustomRole) {
              // Validate custom role requirements
              if (!member.customRoleId) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `customRoleId is required when role is a custom role for user ${member.userId}`,
                });
              }

              // Validate custom role belongs to team's organization
              const [team, customRole] = await Promise.all([
                tx.team.findUnique({
                  where: { id: input.teamId },
                  select: { organizationId: true },
                }),
                tx.customRole.findUnique({
                  where: { id: member.customRoleId },
                  select: { organizationId: true },
                }),
              ]);

              if (!team) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: "Team not found",
                });
              }

              if (!customRole) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: `Custom role ${member.customRoleId} not found`,
                });
              }

              if (customRole.organizationId !== team.organizationId) {
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: `Custom role ${member.customRoleId} does not belong to team's organization`,
                });
              }

              // Update teamUser with VIEWER role
              await tx.teamUser.update({
                where: {
                  userId_teamId: {
                    teamId: input.teamId,
                    userId: member.userId,
                  },
                },
                data: {
                  role: TeamUserRole.VIEWER,
                },
              });

              // Remove existing custom roles
              await tx.teamUserCustomRole.deleteMany({
                where: {
                  userId: member.userId,
                  teamId: input.teamId,
                },
              });

              // Add new custom role
              await tx.teamUserCustomRole.create({
                data: {
                  userId: member.userId,
                  teamId: input.teamId,
                  customRoleId: member.customRoleId,
                },
              });
            } else {
              // Built-in role - update teamUser with the specified role
              await tx.teamUser.update({
                where: {
                  userId_teamId: {
                    teamId: input.teamId,
                    userId: member.userId,
                  },
                },
                data: {
                  role: member.role as TeamUserRole,
                },
              });

              // Remove existing custom roles when switching to built-in role
              await tx.teamUserCustomRole.deleteMany({
                where: {
                  userId: member.userId,
                  teamId: input.teamId,
                },
              });
            }
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
            role: z.string(),
            customRoleId: z.string().optional(),
          }),
        ),
      }),
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_MANAGE,
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const teamNanoId = nanoid();
      const teamId = `team_${teamNanoId}`;
      const teamSlug =
        slugify(input.name, { lower: true, strict: true }) +
        "-" +
        teamNanoId.substring(0, 6);

      return await prisma.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: {
            id: teamId,
            name: input.name,
            slug: teamSlug,
            organizationId: input.organizationId,
          },
        });

        for (const member of input.members) {
          const isCustomRole = member.role.startsWith("custom:");

          if (isCustomRole && !member.customRoleId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `customRoleId is required when role is a custom role for user ${member.userId}`,
            });
          }

          await tx.teamUser.create({
            data: {
              userId: member.userId,
              teamId: team.id,
              role: isCustomRole
                ? TeamUserRole.VIEWER
                : (member.role as TeamUserRole),
            },
          });

          if (isCustomRole) {
            await tx.teamUserCustomRole.create({
              data: {
                userId: member.userId,
                teamId: team.id,
                customRoleId: member.customRoleId!,
              },
            });
          }
        }

        return team;
      });
    }),
  archiveById: protectedProcedure
    .input(z.object({ teamId: z.string(), projectId: z.string() }))
    .use(checkTeamPermission("team:delete"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      await prisma.team.update({
        where: { id: input.teamId },
        data: { archivedAt: new Date() },
      });
      return { success: true };
    }),
});
