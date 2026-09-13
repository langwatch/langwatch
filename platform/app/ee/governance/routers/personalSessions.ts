// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for the devices inventory — Phase 8 Sessions/Devices dashboard.
 *
 * Three procedures:
 *   - list: list every active CLI session for the authenticated user
 *     (one card per device — hostname, platform, last-seen, expires)
 *   - revoke: invalidate a single session by sessionStartedAtMs, its login
 *     key and the ingest keys under it
 *   - revokeAll: the same for every session of the user (e.g. "log out
 *     everywhere" affordance)
 *
 * RBAC: every authenticated user can list + revoke THEIR OWN sessions
 * — these aren't admin-only. Procedures derive userId from the
 * session, never from input, so no cross-user leakage is possible.
 *
 * Spec: specs/ai-governance/sessions/sessions-inventory.feature
 */

import { CliSessionInventoryService } from "@ee/governance/services/cliSessionInventory.service";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const personalSessionsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ ctx }) => {
      const service = CliSessionInventoryService.create({ prisma: ctx.prisma });
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
        cliApiKeyId: s.cliApiKeyId,
      }));
    }),

  revoke: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        sessionStartedAtMs: z.number().int().nonnegative(),
      }),
    )
    .permission("organization:view")
    .mutation(async ({ ctx, input }) => {
      const service = CliSessionInventoryService.create({ prisma: ctx.prisma });
      const result = await service.revokeSession({
        userId: ctx.session.user.id,
        sessionStartedAtMs: input.sessionStartedAtMs,
      });
      return {
        ok: true,
        revokedTokens: result.revokedTokens,
        revokedKeys: result.revokedKeys,
      };
    }),

  revokeAll: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .mutation(async ({ ctx }) => {
      const service = CliSessionInventoryService.create({ prisma: ctx.prisma });
      const result = await service.revokeAllSessions({
        userId: ctx.session.user.id,
      });
      return {
        ok: true,
        revokedTokens: result.revokedTokens,
        revokedKeys: result.revokedKeys,
      };
    }),
});
