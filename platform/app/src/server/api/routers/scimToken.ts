import { ScimTokenService } from "@ee/scim/scim-token.service";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";

const enterpriseScimProcedure = protectedProcedure
  .input(z.object({ organizationId: z.string() }))
  .permission("organization:manage")
  .use(async ({ ctx, input, next }) => {
    await assertEnterprisePlan({
      organizationId: input.organizationId,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
    });
    return next({ ctx });
  });

export const scimTokenRouter = createTRPCRouter({
  list: enterpriseScimProcedure.query(async ({ ctx, input }) => {
    const tokenService = ScimTokenService.create(ctx.prisma);
    return tokenService.list({ organizationId: input.organizationId });
  }),

  generate: enterpriseScimProcedure
    .input(
      z.object({
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenService = ScimTokenService.create(ctx.prisma);
      return tokenService.generate({
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
    .mutation(async ({ ctx, input }) => {
      const tokenService = ScimTokenService.create(ctx.prisma);
      return tokenService.revoke({
        organizationId: input.organizationId,
        tokenId: input.tokenId,
      });
    }),
});
