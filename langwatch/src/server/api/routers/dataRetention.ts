import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { checkProjectPermission, checkOrganizationPermission } from "../rbac";
import { getApp } from "~/server/app-layer/app";
import {
  retentionPolicySchema,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";

export const dataRetentionRouter = createTRPCRouter({
  getProjectPolicy: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      return getApp().dataRetention.policy.getProjectPolicy({
        projectId: input.projectId,
      });
    }),

  updateProjectPolicy: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        retentionPolicy: retentionPolicySchema.nullable(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input }) => {
      await getApp().dataRetention.policy.updateProjectPolicy({
        projectId: input.projectId,
        retentionPolicy: input.retentionPolicy,
      });
    }),

  updateOrgPolicy: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        defaultRetentionPolicy: retentionPolicySchema.nullable(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input }) => {
      await getApp().dataRetention.policy.updateOrgPolicy({
        organizationId: input.organizationId,
        defaultRetentionPolicy: input.defaultRetentionPolicy,
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
      return getApp().dataRetention.retroactive.triggerUpdate({
        projectId: input.projectId,
        category: input.category as RetentionCategory,
        newRetentionDays: input.newRetentionDays,
      });
    }),

  getMutationProgress: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      return getApp().dataRetention.retroactive.getMutationProgress({
        projectId: input.projectId,
      });
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
      await getApp().dataRetention.retroactive.killMutation({
        projectId: input.projectId,
        mutationId: input.mutationId,
      });
    }),

  getStorageUsage: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const totalBytes =
        await getApp().dataRetention.metering.getTotalStorageBytes({
          tenantId: input.projectId,
        });
      return { totalBytes };
    }),

  getStorageBreakdown: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      return getApp().dataRetention.metering.getStorageBreakdown({
        tenantId: input.projectId,
      });
    }),
});
