import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import type { Session } from "~/server/auth";
import { resolveScopeStorageUsage } from "~/server/data-retention/metering/storageMeter.read";
import {
  assertCanDisableRetention,
  assertCanWriteRetentionScope,
  assertRetentionPlan,
  assertRetentionPlanForScope,
  assertRetentionWriteAllowed,
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
  INDEFINITE_RETENTION_DAYS,
  type RetentionCategory,
  retentionCategorySchema,
  retentionDaysInputSchema,
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
        retentionDays: retentionDaysInputSchema,
      }),
    )
    .use(authorizeInResolver)
    .mutation(async ({ input, ctx }) => {
      await assertCanWriteRetentionScope(
        { prisma: ctx.prisma, session: ctx.session },
        input.scope,
      );
      // Plan-gate against the scope's owning org, not the caller-supplied
      // projectId (the two can belong to different orgs). Resolves the org +
      // plan once, then applies the free gate AND the value gate: paid plans
      // may persist only their fixed presets; enterprise/self-hosted keep the
      // full range + custom (≥49). No-ops on the indefinite sentinel so the
      // platform-admin check below still runs. The write-path prevention — the
      // UI menu is a mirror, not the enforcement.
      await assertRetentionWriteAllowed(
        { prisma: ctx.prisma, session: ctx.session },
        input.scope,
        input.retentionDays,
      );
      // Disabling retention (indefinite/keep-forever) is platform-admin only.
      // The schema accepts the 0 sentinel structurally; this is where the
      // capability is actually authorized — independent of org/team RBAC.
      if (input.retentionDays === INDEFINITE_RETENTION_DAYS) {
        assertCanDisableRetention({ prisma: ctx.prisma, session: ctx.session });
      }
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

  /**
   * Preview the retention each category would fall back to if the scope's
   * override were removed — the cascade value (next tier, or the platform
   * default) the data would land on. Powers the remove-confirmation dialog so
   * the user sees the real post-removal number, never a guessed one. Read-only;
   * gated by the same write-on-scope check as the removal it previews, so the
   * resolved org-default never leaks to a caller who couldn't remove the rule.
   */
  previewScopeRemoval: protectedProcedure
    .input(z.object({ projectId: z.string(), scope: scopeInput }))
    .use(authorizeInResolver)
    .query(async ({ input, ctx }) => {
      await assertCanWriteRetentionScope(
        { prisma: ctx.prisma, session: ctx.session },
        input.scope,
      );
      return getApp().dataRetention.policy.previewScopeRemoval(input.scope);
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
      await assertRetentionPlanForScope(
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
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      await assertRetentionPlanForProject(ctx, input.projectId);
      // Resolve the retention value server-side. Trusting a client-supplied
      // newRetentionDays would let a project:update caller rewrite existing
      // rows to any value, irreversibly contracting data without a matching
      // saved rule. The cascade-aware resolver is the only legitimate
      // source: PROJECT > TEAM > ORGANIZATION > platform default. When the
      // caller saves an org-wide override but a closer project override
      // already wins, the resolved value REMAINS the project's existing
      // value — so retroactive rewrite uses that, not the broader scope's
      // value. We return `appliedRetentionDays` to the UI so it can show
      // the truth (the dialog previously named the form value, which
      // could differ silently from what got applied).
      const effective =
        await getApp().dataRetention.policy.getResolvedForProject(
          input.projectId,
        );
      const category = input.category as RetentionCategory;
      const newRetentionDays = effective[category];
      if (newRetentionDays === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No effective retention is resolvable for category ${category}.`,
        });
      }
      const result = await getApp().dataRetention.retroactive.triggerUpdate({
        projectId: input.projectId,
        category,
        newRetentionDays,
      });
      return { ...result, appliedRetentionDays: newRetentionDays };
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

  /**
   * Total stored bytes for the projects the scope selector resolves to, summed
   * across every in-scope project the caller can read. Lets the Data Storage
   * card reflect the chosen scope (organization / team / project) instead of
   * always showing only the current project. RBAC-filtering happens inside the
   * resolver against the scope's owning org, so a wider scope never leaks a
   * project's storage the caller couldn't see.
   */
  getScopeStorageUsage: protectedProcedure
    .input(z.object({ projectId: z.string(), scope: scopeInput }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      return resolveScopeStorageUsage(ctx, {
        projectId: input.projectId,
        scope: input.scope,
      });
    }),
});
