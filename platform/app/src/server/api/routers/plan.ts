import { z } from "zod";
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
      return await ctx.app.planProvider.getActivePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
      });
    }),
});
