import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { previewCostRuleMatchingSpans } from "~/server/app-layer/traces/model-cost-span-preview.service";
import { prisma } from "~/server/db";
import { assertCanManageScope } from "~/server/modelProviders/modelProvider.authz";
import { resolveOrganizationForScope as resolveOrganizationForScopeOrNull } from "~/server/scopes/resolveOrganizationForScope";
import { SCOPE_TIERS, type ScopeTier } from "~/server/scopes/scope.types";
import { isSafeRegex } from "~/utils/safeRegex";
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
  const organizationId = await resolveOrganizationForScopeOrNull(client, {
    scopeType,
    scopeId,
  });
  if (!organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scope target not found.",
    });
  }
  return organizationId;
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
      z
        .object({
          id: z.string().optional(),
          projectId: z.string(),
          // Optional scope target. Defaults to the page's own project so the
          // existing project-level flow keeps working unchanged; an org admin
          // can pass ORGANIZATION/TEAM to push a cost down the cascade.
          scopeType: z.enum(SCOPE_TIERS).optional(),
          scopeId: z.string().optional(),
          model: z.string(),
          // Non-negative + finite: a negative or Infinite rate poisons spend
          // aggregation downstream (the sibling previewMatchingSpans guards the
          // same way).
          inputCostPerToken: z.number().nonnegative().finite().optional(),
          outputCostPerToken: z.number().nonnegative().finite().optional(),
          cacheReadCostPerToken: z.number().nonnegative().finite().optional(),
          cacheCreationCostPerToken: z
            .number()
            .nonnegative()
            .finite()
            .optional(),
          regex: z.string().refine((value) => isSafeRegex(value), {
            message:
              "Invalid or unsafe regular expression (avoid nested quantifiers like (a+)+)",
          }),
        })
        // resolveCustomTierRates treats a row with ANY rate set as a FULL
        // override of the registry, pricing every unset tier at $0. So the moment
        // any rate is configured, the base input+output pair MUST both be set —
        // otherwise a cache-only (or input-only) row silently prices the unset
        // base tier at $0 instead of falling back to the registry rate. A fully
        // rate-less row is allowed (it configures no override). The UI marks the
        // base rates required, but that guard is client-side only; this closes
        // the same hole for direct tRPC/SDK callers.
        .refine(
          (v) => {
            const anyRateSet =
              v.inputCostPerToken !== undefined ||
              v.outputCostPerToken !== undefined ||
              v.cacheReadCostPerToken !== undefined ||
              v.cacheCreationCostPerToken !== undefined;
            return (
              !anyRateSet ||
              (v.inputCostPerToken !== undefined &&
                v.outputCostPerToken !== undefined)
            );
          },
          {
            message:
              "Set both input and output cost per token when configuring any custom rate — a partial rate silently prices the unset base tier at $0 instead of using the registry rate.",
            path: ["outputCostPerToken"],
          },
        ),
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

      // Updating an existing row: the caller must also hold manage on the row's
      // CURRENT scope, not just the destination scope above. Without this a
      // caller who manages only scope X could pass another tenant's row id and
      // re-anchor it into X. Mirrors the delete handler's row-derived check.
      const existing = await ctx.prisma.customLLMModelCost.findUnique({
        where: { id },
        select: { scopeType: true, scopeId: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertCanManageScope(
        { prisma: ctx.prisma, session: ctx.session },
        { scopeType: existing.scopeType, scopeId: existing.scopeId },
      );

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

  /**
   * Live preview for the cost rule drawer: which recently-seen models (and
   * sample spans) would this regex match, and what would those spans cost at
   * the rates being edited. Gated on traces:view, the response exposes span
   * metadata (model names, token counts, trace ids), not cost-rule config.
   */
  previewMatchingSpans: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        model: z.string().max(512).optional(),
        regex: z
          .string()
          .min(1)
          .max(512)
          .refine((value) => isSafeRegex(value), {
            message:
              "Invalid or unsafe regular expression (avoid nested quantifiers like (a+)+)",
          }),
        inputCostPerToken: z.number().nonnegative().optional(),
        outputCostPerToken: z.number().nonnegative().optional(),
        cacheReadCostPerToken: z.number().nonnegative().optional(),
        cacheCreationCostPerToken: z.number().nonnegative().optional(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) =>
      previewCostRuleMatchingSpans({ spans: getApp().traces.spans, input }),
    ),
});
