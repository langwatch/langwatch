/**
 * tRPC router for AI Gateway virtual keys.
 *
 * Org-scoped (iter 110). Every procedure takes `organizationId` as the
 * tenant key and gates on `virtualKeys:view` / `virtualKeys:manage` /
 * `virtualKeys:rotate` / `virtualKeys:delete` at the organization
 * scope. Per-scope enforcement (a caller can only create a VK at
 * scopes where they hold `virtualKeys:manage`) lives in the service
 * layer via `assertCanManageScopes`. Tier 2 lane A1 of the
 * VK + ModelProvider refactor.
 *
 * Reads return the camel-cased DTO (`toVirtualKeyCamelDto`) — the
 * `scopes[]` array + `routingPolicyId` carry the new eligible-provider
 * derivation; the legacy `providerCredentialIds`/`providerChain`
 * fields are no longer surfaced.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { virtualKeyConfigSchema } from "~/server/gateway/virtualKey.config";
import { toVirtualKeyCamelDto } from "~/server/gateway/virtualKey.dto";

import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const scopeInputSchema = z.object({
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

const idInput = z.object({ organizationId: z.string(), id: z.string() });

export const virtualKeysRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("virtualKeys:view"))
    .query(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const keys = await service.getAll(input.organizationId);
      return keys.map(toVirtualKeyCamelDto);
    }),

  get: protectedProcedure
    .input(idInput)
    .use(checkOrganizationPermission("virtualKeys:view"))
    .query(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const vk = await service.getById(input.id, input.organizationId);
      if (!vk) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return toVirtualKeyCamelDto(vk);
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        environment: z.enum(["live", "test"]).default("live"),
        principalUserId: z.string().nullable().optional(),
        scopes: z.array(scopeInputSchema).min(1),
        routingPolicyId: z.string().nullable().optional(),
        config: virtualKeyConfigSchema.partial().optional(),
      }),
    )
    .use(checkOrganizationPermission("virtualKeys:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const { virtualKey, secret } = await service.create({
        organizationId: input.organizationId,
        name: input.name,
        description: input.description ?? null,
        environment: input.environment,
        principalUserId: input.principalUserId ?? null,
        scopes: input.scopes,
        routingPolicyId: input.routingPolicyId ?? null,
        config: input.config,
        actorUserId: ctx.session.user.id,
      });
      return { virtualKey: toVirtualKeyCamelDto(virtualKey), secret };
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        scopes: z.array(scopeInputSchema).min(1).optional(),
        routingPolicyId: z.string().nullable().optional(),
        config: virtualKeyConfigSchema.partial().optional(),
      }),
    )
    .use(checkOrganizationPermission("virtualKeys:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const updated = await service.update({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        scopes: input.scopes,
        routingPolicyId: input.routingPolicyId,
        config: input.config,
        actorUserId: ctx.session.user.id,
      });
      return toVirtualKeyCamelDto(updated);
    }),

  rotate: protectedProcedure
    .input(idInput)
    .use(checkOrganizationPermission("virtualKeys:rotate"))
    .mutation(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const { virtualKey, secret } = await service.rotate({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: ctx.session.user.id,
      });
      return { virtualKey: toVirtualKeyCamelDto(virtualKey), secret };
    }),

  revoke: protectedProcedure
    .input(idInput)
    .use(checkOrganizationPermission("virtualKeys:delete"))
    .mutation(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const updated = await service.revoke({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: ctx.session.user.id,
      });
      return toVirtualKeyCamelDto(updated);
    }),
});
