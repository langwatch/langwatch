// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
import { featureFlagService } from "~/server/featureFlag";
import { GovernanceOcsfExportService } from "@ee/governance/services/governanceOcsfExport.service";
import {
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
  QuarantineFillEvaluator,
} from "@ee/governance/services/quarantineFillEvaluator.service";
import { AdminWorkspaceViewAuditService } from "@ee/governance/services/adminWorkspaceViewAudit.service";
import { GovernanceOcsfEventsClickHouseRepository } from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";

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
   *   - "/<projectSlug>"
   *   - "/governance"
   *
   * The resolver is fail-safe: any signal lookup error falls through to
   * the project_only home (or `/me` if the user has no projects). The
   * LLMOps majority experience is preserved on transient backend errors.
   *
   * Critical invariant: an org with application traces but no governance
   * state lands on /[project] — NOT /governance — even if the
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

      const [
        setupState,
        firstProject,
        isEnterprise,
        hasManage,
        userPin,
        hasGovernanceUi,
      ] = await Promise.all([
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
        ctx.prisma.user.findUnique({
          where: { id: userId },
          select: { lastHomePath: true },
        }),
        // `/me` and `/governance` are gated behind this flag; without it both
        // 404. Gate the auto-detected destination on it so a non-governance
        // org (e.g. a customer being impersonated) never lands on /me.
        featureFlagService
          .isEnabled("release_ui_ai_governance_enabled", {
            distinctId: userId,
            defaultValue: false,
            organizationId: input.organizationId,
          })
          .catch(() => false),
      ]);

      return resolvePersonaHomeSafe({
        userLastHomePath: userPin?.lastHomePath ?? null,
        setupState: {
          hasPersonalVKs: setupState.hasPersonalVKs,
          hasIngestionSources: setupState.hasIngestionSources,
          hasRecentActivity: setupState.hasRecentActivity,
        },
        hasApplicationTraces: setupState.hasApplicationTraces,
        hasOrganizationManagePermission: hasManage,
        isEnterprise,
        hasGovernanceUi,
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
        /** Lower bound paired with sinceEventId — return events after this watermark. */
        sinceMs: z.number().int().nonnegative().optional(),
        /** EventId watermark paired with sinceMs; from the prior page's nextCursorCompound. */
        sinceEventId: z.string().optional(),
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
        sinceEventId: input.sinceEventId,
        limit: input.limit,
      });
    }),

  /**
   * Current quarantine-fill rate for the org's hidden Gov project.
   * Admin UI on `/governance` polls this and surfaces a warning
   * Alert when `exceeded` is true. Per-source breakdown lets the
   * admin pin which IngestionSource is misconfigured without a
   * separate drill-down.
   *
   * Permission: `governance:view` — admin-only (members never see
   * quarantine activity per the spec's "no member visibility on
   * this Alert" invariant).
   *
   * Spec: specs/ai-gateway/governance/ingestion-attribution.feature
   *       §"Admin warning fires when quarantine fill rate exceeds threshold"
   */
  /**
   * Records the admin's bird's-eye drill-in into a target Personal
   * or Team workspace. Idempotent within a 5-minute window so the
   * layout-level `adminViewingAs` detection can fire on every page
   * paint without flooding the audit log.
   *
   * Hook point (Lane-B): in DashboardLayout / AdminViewingAsBanner,
   * `useEffect(() => { if (adminViewingAs) mutate({ ... }); }, [project.id])`
   * fires this once per drill-in navigation. Backend dedup absorbs
   * any extra calls within the window.
   *
   * Writes:
   *   - `AuditLog` row (`action='governance.viewWorkspaceAs'`) — the
   *     SOC2 / ISO27001 evidence surface; visible at /settings/audit-log
   *     to org admins AND to the user themselves on /me/configure →
   *     Activity (per the user-visible disclosure copy).
   *   - `governance_ocsf_events` mirror — best-effort SIEM stream
   *     parity; OCSF write failures don't fail the AuditLog write.
   *
   * Permission: `governance:view`. Self-views (own personal
   * workspace, own team) short-circuit at the service layer with
   * no audit row written.
   *
   * Spec: specs/ai-gateway/governance/admin-trace-access.feature
   *       specs/ai-gateway/governance/ingestion-attribution.feature
   *         §"no bypass surface that returns user traces without
   *           firing the audit-log row"
   */
  recordWorkspaceView: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        targetTeamId: z.string(),
        kind: z.enum(["personal", "team"]),
        workspaceLabel: z.string().max(256).optional(),
      }),
    )
    .use(checkOrganizationPermission("governance:view"))
    .mutation(async ({ ctx, input }) => {
      const ocsfRepository = new GovernanceOcsfEventsClickHouseRepository(
        async (tenantId) => {
          const client = await getClickHouseClientForProject(tenantId);
          if (!client) {
            throw new Error(
              `ClickHouse not available for tenant ${tenantId}`,
            );
          }
          return client;
        },
      );
      const service = AdminWorkspaceViewAuditService.create({
        prisma: ctx.prisma,
        ocsfRepository,
      });
      return await service.recordView({
        actorUserId: ctx.session.user.id,
        organizationId: input.organizationId,
        targetTeamId: input.targetTeamId,
        kind: input.kind,
        workspaceLabel: input.workspaceLabel,
      });
    }),

  /**
   * Resolves a CH-side `actor` token (typically the email stamped on
   * spans as `langwatch.user_id`, occasionally the User.id directly)
   * to that user's Personal Workspace inside the given org. Drives
   * the bird's-eye `/settings/governance/users/[id]` "View their
   * workspace →" link — without this, admins can see who's been
   * active but can't drill into their traces from the user row.
   *
   * Returns null when:
   *   - the actor doesn't resolve to a User in this org, OR
   *   - the resolved User has no Personal Workspace yet
   * (no enumeration leak — both branches collapse to null).
   *
   * Permission: `governance:view`. Members never resolve other
   * users' workspace ids.
   *
   * Spec: specs/ai-gateway/governance/admin-trace-access.feature
   *       §"Admin clicks a user row + lands on their personal-workspace traces"
   */
  resolveActorPersonalProject: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        /** Email or User.id stamped on spans as the actor identity. */
        actor: z.string().min(1).max(512),
      }),
    )
    .use(checkOrganizationPermission("governance:view"))
    .query(async ({ ctx, input }) => {
      // Match by email (CH-stamped actor is typically the email) OR
      // by id directly. Two-step: resolve User first, then ask
      // PersonalWorkspaceService for the workspace under the supplied
      // org. Cross-org probe (User exists but no membership in
      // organizationId) collapses to null below — never confirms the
      // user exists in another org.
      const user = await ctx.prisma.user.findFirst({
        where: {
          OR: [{ email: input.actor }, { id: input.actor }],
        },
        select: { id: true, name: true, email: true },
      });
      if (!user) return null;

      const membership = await ctx.prisma.organizationUser.findFirst({
        where: {
          userId: user.id,
          organizationId: input.organizationId,
        },
        select: { userId: true },
      });
      if (!membership) return null;

      const service = new PersonalWorkspaceService(ctx.prisma);
      const workspace = await service.findExisting({
        userId: user.id,
        organizationId: input.organizationId,
      });
      if (!workspace) return null;

      return {
        userId: user.id,
        displayName: user.name ?? user.email ?? user.id,
        teamId: workspace.team.id,
        projectId: workspace.project.id,
        projectSlug: workspace.project.slug,
      };
    }),

  quarantineFillStats: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowSeconds: z
          .number()
          .int()
          .min(10)
          .max(3600)
          .default(QUARANTINE_DEFAULT_WINDOW_SECONDS),
        threshold: z
          .number()
          .int()
          .min(1)
          .default(QUARANTINE_DEFAULT_THRESHOLD),
      }),
    )
    .use(checkOrganizationPermission("governance:view"))
    .query(async ({ ctx, input }) => {
      const evaluator = QuarantineFillEvaluator.create({ prisma: ctx.prisma });
      return await evaluator.evaluate({
        organizationId: input.organizationId,
        windowSeconds: input.windowSeconds,
        threshold: input.threshold,
      });
    }),
});
