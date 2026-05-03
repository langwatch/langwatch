// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for /me/sessions — Phase 8 Sessions/Devices dashboard.
 *
 * Three procedures:
 *   - list: list every active CLI session for the authenticated user
 *     (one card per device — hostname, platform, last-seen, expires)
 *   - revoke: invalidate a single session by sessionStartedAtMs
 *   - revokeAll: invalidate every session for the user (e.g. "log out
 *     everywhere" affordance)
 *
 * RBAC: every authenticated user can list + revoke THEIR OWN sessions
 * — these aren't admin-only. Procedures derive userId from the
 * session, never from input, so no cross-user leakage is possible.
 *
 * Spec: specs/ai-governance/sessions/sessions-inventory.feature
 */
import { z } from "zod";

import { CliSessionInventoryService } from "@ee/governance/services/cliSessionInventory.service";
import { CliTokenRevocationService } from "@ee/governance/services/cliTokenRevocation.service";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const personalSessionsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx }) => {
      const service = CliSessionInventoryService.create();
      const sessions = await service.listForUser({
        userId: ctx.session.user.id,
      });
      return sessions.map((s) => ({
        sessionStartedAtMs: s.sessionStartedAtMs,
        deviceLabel: s.deviceLabel,
        hostname: s.hostname,
        uname: s.uname,
        platform: s.platform,
        lastSeenMs: s.lastSeenMs,
        expiresAtMs: s.expiresAtMs,
      }));
    }),

  revoke: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        sessionStartedAtMs: z.number().int().nonnegative(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx, input }) => {
      const service = CliSessionInventoryService.create();
      const result = await service.revokeSession({
        userId: ctx.session.user.id,
        sessionStartedAtMs: input.sessionStartedAtMs,
      });
      return { ok: true, revokedTokens: result.revokedTokens };
    }),

  revokeAll: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx }) => {
      // Reuse the user-wide revoke from Phase 1B.5 — that path also
      // clears the per-user token index in one shot.
      const revocation = CliTokenRevocationService.create();
      const result = await revocation.revokeForUser({
        userId: ctx.session.user.id,
      });
      return { ok: true, revokedTokens: result.revokedCount };
    }),
});
