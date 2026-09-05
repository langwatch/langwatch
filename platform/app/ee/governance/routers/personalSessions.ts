// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for the devices inventory — Phase 8 Sessions/Devices dashboard.
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

import { CliSessionInventoryService } from "@ee/governance/services/cliSessionInventory.service";
import { CliTokenRevocationService } from "@ee/governance/services/cliTokenRevocation.service";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { sessionInventory } from "~/server/app-layer/identity/runtime";

export const personalSessionsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
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
    .permission("organization:view")
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
    .permission("organization:view")
    .mutation(async ({ ctx }) => {
      // Reuse the user-wide revoke from Phase 1B.5 — that path also
      // clears the per-user token index in one shot.
      const revocation = CliTokenRevocationService.create();
      const result = await revocation.revokeForUser({
        userId: ctx.session.user.id,
      });
      return { ok: true, revokedTokens: result.revokedCount };
    }),

  /**
   * Where this person is signed in on the WEB, and how each sign-in got in
   * (D06).
   *
   * A different credential class from the CLI devices above and listed
   * beside them for the reason the inventory exists at all: a browser and a
   * terminal are two ways of being this person, and somebody checking what is
   * signed in should not have to know which page holds which.
   *
   * Each entry says how it signed in and whether a second factor was proved.
   * An entry that proved nothing reads as an ordinary sign-in, because it is
   * one — every session minted before this shipped recorded nothing.
   *
   * Unpermissioned by design: the handler answers for the session's own user
   * id and nothing else, and a person's own sessions are not a scope anybody
   * holds authority over.
   */
  listWebSessions: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason:
        "the caller's own signed-in web sessions, answered for the session's user id alone",
    })
    .query(async ({ ctx }) => {
      return sessionInventory().listFor({
        userId: ctx.session.user.id,
        currentSessionId: ctx.session.sessionId,
      });
    }),

  /**
   * End ONE web session, named by the person who owns it.
   *
   * What somebody looking at a browser they no longer have actually wants:
   * end that one and keep the rest. The session doing the reading is refused
   * with `session_is_current` rather than silently skipped, because ending it
   * is signing out and that has its own control.
   *
   * Unpermissioned by design, for the reason `listWebSessions` gives: the
   * handler matches on the session's own user id, so naming somebody else's
   * session ends nothing.
   */
  revokeWebSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .noPermission({
      reason:
        "the caller ending one of their own sessions, matched on the session's user id; a session that is not theirs ends nothing",
    })
    .mutation(async ({ ctx, input }) => {
      return sessionInventory().endSession({
        userId: ctx.session.user.id,
        sessionId: input.sessionId,
        currentSessionId: ctx.session.sessionId,
      });
    }),

  /**
   * End every web session one sign-in method minted, and no others (D06).
   *
   * A narrower instrument than "revoke everything": somebody who no longer
   * trusts one way in — a password they have just changed, an identity
   * provider they have left — ends those sessions and keeps the rest. A
   * password reset still ends every session whatever minted it; that
   * guarantee is untouched and this is not a replacement for it.
   */
  revokeWebSessionsForIdentifier: protectedProcedure
    .input(z.object({ identifierId: z.string().min(1) }))
    .noPermission({
      reason:
        "the caller ending their own sessions, matched on the session's user id; an identifier that is not theirs ends nothing",
    })
    .mutation(async ({ ctx, input }) => {
      return sessionInventory().endSessionsForIdentifier({
        userId: ctx.session.user.id,
        identifierId: input.identifierId,
      });
    }),
});
