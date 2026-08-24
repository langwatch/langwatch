/**
 * tRPC router for admin-defined routing policies.
 *
 * Multi-scope contract post-bug-7 step (vb): inputs accept a `scopes[]`
 * array of {scopeType, scopeId} entries. The legacy {scope, scopeId}
 * single-scope shape is gone — callers must migrate to the array form.
 *
 * RBAC: org-level "routingPolicies:manage" permission for mutations
 * (members can list). Mirrors the existing gatewayProviders router
 * pattern.
 */

import {
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyMustHaveScopeError,
  RoutingPolicyService,
} from "@ee/governance/services/routingPolicy.service";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { RoutingPolicyScopeType } from "~/generated/prisma/client";

import { suggestTierTargets } from "~/server/modelProviders/suggestTierTargets";
import { MODEL_TIERS } from "~/utils/modelTierPresets";

import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Translate the typed empty-providers / empty-scopes guards into 422
 * with stable codes the frontend can branch on.
 */
function mapServiceErrorToTrpc(err: unknown): never {
  if (err instanceof RoutingPolicyMustHaveProviderError) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof RoutingPolicyMustHaveScopeError) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof RoutingPolicyModelMustBeConcreteError) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

const scopeTypeSchema = z.nativeEnum(RoutingPolicyScopeType);
const scopesArraySchema = z
  .array(z.object({ scopeType: scopeTypeSchema, scopeId: z.string() }))
  .min(1, "Routing policy must include at least one scope");
const aliasesSchema = z.record(z.string(), z.string()).optional();
/**
 * A concrete, provider-qualified model id. Never a moving name: writing
 * "openai/latest" here would make the gateway dispatch a model literally
 * called "latest".
 */
const defaultModelSchema = z.string().min(1).max(256).nullable().optional();
const policyRulesSchema = z.record(z.string(), z.unknown()).optional();

export const routingPoliciesRouter = createTRPCRouter({
  /** List policies in an org, optionally filtered to those selectable from a given scope. */
  list: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        selectableForScope: z
          .object({ scopeType: scopeTypeSchema, scopeId: z.string() })
          .optional(),
      }),
    )
    .permission("routingPolicies:view")
    .query(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      return await service.list({
        organizationId: input.organizationId,
        selectableForScope: input.selectableForScope,
      });
    }),

  /** Get a single policy by id (includes its scope rows). */
  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("routingPolicies:view")
    .query(async ({ ctx, input }) => {
      const policy = await ctx.prisma.routingPolicy.findUnique({
        where: { id: input.id },
        include: { scopes: true },
      });
      if (!policy || policy.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return policy;
    }),

  /**
   * Models worth pointing a tier at, ranked. Server-side because the model
   * catalog is far too large to ship to the browser; the tier names and
   * labels themselves are client-safe and live in utils/modelTierPresets.
   */
  tierSuggestions: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        tier: z.enum(MODEL_TIERS),
        boundProviderTypes: z.array(z.string()).default([]),
      }),
    )
    .permission("routingPolicies:view")
    .query(({ input }) =>
      suggestTierTargets({
        tier: input.tier,
        boundProviderTypes: input.boundProviderTypes,
      }),
    ),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        scopes: scopesArraySchema,
        name: z.string().min(1).max(128),
        description: z.string().nullable().optional(),
        modelProviderIds: z
          .array(z.string())
          .min(
            1,
            "Routing policy must reference at least one provider credential",
          ),
        isDefault: z.boolean().default(false),
        modelAliases: aliasesSchema,
        defaultModel: defaultModelSchema,
        policyRules: policyRulesSchema,
      }),
    )
    .permission("routingPolicies:manage")
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      try {
        return await service.create({
          organizationId: input.organizationId,
          scopes: input.scopes,
          name: input.name,
          description: input.description ?? null,
          modelProviderIds: input.modelProviderIds,
          isDefault: input.isDefault,
          modelAliases: input.modelAliases,
          defaultModel: input.defaultModel ?? null,
          policyRules: input.policyRules,
          actorUserId: ctx.session.user.id,
        });
      } catch (err) {
        mapServiceErrorToTrpc(err);
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        modelProviderIds: z
          .array(z.string())
          .min(
            1,
            "Routing policy must reference at least one provider credential",
          )
          .optional(),
        modelAliases: aliasesSchema,
        defaultModel: defaultModelSchema,
        policyRules: policyRulesSchema,
      }),
    )
    .permission("routingPolicies:manage")
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      try {
        return await service.update({
          id: input.id,
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          modelProviderIds: input.modelProviderIds,
          modelAliases: input.modelAliases,
          defaultModel: input.defaultModel,
          policyRules: input.policyRules,
          actorUserId: ctx.session.user.id,
        });
      } catch (err) {
        mapServiceErrorToTrpc(err);
      }
    }),

  setDefault: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("routingPolicies:manage")
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      return await service.setDefault({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: ctx.session.user.id,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("routingPolicies:manage")
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      await service.delete({
        id: input.id,
        organizationId: input.organizationId,
      });
      return { ok: true };
    }),
});
