/**
 * tRPC router for the Langy ↔ GitHub connection.
 *
 *   getConnection — used by the sidebar "Acting as @login" chip and the
 *                   settings card. Returns null when not connected.
 *   disconnect    — revokes the App authorization at GitHub and deletes the
 *                   local row. Live workers may still hold a token until the
 *                   idle-reaper (≤10 min); intentional, documented in spec.
 *
 * The connect flow itself is the public REST callback in
 * src/server/routes/github-langy.ts — OAuth redirect_uri can't live behind
 * tRPC. Issue #4747.
 */

import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env.mjs";
import { authorizeInResolver } from "~/server/api/rbac";
import { auditLog } from "~/server/auditLog";
import {
  deleteGithubConnection,
  findGithubConnection,
  isOrganizationMember,
} from "~/server/services/langy/langyGithubConnection";
import {
  clearGithubTokenCache,
  getGithubTokenForUser,
} from "~/server/services/langy/langyGithubToken";
import { createLogger } from "~/utils/logger/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const logger = createLogger("langwatch:trpc:langyGithub");

/**
 * Best-effort revoke the App's grant for this user at GitHub. Requires a
 * valid user access token (NOT a refresh token — GitHub validates the AT
 * before deleting the grant). We mint one fresh from the stored refresh
 * token; if minting fails (already revoked, network out), we skip the
 * GitHub call. The local row delete is the user-visible source of truth.
 */
async function revokeAtGitHub({
  prisma,
  userId,
  organizationId,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
}): Promise<void> {
  if (!env.GITHUB_LANGY_CLIENT_ID || !env.GITHUB_LANGY_CLIENT_SECRET) return;
  let accessToken: string | null = null;
  try {
    const minted = await getGithubTokenForUser({
      prisma,
      userId,
      organizationId,
    });
    accessToken = minted?.token ?? null;
  } catch (err) {
    logger.warn({ err }, "github grant revoke: mint failed; skipping API call");
    return;
  }
  if (!accessToken) return;
  try {
    const basic = Buffer.from(
      `${env.GITHUB_LANGY_CLIENT_ID}:${env.GITHUB_LANGY_CLIENT_SECRET}`,
    ).toString("base64");
    await fetch(
      `https://api.github.com/applications/${env.GITHUB_LANGY_CLIENT_ID}/grant`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/json",
          "User-Agent": "langwatch-langy",
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    );
  } catch (err) {
    logger.warn({ err }, "github grant revocation best-effort failed");
  }
}

async function ensureOrganizationMember({
  prisma,
  userId,
  organizationId,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
}): Promise<void> {
  if (!(await isOrganizationMember({ prisma, userId, organizationId }))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Not a member of organization ${organizationId}`,
    });
  }
}

export const langyGithubRouter = createTRPCRouter({
  getConnection: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      await ensureOrganizationMember({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
      return findGithubConnection({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
    }),

  disconnect: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(authorizeInResolver)
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationMember({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
      // Revoke at GitHub FIRST (needs the stored refresh token to mint an
      // access token), then delete the local row. If revoke succeeds but
      // delete fails the user reconnects and we re-create the row — safe.
      // The opposite order would delete the refresh token before we could
      // use it for the revoke.
      await revokeAtGitHub({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
      const deletedCount = await deleteGithubConnection({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
      // The revoke above just killed the access token GitHub-side, but the
      // mint path CACHED that very token (up to 7h). Drop it so a reconnect
      // mints fresh instead of serving the revoked one to workers.
      await clearGithubTokenCache({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
      if (deletedCount > 0) {
        await auditLog({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          action: "langy.github.disconnect",
        });
      }
      return { ok: true, deleted: deletedCount };
    }),
});
