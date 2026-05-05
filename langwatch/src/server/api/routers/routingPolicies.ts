/**
 * tRPC router for admin-defined routing policies.
 *
 * RBAC: org-level "routingPolicies:manage" permission for mutations
 * (members can list). Mirrors the existing gatewayProviders router
 * pattern.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyService,
} from "@ee/governance/services/routingPolicy.service";

import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Translate the typed empty-providers guard into the 422 contract Ariana
 * pinned in EC3. Zod min(1) at the schema layer is the primary surface
 * (clean inline form validation), but service-layer callers (dogfood
 * scripts, future code paths) bypass Zod — this mapping keeps the wire
 * contract consistent regardless of caller.
 */
function mapEmptyProviderToTrpc(err: unknown): never {
  if (err instanceof RoutingPolicyMustHaveProviderError) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

const scopeSchema = z.enum(["organization", "team", "project"]);
const strategySchema = z.enum(["priority", "cost", "latency", "round_robin"]);

export const routingPoliciesRouter = createTRPCRouter({
  /** List policies in an org, optionally filtered by scope. */
  list: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        scope: scopeSchema.optional(),
        scopeId: z.string().optional(),
      }),
    )
    .use(checkOrganizationPermission("routingPolicies:view"))
    .query(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      return await service.list({
        organizationId: input.organizationId,
        scope: input.scope,
        scopeId: input.scopeId,
      });
    }),

  /** Get a single policy by id. */
  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("routingPolicies:view"))
    .query(async ({ ctx, input }) => {
      const policy = await ctx.prisma.routingPolicy.findUnique({
        where: { id: input.id },
      });
      if (!policy || policy.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return policy;
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        scope: scopeSchema,
        scopeId: z.string(),
        name: z.string().min(1).max(128),
        description: z.string().nullable().optional(),
        // EC3 — a routing policy without provider credentials would
        // materialise an empty chain at gateway request time and fail
        // closed (per a5601f80a) but with no admin signal at create
        // time. Reject up front so the failure is visible at the form,
        // not at the next 'langwatch login'.
        providerCredentialIds: z
          .array(z.string())
          .min(1, "Routing policy must reference at least one provider credential"),
        modelAllowlist: z.array(z.string()).nullable().optional(),
        strategy: strategySchema.default("priority"),
        isDefault: z.boolean().default(false),
      }),
    )
    .use(checkOrganizationPermission("routingPolicies:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      try {
        return await service.create({
          organizationId: input.organizationId,
          scope: input.scope,
          scopeId: input.scopeId,
          name: input.name,
          description: input.description ?? null,
          providerCredentialIds: input.providerCredentialIds,
          modelAllowlist: input.modelAllowlist ?? null,
          strategy: input.strategy,
          isDefault: input.isDefault,
          actorUserId: ctx.session.user.id,
        });
      } catch (err) {
        mapEmptyProviderToTrpc(err);
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        // EC3 — same invariant as create: an empty chain on update
        // produces a policy that fails closed without surfacing the
        // root cause at edit time. `optional` lets callers omit the
        // field (no-op for chain), but when present it must be
        // non-empty.
        providerCredentialIds: z
          .array(z.string())
          .min(1, "Routing policy must reference at least one provider credential")
          .optional(),
        modelAllowlist: z.array(z.string()).nullable().optional(),
        strategy: strategySchema.optional(),
      }),
    )
    .use(checkOrganizationPermission("routingPolicies:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      try {
        return await service.update({
          id: input.id,
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          providerCredentialIds: input.providerCredentialIds,
          modelAllowlist: input.modelAllowlist,
          strategy: input.strategy,
          actorUserId: ctx.session.user.id,
        });
      } catch (err) {
        mapEmptyProviderToTrpc(err);
      }
    }),

  setDefault: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("routingPolicies:manage"))
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
    .use(checkOrganizationPermission("routingPolicies:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      await service.delete({ id: input.id, organizationId: input.organizationId });
      return { ok: true };
    }),
});
