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
import { z } from "zod";

import { env } from "~/env.mjs";
import { auditLog } from "~/server/auditLog";
import { createLogger } from "~/utils/logger/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const logger = createLogger("langwatch:trpc:langyGithub");

async function revokeAtGitHub(refreshTokenHint?: string | null) {
  if (!env.GITHUB_LANGY_CLIENT_ID || !env.GITHUB_LANGY_CLIENT_SECRET) return;
  // GitHub's grant-revocation endpoint requires the App's basic-auth and the
  // user's access_token; we don't store one. Best-effort: call the token
  // endpoint, expect 404 when nothing exists, and swallow non-2xx. The local
  // delete is the source of truth for the user.
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
        body: JSON.stringify({ access_token: refreshTokenHint ?? "" }),
      },
    );
  } catch (err) {
    logger.warn({ err }, "github grant revocation best-effort failed");
  }
}

export const langyGithubRouter = createTRPCRouter({
  getConnection: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.userGitHubCredential.findUnique({
        where: {
          userId_organizationId: {
            userId: ctx.session.user.id,
            organizationId: input.organizationId,
          },
        },
        select: {
          githubLogin: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return row;
    }),

  disconnect: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.prisma.userGitHubCredential.deleteMany({
        where: {
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        },
      });
      if (deleted.count > 0) {
        await revokeAtGitHub(null);
        await auditLog({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          action: "langy.github.disconnect",
        });
      }
      return { ok: true, deleted: deleted.count };
    }),
});
