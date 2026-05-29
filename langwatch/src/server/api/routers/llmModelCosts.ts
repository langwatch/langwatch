import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import safe from "safe-regex2";
import { z } from "zod";
import { prisma } from "~/server/db";
import { assertCanManageScope } from "~/server/modelProviders/modelProvider.authz";
import { SCOPE_TIERS, type ScopeTier } from "~/server/scopes/scope.types";
import { getModelLimits } from "../../../utils/modelLimits";
import { getLLMModelCosts } from "../../modelProviders/llmModelCost";
import { authorizeInResolver, checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Resolve the organization a (scopeType, scopeId) target belongs to, and
 * reject any target that does not resolve to a single organization. This is
 * the tenancy anchor: a custom cost can only ever be scoped within one org,
 * so a forged scope pointing at another org's team or project is refused.
 */
async function resolveOrganizationForScope(
  client: PrismaClient,
  scopeType: ScopeTier,
  scopeId: string,
): Promise<string> {
  if (scopeType === "ORGANIZATION") {
    const org = await client.organization.findUnique({
      where: { id: scopeId },
      select: { id: true },
    });
    if (!org) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
    }
    return org.id;
  }
  if (scopeType === "TEAM") {
    const team = await client.team.findUnique({
      where: { id: scopeId },
      select: { organizationId: true },
    });
    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }
    return team.organizationId;
  }
  const project = await client.project.findUnique({
    where: { id: scopeId },
    select: { team: { select: { organizationId: true } } },
  });
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  }
  return project.team.organizationId;
}

export const llmModelCostsRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(async ({ input }) => {
      return await getLLMModelCosts(input);
    }),

  createOrUpdate: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        // Optional scope target. Defaults to the page's own project so the
        // existing project-level flow keeps working unchanged; an org admin
        // can pass ORGANIZATION/TEAM to push a cost down the cascade.
        scopeType: z.enum(SCOPE_TIERS).optional(),
        scopeId: z.string().optional(),
        model: z.string(),
        inputCostPerToken: z.number().optional(),
        outputCostPerToken: z.number().optional(),
        cacheReadCostPerToken: z.number().optional(),
        cacheCreationCostPerToken: z.number().optional(),
        regex: z.string().refine((value) => isSafeRegex(value), {
          message:
            "Invalid or unsafe regular expression (avoid nested quantifiers like (a+)+)",
        }),
      }),
    )
    .use(authorizeInResolver)
    .mutation(async ({ input, ctx }) => {
      const {
        id,
        projectId,
        model,
        inputCostPerToken,
        outputCostPerToken,
        cacheReadCostPerToken,
        cacheCreationCostPerToken,
        regex,
      } = input;

      const scopeType: ScopeTier = input.scopeType ?? "PROJECT";
      const scopeId = input.scopeId ?? projectId;

      // The caller must hold manage on the scope they are writing to
      // (organization:manage / team:manage / project:manage), and the scope
      // must resolve to a single organization the cost is then anchored to.
      await assertCanManageScope(
        { prisma: ctx.prisma, session: ctx.session },
        { scopeType, scopeId },
      );
      const organizationId = await resolveOrganizationForScope(
        ctx.prisma,
        scopeType,
        scopeId,
      );

      // Keep the legacy projectId column populated only for PROJECT-tier rows
      // (one-release read compat). Org/team rows leave it null.
      const legacyProjectId = scopeType === "PROJECT" ? scopeId : null;

      if (!id) {
        return prisma.customLLMModelCost.create({
          data: {
            id: `llmcost_${nanoid()}`,
            organizationId,
            scopeType,
            scopeId,
            projectId: legacyProjectId,
            model,
            inputCostPerToken,
            outputCostPerToken,
            cacheReadCostPerToken,
            cacheCreationCostPerToken,
            regex,
          },
        });
      }

      return prisma.customLLMModelCost.update({
        where: { id },
        data: {
          organizationId,
          scopeType,
          scopeId,
          projectId: legacyProjectId,
          model,
          inputCostPerToken,
          outputCostPerToken,
          cacheReadCostPerToken,
          cacheCreationCostPerToken,
          regex,
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(authorizeInResolver)
    .mutation(async ({ input, ctx }) => {
      // Derive the scope from the row itself, then authorize manage on that
      // scope. Never trust a caller-supplied scope for a delete.
      const existing = await ctx.prisma.customLLMModelCost.findUnique({
        where: { id: input.id },
        select: { scopeType: true, scopeId: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertCanManageScope(
        { prisma: ctx.prisma, session: ctx.session },
        { scopeType: existing.scopeType, scopeId: existing.scopeId },
      );
      return await ctx.prisma.customLLMModelCost.delete({
        where: { id: input.id },
      });
    }),

  /**
   * Get model limits for a given model
   * TODO: This doesn't need to be protected, but TRPC throws without it
   * @param input - Input containing the project ID and model name
   * @returns Model limits or null if not found
   */
  getModelLimits: protectedProcedure
    .input(z.object({ projectId: z.string(), model: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input }) => getModelLimits(input.model)),
});

const isSafeRegex = (pattern: string): boolean => {
  try {
    const re = new RegExp(pattern);
    return safe(re);
  } catch {
    return false;
  }
};
