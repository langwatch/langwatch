import { z } from "zod";
import { previewCostRuleMatchingSpans } from "~/server/app-layer/traces/model-cost-span-preview.service";
import { SCOPE_TIERS, type ScopeTier } from "~/server/scopes/scope.types";
import { isSafeRegex } from "~/utils/safeRegex";
import { getModelLimits } from "../../../utils/modelLimits";
import { authorizeInResolver } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Resolve the organization a (scopeType, scopeId) target belongs to, and
 * reject any target that does not resolve to a single organization. This is
 * the tenancy anchor: a custom cost can only ever be scoped within one org,
 * so a forged scope pointing at another org's team or project is refused.
 */
export const llmModelCostsRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      return await ctx.app.modelProviders.listCosts(input);
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
        cacheCreation1hCostPerToken: z.number().optional(),
        regex: z.string().refine((value) => isSafeRegex(value), {
          message:
            "Invalid or unsafe regular expression (avoid nested quantifiers like (a+)+)",
        }),
      }),
    )
    .use(
      authorizeInResolver({
        projectId:
          "assertCanManageScope: manage is required on the written scope, which defaults to this project; the scope then resolves to a single organization the cost is anchored to",
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const {
        id,
        projectId,
        model,
        inputCostPerToken,
        outputCostPerToken,
        cacheReadCostPerToken,
        cacheCreationCostPerToken,
        cacheCreation1hCostPerToken,
        regex,
      } = input;

      const scopeType: ScopeTier = input.scopeType ?? "PROJECT";
      const scopeId = input.scopeId ?? projectId;

      // The caller must hold manage on the scope they are writing to
      // (organization:manage / team:manage / project:manage), and the scope
      // must resolve to a single organization the cost is then anchored to.
      return await ctx.app.modelProviders.upsertCost({
        id,
        projectId,
        scopeType,
        scopeId,
        model,
        regex,
        actorId: ctx.session?.user?.id,
        inputCostPerToken,
        outputCostPerToken,
        cacheReadCostPerToken,
        cacheCreationCostPerToken,
        cacheCreation1hCostPerToken,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(
      authorizeInResolver({
        projectId:
          "not trusted — the scope is derived from the stored row and assertCanManageScope runs against that scope, never the caller-supplied projectId",
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Derive the scope from the row itself, then authorize manage on that
      // scope. Never trust a caller-supplied scope for a delete.
      return await ctx.app.modelProviders.deleteCost({
        ...input,
        actorId: ctx.session?.user?.id,
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
    .permission("project:view")
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
        cacheCreation1hCostPerToken: z.number().nonnegative().optional(),
      }),
    )
    .permission("traces:view")
    .query(async ({ input, ctx }) =>
      previewCostRuleMatchingSpans({ spans: ctx.app.traces.spans, input }),
    ),
});
