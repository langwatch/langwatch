import { z } from "zod";
import { SubscriptionHandler } from "~/server/subscriptionHandler";
import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const planRouter = createTRPCRouter({
  getActivePlan: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      return await SubscriptionHandler.getActivePlan(
        input.organizationId,
        ctx.session.user,
      );
    }),
});
