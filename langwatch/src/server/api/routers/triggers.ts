import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TriggerAction } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { extractCheckKeys } from "../utils";

import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const triggerRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        action: z.nativeEnum(TriggerAction),
        filters: z.any(),
        actionParams: z.object({
          members: z.string().array(),
        }),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.TRIGGERS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: {
          id: input.projectId,
        },
        select: {
          teamId: true,
        },
      });

      if (!project) {
        throw new Error(`Project with id ${input.projectId} not found`);
      }

      const teamMembers = await ctx.prisma.teamUser.findMany({
        where: {
          teamId: project.teamId,
        },
        include: {
          user: true,
        },
      });

      const teamEmails = teamMembers.map((user) => user.user.email);

      input.actionParams.members.map((email: string) => {
        if (!teamEmails.includes(email)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Error with selected emails",
          });
        }
      });

      return ctx.prisma.trigger.create({
        data: {
          id: nanoid(),
          name: input.name,
          action: input.action,
          actionParams: input.actionParams,
          filters: JSON.stringify(input.filters),
          projectId: input.projectId,
          lastRunAt: new Date().getTime(),
        },
      });
    }),
  deleteById: protectedProcedure
    .input(z.object({ projectId: z.string(), triggerId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.TRIGGERS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.trigger.delete({
        where: {
          id: input.triggerId,
          projectId: input.projectId,
        },
      });

      return { success: true };
    }),
  getTriggers: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.TRIGGERS_MANAGE))
    .query(async ({ ctx, input }) => {
      const triggers = await ctx.prisma.trigger.findMany({
        where: {
          projectId: input.projectId,
        },
      });

      // Parse filters from triggers to find relevant check IDs
      const checkIds = triggers.flatMap((trigger) => {
        const triggerFilters = JSON.parse(trigger.filters);
        const keys = extractCheckKeys(triggerFilters);
        console.log("keys", keys);

        return Object.keys(triggerFilters);
      });

      console.log("checkIds", checkIds);

      // Fetch checks based on extracted check IDs
      const checks = await ctx.prisma.check.findMany({
        where: {
          id: {
            in: checkIds,
          },
          projectId: input.projectId,
        },
      });

      // Combine triggers and checks into a single response
      return {
        triggers,
        checks,
      };
    }),
  toggleTrigger: protectedProcedure
    .input(
      z.object({
        triggerId: z.string(),
        active: z.boolean(),
        projectId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.TRIGGERS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.trigger.update({
        where: {
          id: input.triggerId,
          projectId: input.projectId,
        },
        data: {
          active: input.active,
          lastRunAt: new Date().getTime(),
        },
      });
    }),
});
