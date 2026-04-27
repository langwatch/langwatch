/**
 * tRPC router for cross-cutting governance read-side queries that
 * don't fit neatly under the more focused governance routers
 * (routingPolicy / personalVirtualKeys / ingestionSources /
 * activityMonitor / anomalyRules).
 *
 * Today the only procedure is `setupState` — the persona-detection
 * signal the UI calls on session resolve to decide whether to
 * promote `/governance` in nav. More cross-cutting reads land here
 * as the dashboard story expands.
 *
 * Spec: specs/ai-gateway/governance/feature-flag-gating.feature
 */
import { z } from "zod";

import { GovernanceSetupStateService } from "~/server/governance/setupState.service";

import { checkOrganizationPermission } from "../rbac";
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
});
