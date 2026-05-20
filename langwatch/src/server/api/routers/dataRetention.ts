import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { checkProjectPermission, checkOrganizationPermission } from "../rbac";
import { getApp } from "~/server/app-layer/app";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import {
  retentionPolicySchema,
  RETENTION_CATEGORIES,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";
import { RetroactiveUpdateService } from "~/server/data-retention/retroactive/retroactiveUpdate.service";
import { StorageMeterService } from "~/server/data-retention/metering/storageMeter.service";

function buildRetroactiveService(): RetroactiveUpdateService {
  return new RetroactiveUpdateService(async (tenantId) => {
    const client = await getClickHouseClientForProject(tenantId);
    if (!client) throw new Error(`ClickHouse not available for ${tenantId}`);
    return client;
  });
}

function buildStorageMeterService(): StorageMeterService {
  return new StorageMeterService(async (tenantId) => {
    const client = await getClickHouseClientForProject(tenantId);
    if (!client) throw new Error(`ClickHouse not available for ${tenantId}`);
    return client;
  });
}

export const dataRetentionRouter = createTRPCRouter({
  getProjectPolicy: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const project = await ctx.prisma.project.findFirst({
        where: { id: input.projectId },
        select: {
          retentionPolicy: true,
          team: {
            select: {
              organization: {
                select: { defaultRetentionPolicy: true },
              },
            },
          },
        },
      });

      return {
        projectPolicy: project?.retentionPolicy ?? null,
        orgPolicy: project?.team?.organization?.defaultRetentionPolicy ?? null,
      };
    }),

  updateProjectPolicy: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        retentionPolicy: retentionPolicySchema.nullable(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.project.update({
        where: { id: input.projectId },
        data: {
          retentionPolicy: input.retentionPolicy ?? Prisma.JsonNull,
        },
      });

      getApp().retentionPolicyCache.invalidate(input.projectId);
    }),

  updateOrgPolicy: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        defaultRetentionPolicy: retentionPolicySchema.nullable(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: {
          defaultRetentionPolicy:
            input.defaultRetentionPolicy ?? Prisma.JsonNull,
        },
      });
    }),

  triggerRetroactiveUpdate: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        category: z.enum(["traces", "scenarios", "experiments"]),
        newRetentionDays: z.number().int().min(30),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input }) => {
      const service = buildRetroactiveService();
      return service.triggerUpdate({
        projectId: input.projectId,
        category: input.category as RetentionCategory,
        newRetentionDays: input.newRetentionDays,
      });
    }),

  getMutationProgress: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const service = buildRetroactiveService();
      return service.getMutationProgress({ projectId: input.projectId });
    }),

  killMutation: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        mutationId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input }) => {
      const service = buildRetroactiveService();
      await service.killMutation({
        projectId: input.projectId,
        mutationId: input.mutationId,
      });
    }),

  getStorageUsage: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const service = buildStorageMeterService();
      const totalBytes = await service.getTotalStorageBytes({
        tenantId: input.projectId,
      });
      return { totalBytes };
    }),

  getStorageBreakdown: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const service = buildStorageMeterService();
      return service.getStorageBreakdown({ tenantId: input.projectId });
    }),
});
