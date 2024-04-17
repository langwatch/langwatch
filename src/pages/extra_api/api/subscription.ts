import { z } from "zod";
import {
  OrganizationRoleGroup,
  checkUserPermissionForOrganization,
} from "../../../../langwatch/langwatch/src/server/api/permission";
import {
  createTRPCRouter,
  protectedProcedure,
} from "../../../../langwatch/langwatch/src/server/api/trpc";

export const subscriptionRouter = () =>
  createTRPCRouter({
    create: protectedProcedure
      .input(
        z.object({
          organizationId: z.string(),
        })
      )
      .use(
        checkUserPermissionForOrganization(
          OrganizationRoleGroup.ORGANIZATION_MANAGE
        )
      )
      .mutation(async ({ input, ctx }) => {
        console.log("WOHOO STRIPE!~");
      }),
  });
