/**
 * tRPC router for cross-cutting governance read-side queries that
 * don't fit neatly under the more focused governance routers
 * (routingPolicy / personalVirtualKeys / ingestionSources /
 * activityMonitor / anomalyRules).
 *
 * Procedures:
 *   - setupState   — persona-detection signal for nav promotion
 *   - resolveHome  — picks the right `/` destination per persona
 *   - ocsfExport   — cursor-paginated SIEM forwarding pull
 *
 * Spec: specs/ai-gateway/governance/feature-flag-gating.feature
 *       specs/ai-gateway/governance/persona-home-resolver.feature
 *       specs/ai-gateway/governance/siem-export.feature
 */
import { z } from "zod";

import { GovernanceSetupStateService } from "@ee/governance/services/setupState.service";
import {
  resolvePersonaHomeSafe,
  type PersonaResolution,
} from "@ee/governance/services/personaResolver.service";
import { UsageStatsService } from "~/server/license-enforcement/usage-stats.service";
import { GovernanceOcsfExportService } from "@ee/governance/services/governanceOcsfExport.service";

import {
  ENTERPRISE_FEATURE_ERRORS,
  requireEnterprisePlan,
} from "~/server/api/enterprise";
import {
  checkOrganizationPermission,
  hasOrganizationPermission,
} from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const governanceRouter = createTRPCRouter({
  /**
   * Read-only governance setup-state summary. The single boolean
   * `governanceActive` is the persona-detection signal — UI nav
   * promotes /governance only when this is true AND the user has
   * `governance:view`. Per @master_orchestrator: don't auto-redirect
   * flagged admins; only promote when actual state exists.
   *
   * Permission: `governance:view` — only org ADMIN (or a custom role
   * granting it) sees the persona-detection signal. MEMBER + EXTERNAL
   * never call this; resolveHome below uses the service directly so
   * identity-routing for non-admins still works.
   */
  setupState: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("governance:view"))
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

  /**
   * SIEM forwarding pull — cursor-paginated OCSF v1.1 / OWASP AOS
   * events for security teams. Per spec: read-only, paginated by
   * EventTime, returns rows since cursor T.
   *
   * Designed for cron-based pulls from Splunk HEC / Datadog Cloud
   * SIEM / Microsoft Sentinel / AWS Security Hub / Elastic Security /
   * Sumo Logic CSE / Google Chronicle. Returns up to N rows; client
   * passes back the last EventTime as the next cursor.
   *
   * Permission: complianceExport:view (security team's role binding).
   * Restricted because OCSF events expose actor identities + tool
   * names — should not leak to read-only org members. Default-attached
   * to org ADMIN; delegate to security analysts via a CustomRole
   * granting `complianceExport:view` (no other action — the resource
   * is read-only by design).
   *
   * Empty-state safe: returns events=[] + nextCursor=null when the
   * org has no Gov Project (no governance ingest) or when no events
   * exist past the cursor.
   *
   * Spec: specs/ai-gateway/governance/siem-export.feature
   */
  ocsfExport: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        /** Inclusive lower bound — return events with eventTime > sinceMs. */
        sinceMs: z.number().int().nonnegative().optional(),
        /** Page size — soft cap at 1000 to keep responses bounded. */
        limit: z.number().int().min(1).max(1000).default(500),
      }),
    )
    .use(checkOrganizationPermission("complianceExport:view"))
    .use(requireEnterprisePlan(ENTERPRISE_FEATURE_ERRORS.OCSF_EXPORT))
    .query(async ({ ctx, input }) => {
      const service = GovernanceOcsfExportService.create(ctx.prisma);
      return await service.list({
        organizationId: input.organizationId,
        sinceMs: input.sinceMs ?? 0,
        limit: input.limit,
      });
    }),
});
