import { z } from "zod";
import { dependencies } from "../../../injection/dependencies.server";
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
      return await dependencies.subscriptionHandler.getActivePlan(
        input.organizationId,
        ctx.session.user,
      );
    }),
});
