import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOrganizationPermission } from "../rbac";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";
import { getApp } from "~/server/app-layer/app";

const enterpriseScimProcedure = protectedProcedure
  .input(z.object({ organizationId: z.string() }))
  .use(checkOrganizationPermission("organization:manage"))
  .use(async ({ ctx, input, next }) => {
    await assertEnterprisePlan({
      organizationId: input.organizationId,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
    });
    return next({ ctx });
  });

export const scimTokenRouter = createTRPCRouter({
  list: enterpriseScimProcedure
    .query(async ({ input }) => {
      return getApp().scimTokens.listByOrganization({
        organizationId: input.organizationId,
      });
    }),

  generate: enterpriseScimProcedure
    .input(
      z.object({
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return getApp().scimTokens.generate({
        organizationId: input.organizationId,
        description: input.description,
      });
    }),

  revoke: enterpriseScimProcedure
    .input(
      z.object({
        tokenId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      await getApp().scimTokens.revoke({
        id: input.tokenId,
        organizationId: input.organizationId,
      });
      return { success: true };
    }),
});
