import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { checkProjectPermission } from "../rbac";
import { PinnedTraceService } from "~/server/data-retention/pinning/pinnedTrace.service";
import { PinnedTraceRepository } from "~/server/data-retention/pinning/pinnedTrace.repository";
import { getApp } from "~/server/app-layer/app";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";

function buildService(prisma: PrismaClient): PinnedTraceService {
  return new PinnedTraceService(
    new PinnedTraceRepository(prisma),
    async (tenantId) => {
      const client = await getClickHouseClientForProject(tenantId);
      if (!client) throw new Error(`ClickHouse not available for ${tenantId}`);
      return client;
    },
    getApp().retentionPolicyCache,
  );
}

export const pinnedTraceRouter = createTRPCRouter({
  pin: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        reason: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      return buildService(ctx.prisma).pin({
        projectId: input.projectId,
        traceId: input.traceId,
        userId: ctx.session.user.id,
        reason: input.reason,
      });
    }),

  unpin: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      await buildService(ctx.prisma).unpin({
        projectId: input.projectId,
        traceId: input.traceId,
      });
    }),

  getPin: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const repo = new PinnedTraceRepository(ctx.prisma);
      return repo.findByProjectAndTrace({
        projectId: input.projectId,
        traceId: input.traceId,
      });
    }),

  listByProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const repo = new PinnedTraceRepository(ctx.prisma);
      return repo.findAllByProject({ projectId: input.projectId });
    }),
});
