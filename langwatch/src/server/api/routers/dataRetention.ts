import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { authorizeInResolver, checkProjectPermission } from "../rbac";
import { getApp } from "~/server/app-layer/app";
import { assertCanManageScope } from "~/server/modelProviders/modelProvider.authz";
import { SCOPE_TIERS } from "~/server/scopes/scope.types";
import {
  retentionCategorySchema,
  retentionDaysSchema,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";
import { ScopeTargetNotFoundError } from "~/server/data-retention/policy/dataRetentionPolicy.service";
import { getRetentionPolicySnapshot } from "~/server/data-retention/policy/dataRetentionPolicy.read";

const scopeInput = z.object({
  scopeType: z.enum(SCOPE_TIERS),
  scopeId: z.string().min(1),
});

export const dataRetentionRouter = createTRPCRouter({
  /**
   * The retention settings snapshot for a project: effective per-category
   * retention, the readable override rules, and the writable scopes for the
   * chip picker. Read access is project:view; the snapshot RBAC-filters what
   * it returns.
   */
  getRules: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      return getRetentionPolicySnapshot(ctx, { projectId: input.projectId });
    }),

  /**
   * Set one category's retention at one scope. Authorizes manage on the target
   * scope (organization:manage / team:manage / project:update) — a project
   * admin cannot push a policy up to the org.
   */
  setForScope: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scope: scopeInput,
        category: retentionCategorySchema,
        retentionDays: retentionDaysSchema,
      }),
    )
    .use(authorizeInResolver)
    .mutation(async ({ input, ctx }) => {
      await assertCanManageScope(
        { prisma: ctx.prisma, session: ctx.session },
        input.scope,
      );
      try {
        return await getApp().dataRetention.policy.setForScope({
          scope: input.scope,
          category: input.category as RetentionCategory,
          retentionDays: input.retentionDays,
        });
      } catch (error) {
        if (error instanceof ScopeTargetNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }
    }),

  /** Remove one category's override at one scope; the next tier then applies. */
  removeForScope: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scope: scopeInput,
        category: retentionCategorySchema,
      }),
    )
    .use(authorizeInResolver)
    .mutation(async ({ input, ctx }) => {
      await assertCanManageScope(
        { prisma: ctx.prisma, session: ctx.session },
        input.scope,
      );
      await getApp().dataRetention.policy.removeForScope({
        scope: input.scope,
        category: input.category as RetentionCategory,
      });
    }),

  triggerRetroactiveUpdate: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        category: retentionCategorySchema,
        newRetentionDays: retentionDaysSchema,
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
