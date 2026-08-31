// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Two cross-cutting governance procedures that still live on the app router
 * because their data-gathering reaches directly into `ctx.prisma` and
 * composes several cross-feature services (feature flags, organizations,
 * users, usage stats). The other four surfaces — `setupState`, `ocsfExport`,
 * `recordWorkspaceView`, `quarantineFillStats` — moved to the governance
 * package's `GovernanceTrpcApi` and are mounted alongside these on the
 * `governance.*` namespace.
 *
 * These two will follow once their gathering is behind a `PersonaHomeApp` /
 * `ActorResolutionApp` seam the composition can supply. Doing that now would
 * mean an in-flight design decision about how governance reads enterprise
 * plan status, so the split lands first and the extraction follows.
 *
 * Specs:
 *   - specs/ai-gateway/governance/persona-home-resolver.feature
 *   - specs/ai-gateway/governance/admin-trace-access.feature
 */

import {
  PersonaHomeResolverService,
  type PersonaResolution,
} from "@langwatch/enterprise-governance-contract";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { probeOrganizationPermission } from "~/server/app-layer/permissions/imperative";
import { UsageStatsService } from "~/server/license-enforcement/usage-stats.service";

export const governanceRouter = createTRPCRouter({
  /**
   * Pick the right `/` destination for the authenticated user given the org
   * context. Returns one of `/me`, `/<projectSlug>`, `/governance`.
   *
   * The resolver is fail-safe: any signal lookup error falls through to the
   * project_only home (or `/me` if the user has no projects). The LLMOps
   * majority experience is preserved on transient backend errors.
   *
   * Critical invariant: an org with application traces but no governance
   * state lands on /[project] — NOT /governance — even if the user has
   * organization:manage and Enterprise plan. The persona-4 gate is
   * conjunctive (manage AND Enterprise AND hasIngestionSources).
   */
  resolveHome: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ ctx, input }): Promise<PersonaResolution> => {
      const userId = ctx.session.user.id;
      const usageService = UsageStatsService.create(ctx.prisma);

      const [
        setupState,
        firstProject,
        isEnterprise,
        hasManage,
        userPin,
        hasGovernanceUi,
        organizationIntent,
      ] = await Promise.all([
        ctx.app.governance.resolveSetupState(input.organizationId),
        // The user's first project via team membership. Personal workspaces
        // are excluded outright: they are the governance data home, never a
        // navigable org project (ADR-038 v6).
        ctx.prisma.project.findFirst({
          where: {
            team: {
              organizationId: input.organizationId,
              members: { some: { userId } },
              isPersonal: false,
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
        probeOrganizationPermission(ctx, input.organizationId, "organization:manage"),
        ctx.prisma.user.findUnique({
          where: { id: userId },
          select: { lastHomePath: true },
        }),
        // `/me` and `/governance` are gated behind this flag; without it both
        // 404. Gate the auto-detected destination on it so a non-governance
        // org never lands on /me.
        ctx.app.featureFlags
          .isEnabled("release_ui_ai_governance_enabled", {
            kind: "organization",
            userId,
            organizationId: input.organizationId,
          })
          .catch(() => false),
        // The org's declared intent, when set, decides the landing kind
        // before persona detection and the user pin. Fail-safe: transient
        // errors mean "no intent" and take the legacy path.
        ctx.app.organizations.getPrimaryIntent(input.organizationId).catch(() => null),
      ]);

      // Org managers routinely have NO TeamUser row on the default team
      // (createAndAssign never adds one) — without this fallback every fresh
      // org resolves "no project" for its own creator. Scoped to
      // `organization:manage` so a low-privilege member is never routed to a
      // project home they cannot open.
      let firstProjectSlug = firstProject?.slug ?? null;
      if (!firstProjectSlug && hasManage) {
        const orgWideProject = await ctx.prisma.project
          .findFirst({
            where: {
              team: { organizationId: input.organizationId, isPersonal: false },
              archivedAt: null,
            },
            orderBy: { createdAt: "asc" },
            select: { slug: true },
          })
          .catch(() => null);
        firstProjectSlug = orgWideProject?.slug ?? null;
      }

      return PersonaHomeResolverService.create().resolveSafe({
        organizationIntent,
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
        firstProjectSlug,
      });
    }),

  /**
   * Resolves a CH-side `actor` token (typically the email stamped on spans
   * as `langwatch.user_id`, occasionally the User.id directly) to that
   * user's Personal Workspace inside the given org. Drives the bird's-eye
   * `/governance/users/[id]` "View their workspace →" link.
   *
   * Returns null when the actor doesn't resolve to a User in this org, or
   * when the resolved User has no Personal Workspace yet — no enumeration
   * leak, both branches collapse to null.
   */
  resolveActorPersonalProject: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        /** Email or User.id stamped on spans as the actor identity. */
        actor: z.string().min(1).max(512),
      }),
    )
    .permission("governance:view")
    .query(async ({ ctx, input }) => {
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

      const workspace = await ctx.app.users.tryFindPersonalWorkspace({
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
});
