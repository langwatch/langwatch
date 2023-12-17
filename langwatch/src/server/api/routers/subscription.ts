import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { checkUserPermissionForOrganization } from "../permission";
import { dependencies } from "../../../dependencies";

export const subscriptionRouter = createTRPCRouter({
  getSubscriptionLimits: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      })
    )
    .use(checkUserPermissionForOrganization)
    .query(async ({ input }) => {
      // console.log('dependencies.subscriptionHandler', dependencies.subscriptionHandler);
      // // eslint-disable-next-line @typescript-eslint/unbound-method
      // console.log('dependencies.subscriptionHandler.getLimits', dependencies.subscriptionHandler.getLimits);
      // return {
      //   maxMembers: 99991,
      // };
      console.log("going to query")
      return await dependencies.subscriptionHandler.getLimits(input.organizationId);
    }),
});
