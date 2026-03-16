import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOrganizationPermission } from "../rbac";
import { generateScimToken } from "~/server/scim/scim-token";
import { TRPCError } from "@trpc/server";

/**
 * tRPC router for SCIM token management.
 * All procedures require organization admin permissions.
 */
export const scimRouter = createTRPCRouter({
  createToken: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const { plainToken, tokenHash, tokenPrefix } =
        await generateScimToken();

      await ctx.prisma.scimToken.create({
        data: {
          organizationId: input.organizationId,
          tokenHash,
          tokenPrefix,
          createdById: ctx.session.user.id,
        },
      });

      // Return the plain token once - it cannot be retrieved again
      return { token: plainToken, tokenPrefix };
    }),

  listTokens: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const tokens = await ctx.prisma.scimToken.findMany({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          tokenPrefix: true,
          createdAt: true,
          expiresAt: true,
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return tokens;
    }),

  revokeToken: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        tokenId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const token = await ctx.prisma.scimToken.findFirst({
        where: {
          id: input.tokenId,
          organizationId: input.organizationId,
        },
      });

      if (!token) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Token not found",
        });
      }

      await ctx.prisma.scimToken.delete({
        where: { id: input.tokenId },
      });

      return { success: true };
    }),
});
