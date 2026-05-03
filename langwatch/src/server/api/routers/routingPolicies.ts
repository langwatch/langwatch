/**
 * tRPC router for admin-defined routing policies.
 *
 * RBAC: org-level "organization:manage" permission for mutations
 * (members can list). Mirrors the existing gatewayProviders router
 * pattern.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { RoutingPolicyService } from "@ee/governance/services/routingPolicy.service";

import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

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
    .use(checkOrganizationPermission("organization:view"))
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
    .use(checkOrganizationPermission("organization:view"))
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
        providerCredentialIds: z.array(z.string()).default([]),
        modelAllowlist: z.array(z.string()).nullable().optional(),
        strategy: strategySchema.default("priority"),
        isDefault: z.boolean().default(false),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
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
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        providerCredentialIds: z.array(z.string()).optional(),
        modelAllowlist: z.array(z.string()).nullable().optional(),
        strategy: strategySchema.optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
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
    }),

  setDefault: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
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
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = new RoutingPolicyService(ctx.prisma);
      await service.delete({ id: input.id, organizationId: input.organizationId });
      return { ok: true };
    }),
});
