/**
 * tRPC router for the Langy ↔ GitHub connection.
 *
 *   getConnection — used by the sidebar "Acting as @login" chip and the
 *                   settings card. Returns null when not connected.
 *   disconnect    — revokes the App authorization at GitHub and deletes the
 *                   local row. Live workers may still hold a token until the
 *                   idle-reaper (≤10 min); intentional, documented in spec.
 *
 * Transport only: org-membership gate + audit, delegating every credential
 * operation to the app-layer service. The connect flow itself is the public
 * REST callback in src/server/routes/github-langy.ts — OAuth redirect_uri can't
 * live behind tRPC. Issue #4747.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authorizeInResolver } from "~/server/api/rbac";
import { getApp } from "~/server/app-layer";
import { auditLog } from "~/server/auditLog";
import { createTRPCRouter, protectedProcedure } from "../trpc";

async function ensureOrganizationMember(
  userId: string,
  organizationId: string,
): Promise<void> {
  const isMember = await getApp().langy.githubCredentials.isOrganizationMember({
    userId,
    organizationId,
  });
  if (!isMember) {
    // Generic message — embedding the organization UUID in the response
    // confirms a valid org id to a caller who isn't a member of it
    // (light enumeration oracle).
    throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
  }
}

export const langyGithubRouter = createTRPCRouter({
  getConnection: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      await ensureOrganizationMember(ctx.session.user.id, input.organizationId);
      return getApp().langy.githubCredentials.findConnection({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
    }),

  disconnect: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(authorizeInResolver)
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationMember(ctx.session.user.id, input.organizationId);
      // Revoke at GitHub then delete the local row + cached access token — the
      // service owns that ordering (revoke needs a live token minted from the
      // stored refresh token, so it must precede the delete).
      const deleted =
        await getApp().langy.githubCredentials.revokeAndDeleteConnection({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        });
      if (deleted > 0) {
        await auditLog({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          action: "langy.github.disconnect",
        });
      }
      return { ok: true, deleted };
    }),
});
