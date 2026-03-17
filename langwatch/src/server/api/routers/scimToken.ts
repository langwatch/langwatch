import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOrganizationPermission } from "../rbac";
import { ScimTokenService } from "~/server/scim/scim-token.service";

export const scimTokenRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      const tokens = await ctx.prisma.scimToken.findMany({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          description: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return tokens;
    }),

  generate: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        description: z.string().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const tokenService = ScimTokenService.create(ctx.prisma);
      return tokenService.generate({
        organizationId: input.organizationId,
        description: input.description,
      });
    }),

  revoke: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        tokenId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.scimToken.delete({
        where: {
          id: input.tokenId,
          organizationId: input.organizationId,
        },
      });
      return { success: true };
    }),
});
