import { TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getApp } from "~/server/app-layer";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { slugify } from "~/utils/slugify";
import { checkOrganizationPermission, checkTeamPermission } from "../rbac";

// Reusable schema for team member role validation
const teamMemberRoleSchema = z
  .object({
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
  });

export const teamRouter = createTRPCRouter({
  getBySlug: protectedProcedure
    .input(z.object({ organizationId: z.string(), slug: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
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
    .use(checkOrganizationPermission("organization:view"))
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
              assignedRole: true,
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
    .use(checkOrganizationPermission("organization:view"))
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
              assignedRole: true,
            },
          },
          projects: true,
        },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      return team;
    }),
  update: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string(),
        members: z.array(teamMemberRoleSchema),
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

                // Create teamUser with CUSTOM role and custom role assignment
                await tx.teamUser.create({
                  data: {
                    userId: member.userId,
                    teamId: input.teamId,
                    role: TeamUserRole.CUSTOM,
                    assignedRoleId: member.customRoleId,
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

              // Update teamUser with CUSTOM role and assign custom role
              await tx.teamUser.update({
                where: {
                  userId_teamId: {
                    teamId: input.teamId,
                    userId: member.userId,
                  },
                },
                data: {
                  role: TeamUserRole.CUSTOM,
                  assignedRoleId: member.customRoleId,
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
                  assignedRoleId: null, // Clear custom role assignment
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
        members: z.array(teamMemberRoleSchema),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      // Check teams license limit
      const subscriptionLimits =
        await getApp().planProvider.getActivePlan({
          organizationId: input.organizationId,
          user: ctx.session.user,
        });

      if (!subscriptionLimits.overrideAddingLimitations) {
        const currentTeamCount = await prisma.team.count({
          where: { organizationId: input.organizationId },
        });

        if (currentTeamCount >= subscriptionLimits.maxTeams) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Over the limit of teams allowed",
          });
        }
      }

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
                ? TeamUserRole.CUSTOM
                : (member.role as TeamUserRole),
              assignedRoleId: isCustomRole ? member.customRoleId : null,
            },
          });

          if (isCustomRole) {
            // Verify the custom role belongs to the same organization
            const customRole = await tx.customRole.findUnique({
              where: { id: member.customRoleId! },
              select: { organizationId: true },
            });

            if (
              !customRole ||
              customRole.organizationId !== team.organizationId
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Custom role ${member.customRoleId} is invalid for this team`,
              });
            }
          }
        }

        // Post-creation validation: ensure we have at least one admin
        const finalAdminCount = await tx.teamUser.count({
          where: {
            teamId: team.id,
            role: TeamUserRole.ADMIN,
          },
        });

        if (finalAdminCount === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Team must have at least one admin",
          });
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
  removeMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
      }),
    )
    .use(checkTeamPermission("team:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      return await prisma.$transaction(async (tx) => {
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

        // Check if the target user is currently an admin
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

        if (adminCount === 1 && isTargetUserAdmin) {
          // Optional: Check for self-removal
          if (input.userId === ctx.session.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "You cannot remove yourself from the last admin position in this team",
            });
          }

          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot remove the last admin from this team",
          });
        }
        // Validate that the team exists
        const team = await tx.team.findUnique({
          where: { id: input.teamId },
          select: {
            id: true,
            name: true,
            organizationId: true,
          },
        });

        if (!team) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }

        // Remove the membership by unique constraint (atomic operation)
        await tx.teamUser.delete({
          where: {
            userId_teamId: {
              userId: input.userId,
              teamId: input.teamId,
            },
          },
        });

        // Post-removal validation: ensure we still have at least one admin
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

        // Return updated team data for client cache invalidation
        const updatedTeam = await tx.team.findUnique({
          where: { id: input.teamId },
          include: {
            members: {
              include: {
                user: true,
                assignedRole: true,
              },
            },
          },
        });

        return {
          success: true,
          team: updatedTeam,
          removedUserId: input.userId,
        };
      });
    }),
});
