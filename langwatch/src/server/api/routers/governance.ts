/**
 * tRPC router for cross-cutting governance read-side queries that
 * don't fit neatly under the more focused governance routers
 * (routingPolicy / personalVirtualKeys / ingestionSources /
 * activityMonitor / anomalyRules).
 *
 * Procedures:
 *   - setupState   — persona-detection signal for nav promotion
 *   - resolveHome  — picks the right `/` destination per persona
 *
 * Spec: specs/ai-gateway/governance/feature-flag-gating.feature
 *       specs/ai-gateway/governance/persona-home-resolver.feature
 */
import { z } from "zod";

import { GovernanceSetupStateService } from "~/server/governance/setupState.service";
import {
  resolvePersonaHomeSafe,
  type PersonaResolution,
} from "~/server/governance/personaResolver.service";
import { UsageStatsService } from "~/server/license-enforcement/usage-stats.service";

import {
  checkOrganizationPermission,
  hasOrganizationPermission,
} from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const governanceRouter = createTRPCRouter({
  /**
   * Read-only governance setup-state summary. The single boolean
   * `governanceActive` is the persona-detection signal — UI nav
   * promotes /governance only when this is true AND the user has
   * organization:manage. Per @master_orchestrator: don't auto-redirect
   * flagged admins; only promote when actual state exists.
   */
  setupState: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = GovernanceSetupStateService.create(ctx.prisma);
      return await service.resolve(input.organizationId);
    }),

  /**
   * Pick the right `/` destination for the authenticated user given the
   * org context. Returns one of:
   *   - "/me"
   *   - "/<projectSlug>/messages"
   *   - "/governance"
   *
   * The resolver is fail-safe: any signal lookup error falls through to
   * the project_only home (or `/me` if the user has no projects). The
   * LLMOps majority experience is preserved on transient backend errors.
   *
   * Critical invariant: an org with application traces but no governance
   * state lands on /[project]/messages — NOT /governance — even if the
   * user has organization:manage and Enterprise plan. The persona-4 gate
   * is conjunctive (manage AND Enterprise AND hasIngestionSources).
   */
  resolveHome: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }): Promise<PersonaResolution> => {
      const userId = ctx.session.user.id;
      const setupService = GovernanceSetupStateService.create(ctx.prisma);
      const usageService = UsageStatsService.create(ctx.prisma);

      const [setupState, firstProject, isEnterprise, hasManage] =
        await Promise.all([
          // hasApplicationTraces is part of setupState as of 9d2688c84.
          setupService.resolve(input.organizationId),
          ctx.prisma.project.findFirst({
            where: {
              team: {
                organizationId: input.organizationId,
                members: { some: { userId } },
              },
              archivedAt: null,
            },
            orderBy: { createdAt: "asc" },
            select: { slug: true },
          }),
          usageService
            .getUsageStats(input.organizationId, ctx.session.user)
            .then((u) => u?.activePlan?.type === "ENTERPRISE")
            .catch(() => false),
          hasOrganizationPermission(
            ctx,
            input.organizationId,
            "organization:manage",
          ),
        ]);

      return resolvePersonaHomeSafe({
        // User pin override deferred to follow-up PR (requires
        // User.lastHomePath migration). Always null for now — persona
        // detection drives the destination.
        userLastHomePath: null,
        setupState: {
          hasPersonalVKs: setupState.hasPersonalVKs,
          hasIngestionSources: setupState.hasIngestionSources,
          hasRecentActivity: setupState.hasRecentActivity,
        },
        hasApplicationTraces: setupState.hasApplicationTraces,
        hasOrganizationManagePermission: hasManage,
        isEnterprise,
        firstProjectSlug: firstProject?.slug ?? null,
      });
    }),
});
