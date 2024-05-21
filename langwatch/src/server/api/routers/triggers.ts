import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TriggerAction } from "@prisma/client";

import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const triggerRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        email: z.string(),
        name: z.string(),
        action: z.nativeEnum(TriggerAction),
        actionParams: z.any(),
        filters: z.any(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ALERTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      console.log("dasdasd", input);
      return ctx.prisma.trigger.create({
        data: {
          id: nanoid(),
          name: input.name,
          action: input.action,
          actionParams: input.actionParams,
          filters: input.filters,
          projectId: input.projectId,
        },
      });
    }),
  deleteById: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.trigger.delete({
        where: {
          id: input.datasetId,
        },
      });

      return { success: true };
    }),
});
