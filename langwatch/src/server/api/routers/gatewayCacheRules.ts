/**
 * tRPC router for gateway cache-control rules.
 *
 * All routes are organization-scoped. RBAC gates:
 *   - list/get         → gatewayCacheRules:view
 *   - create           → gatewayCacheRules:create
 *   - update/archive   → gatewayCacheRules:update / gatewayCacheRules:delete
 *
 * The rule bundle surfaces to the gateway via config.materialiser (not this
 * router); this router is purely for the platform UI + CLI surface.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { GatewayCacheRuleService } from "~/server/gateway/cacheRule.service";

import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const matchersSchema = z
  .object({
    vk_id: z.string().optional(),
    vk_tags: z.array(z.string()).optional(),
    vk_prefix: z.string().optional(),
    principal_id: z.string().optional(),
    model: z.string().optional(),
    request_metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const actionSchema = z
  .object({
    mode: z.enum(["respect", "force", "disable"]),
    ttl: z.number().int().min(0).max(86_400).optional(),
    salt: z.string().max(64).optional(),
  })
  .strict();

async function requireOrgAccess(
  ctx: { prisma: import("@prisma/client").PrismaClient },
  organizationId: string,
) {
  const org = await ctx.prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "organization not found",
    });
  }
}

export const gatewayCacheRulesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("gatewayCacheRules:view"))
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayCacheRuleService.create(ctx.prisma);
      const rows = await service.list(input.organizationId);
      return rows.map(toDto);
    }),

  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("gatewayCacheRules:view"))
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayCacheRuleService.create(ctx.prisma);
      const row = await service.get(input.id, input.organizationId);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "cache rule not found",
        });
      }
      return toDto(row);
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(128),
        description: z.string().max(512).nullable().optional(),
        priority: z.number().int().min(0).max(1_000).optional(),
        enabled: z.boolean().optional(),
        matchers: matchersSchema,
        action: actionSchema,
      }),
    )
    .use(checkOrganizationPermission("gatewayCacheRules:create"))
    .mutation(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayCacheRuleService.create(ctx.prisma);
      const row = await service.create({
        organizationId: input.organizationId,
        name: input.name,
        description: input.description ?? null,
        priority: input.priority,
        enabled: input.enabled,
        matchers: input.matchers,
        action: input.action,
        actorUserId: ctx.session.user.id,
      });
      return toDto(row);
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().max(512).nullable().optional(),
        priority: z.number().int().min(0).max(1_000).optional(),
        enabled: z.boolean().optional(),
        matchers: matchersSchema.optional(),
        action: actionSchema.optional(),
      }),
    )
    .use(checkOrganizationPermission("gatewayCacheRules:update"))
    .mutation(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayCacheRuleService.create(ctx.prisma);
      const row = await service.update({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        priority: input.priority,
        enabled: input.enabled,
        matchers: input.matchers,
        action: input.action,
        actorUserId: ctx.session.user.id,
      });
      return toDto(row);
    }),

  archive: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("gatewayCacheRules:delete"))
    .mutation(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayCacheRuleService.create(ctx.prisma);
      const row = await service.archive({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: ctx.session.user.id,
      });
      return toDto(row);
    }),
});

function toDto(r: import("@prisma/client").GatewayCacheRule) {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    description: r.description,
    priority: r.priority,
    enabled: r.enabled,
    matchers: r.matchers,
    action: r.action,
    modeEnum: r.modeEnum,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
