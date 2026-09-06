import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const planRouter = createTRPCRouter({
  getActivePlan: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .permission("organization:view")
    .query(async ({ input, ctx }) => {
      return await getApp().planProvider.getActivePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
      });
    }),
});
