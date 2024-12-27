import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { AlertType, TriggerAction } from "@prisma/client";
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
          members: z.string().array().optional(),
          slackWebhook: z.string().optional(),
          datasetId: z.string().optional(),
          datasetMapping: z.any().optional(),
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

      if (input.action === TriggerAction.SEND_SLACK_MESSAGE) {
        if (!input.actionParams.slackWebhook) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Slack webhook is required",
          });
        }
      } else if (input.action === TriggerAction.SEND_EMAIL) {
        const teamEmails = teamMembers.map((user) => user.user.email);

        if (input.actionParams.members) {
          input.actionParams.members.map((email: string) => {
            if (!teamEmails.includes(email)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Error with selected emails",
              });
            }
          });
        }
      }

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
      await ctx.prisma.trigger.update({
        where: {
          id: input.triggerId,
          projectId: input.projectId,
        },
        data: {
          deleted: true,
          active: false,
        },
      });

      return { success: true };
    }),
  addCustomMessage: protectedProcedure
    .input(
      z.object({
        triggerId: z.string(),
        message: z.string(),
        projectId: z.string(),
        alertType: z.nativeEnum(AlertType),
        name: z.string().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.TRIGGERS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.trigger.update({
        where: { id: input.triggerId, projectId: input.projectId },
        data: {
          message: input.message,
          alertType: input.alertType,
          name: input.name,
        },
      });
    }),
  getTriggers: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.TRIGGERS_MANAGE))
    .query(async ({ ctx, input }) => {
      const triggers = await ctx.prisma.trigger.findMany({
        where: {
          projectId: input.projectId,
          deleted: false,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const allCheckIds = triggers.flatMap((trigger) => {
        if (typeof trigger.filters === "string") {
          const triggerFilters = JSON.parse(trigger.filters);
          return extractCheckKeys(triggerFilters);
        } else {
          return [];
        }
      });

      const allChecks = await ctx.prisma.check.findMany({
        where: {
          id: {
            in: allCheckIds,
          },
          projectId: input.projectId,
        },
      });

      const checksMap = allChecks.reduce<
        Record<string, (typeof allChecks)[number]>
      >((map, check) => {
        map[check.id] = check;
        return map;
      }, {});

      const enhancedTriggers = triggers.map((trigger) => {
        let triggerFilters: Record<string, any> = {};

        if (typeof trigger.filters === "string") {
          triggerFilters = JSON.parse(trigger.filters);
        }

        const checkIds = extractCheckKeys(triggerFilters);

        const checks = checkIds.map((id) => checksMap[id]).filter(Boolean);

        return {
          ...trigger,
          checks,
        };
      });

      return enhancedTriggers;
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
