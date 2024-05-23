import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TriggerAction } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const triggerRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        members: z.string().array(),
        action: z.nativeEnum(TriggerAction),
        actionParams: z.any(),
        filters: z.any(),
        organizationId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ALERTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const organizationUsers = await ctx.prisma.organizationUser.findMany({
        where: {
          organizationId: input.organizationId,
        },
        include: {
          user: true,
        },
      });

      const organizationUserEmails = organizationUsers.map(
        (user) => user.user.email
      );

      input.members.map((email) => {
        if (!organizationUserEmails.includes(email)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Error with selected emails",
          });
        }
      });

      let actionParams = {};
      if (input.action === TriggerAction.SEND_EMAIL) {
        actionParams = {
          members: input.members,
        };
      } else if (input.action === TriggerAction.ADD_TO_DATASET) {
        actionParams = {
          datasetId: "yy",
        };
      }

      return ctx.prisma.trigger.create({
        data: {
          id: nanoid(),
          name: input.name,
          action: input.action,
          actionParams: actionParams,
          filters: input.filters,
          projectId: input.projectId,
        },
      });
    }),
  deleteById: protectedProcedure
    .input(z.object({ projectId: z.string(), triggerId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ALERTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.trigger.delete({
        where: {
          id: input.triggerId,
        },
      });

      return { success: true };
    }),
});
