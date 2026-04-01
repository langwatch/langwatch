import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOrganizationPermission } from "../rbac";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";
import { ScimTokenService } from "~/server/scim/scim-token.service";

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
      await ctx.prisma.scimToken.delete({
        where: {
          id: input.tokenId,
          organizationId: input.organizationId,
        },
      });
      return { success: true };
    }),

  listTeamMappings: enterpriseScimProcedure
    .query(async ({ ctx, input }) => {
      const teams = await ctx.prisma.team.findMany({
        where: {
          organizationId: input.organizationId,
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          externalScimId: true,
        },
        orderBy: { name: "asc" },
      });
      return teams;
    }),

  linkTeam: enterpriseScimProcedure
    .input(
      z.object({
        teamId: z.string(),
        externalScimId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.team.update({
        where: {
          id: input.teamId,
          organizationId: input.organizationId,
        },
        data: { externalScimId: input.externalScimId },
      });
      return { success: true };
    }),

  unlinkTeam: enterpriseScimProcedure
    .input(
      z.object({
        teamId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.team.update({
        where: {
          id: input.teamId,
          organizationId: input.organizationId,
        },
        data: { externalScimId: null },
      });
      return { success: true };
    }),
});
