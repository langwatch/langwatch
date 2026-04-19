/**
 * tRPC router for reading GatewayAuditLog. Writes happen via
 * GatewayAuditLogRepository inside the mutation's transaction — never
 * from outside the resource service that produced the change.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { GatewayAuditService } from "~/server/gateway/audit.service";

import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const auditActionEnum = z.enum([
  "VIRTUAL_KEY_CREATED",
  "VIRTUAL_KEY_UPDATED",
  "VIRTUAL_KEY_ROTATED",
  "VIRTUAL_KEY_REVOKED",
  "VIRTUAL_KEY_DELETED",
  "BUDGET_CREATED",
  "BUDGET_UPDATED",
  "BUDGET_DELETED",
  "PROVIDER_BINDING_CREATED",
  "PROVIDER_BINDING_UPDATED",
  "PROVIDER_BINDING_DELETED",
]);

const targetKindEnum = z.enum(["virtual_key", "budget", "provider_binding"]);

export const gatewayAuditRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        action: auditActionEnum.optional(),
        targetKind: targetKindEnum.optional(),
        targetId: z.string().optional(),
        actorUserId: z.string().optional(),
        fromDate: z.string().datetime().optional(),
        toDate: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z
          .object({
            createdAt: z.string().datetime(),
            id: z.string(),
          })
          .nullable()
          .optional(),
      }),
    )
    .use(checkOrganizationPermission("gatewayLogs:view"))
    .query(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "organization not found",
        });
      }
      const service = GatewayAuditService.create(ctx.prisma);
      const page = await service.list(
        {
          organizationId: input.organizationId,
          action: input.action,
          targetKind: input.targetKind,
          targetId: input.targetId,
          actorUserId: input.actorUserId,
          fromDate: input.fromDate ? new Date(input.fromDate) : undefined,
          toDate: input.toDate ? new Date(input.toDate) : undefined,
        },
        {
          limit: input.limit,
          cursor: input.cursor
            ? {
                createdAt: new Date(input.cursor.createdAt),
                id: input.cursor.id,
              }
            : null,
        },
      );
      return {
        entries: page.entries.map((e) => ({
          id: e.id,
          organizationId: e.organizationId,
          projectId: e.projectId,
          actorUserId: e.actorUserId,
          actorName: e.actor?.name ?? null,
          actorEmail: e.actor?.email ?? null,
          action: e.action,
          targetKind: e.targetKind,
          targetId: e.targetId,
          before: e.before,
          after: e.after,
          createdAt: e.createdAt.toISOString(),
        })),
        nextCursor: page.nextCursor,
      };
    }),
});
