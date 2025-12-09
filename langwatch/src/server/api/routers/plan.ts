import { z } from "zod";
import { dependencies } from "../../../injection/dependencies.server";
import {
  checkUserPermissionForOrganization,
  OrganizationRoleGroup,
} from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const planRouter = createTRPCRouter({
  getActivePlan: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW,
      ),
    )
    .query(async ({ input, ctx }) => {
      return await dependencies.subscriptionHandler.getActivePlan(
        input.organizationId,
        ctx.session.user,
      );
    }),
});
