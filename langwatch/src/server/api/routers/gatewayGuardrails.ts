/**
 * tRPC router for GatewayGuardrail — project-scoped first-class resource
 * that the gateway invokes per direction on inbound + outbound traffic.
 *
 * VK opt-in lives on vk.config.guardrailAttachments[]; this router is the
 * admin surface (CRUD) for /settings/gateway/guardrails.
 *
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 */
import { GatewayGuardrailDirection, GatewayGuardrailFailureMode } from "@prisma/client";
import { z } from "zod";

import { GatewayGuardrailService } from "~/server/gateway/guardrail.service";

import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const directionSchema = z.nativeEnum(GatewayGuardrailDirection);
const failureModeSchema = z.nativeEnum(GatewayGuardrailFailureMode);

export const gatewayGuardrailsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("gatewayGuardrails:view"))
    .query(async ({ ctx, input }) => {
      const service = GatewayGuardrailService.create(ctx.prisma);
      return await service.list(input.projectId);
    }),

  get: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkProjectPermission("gatewayGuardrails:view"))
    .query(async ({ ctx, input }) => {
      const service = GatewayGuardrailService.create(ctx.prisma);
      return await service.get(input.id, input.projectId);
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(128),
        description: z.string().max(512).nullable().optional(),
        evaluatorId: z.string(),
        direction: directionSchema,
        failureMode: failureModeSchema.optional(),
      }),
    )
    .use(checkProjectPermission("gatewayGuardrails:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = GatewayGuardrailService.create(ctx.prisma);
      return await service.create({
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        evaluatorId: input.evaluatorId,
        direction: input.direction,
        failureMode: input.failureMode,
        actorUserId: ctx.session.user.id,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().max(512).nullable().optional(),
        evaluatorId: z.string().optional(),
        direction: directionSchema.optional(),
        failureMode: failureModeSchema.optional(),
      }),
    )
    .use(checkProjectPermission("gatewayGuardrails:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = GatewayGuardrailService.create(ctx.prisma);
      return await service.update({
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        evaluatorId: input.evaluatorId,
        direction: input.direction,
        failureMode: input.failureMode,
        actorUserId: ctx.session.user.id,
      });
    }),

  archive: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkProjectPermission("gatewayGuardrails:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = GatewayGuardrailService.create(ctx.prisma);
      await service.archive({
        id: input.id,
        projectId: input.projectId,
        actorUserId: ctx.session.user.id,
      });
      return { ok: true };
    }),
});
