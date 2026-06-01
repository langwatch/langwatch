import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import type { PrismaClient } from "@prisma/client";
import type { Session } from "~/server/auth";
import {
  assertCanWriteRetentionScope,
  assertRetentionPlan,
} from "~/server/data-retention/policy/dataRetentionPolicy.authz";
import { getRetentionPolicySnapshot } from "~/server/data-retention/policy/dataRetentionPolicy.read";
import { ScopeTargetNotFoundError } from "~/server/data-retention/policy/dataRetentionPolicy.service";

/**
 * Plan-gate the retention mutations via the project's owning organization.
 * Throws FORBIDDEN if the org is on a free plan. Centralised so every
 * write endpoint stays consistent — overrides, retroactive updates, and
 * mutation kills all need a paid plan.
 */
async function assertRetentionPlanForProject(
  ctx: { prisma: PrismaClient; session: Session | null },
  projectId: string,
): Promise<void> {
  const project = await ctx.prisma.project.findFirst({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const organizationId = project?.team?.organizationId;
  if (!organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project does not belong to any organization.",
    });
  }
  await assertRetentionPlan(ctx, organizationId);
}
import {
  type RetentionCategory,
  retentionCategorySchema,
  retentionDaysSchema,
} from "~/server/data-retention/retentionPolicy.schema";
import { SCOPE_TIERS } from "~/server/scopes/scope.types";
import { authorizeInResolver, checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

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
   * Set one category's retention at one scope. Authorizes write on the target
   * scope (organization:manage / team:manage / project:update) — a project
   * member can edit their own project's retention but cannot push a policy up
   * to the org.
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
      await assertCanWriteRetentionScope(
        { prisma: ctx.prisma, session: ctx.session },
        input.scope,
      );
      await assertRetentionPlanForProject(ctx, input.projectId);
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
      await assertCanWriteRetentionScope(
        { prisma: ctx.prisma, session: ctx.session },
        input.scope,
      );
      await assertRetentionPlanForProject(ctx, input.projectId);
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
    .mutation(async ({ input, ctx }) => {
      await assertRetentionPlanForProject(ctx, input.projectId);
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
    .mutation(async ({ input, ctx }) => {
      await assertRetentionPlanForProject(ctx, input.projectId);
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
