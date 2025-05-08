import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  OrganizationRoleGroup,
  checkUserPermissionForOrganization,
} from "../permission";
import { dependencies } from "../../../injection/dependencies.server";

export const planRouter = createTRPCRouter({
  getActivePlan: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      })
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW
      )
    )
    .query(async ({ input, ctx }) => {
      return await dependencies.subscriptionHandler.getActivePlan(
        input.organizationId,
        ctx.session.user
      );
    }),
});
