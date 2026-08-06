import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { checkProjectPermission } from "../rbac";

/** Default look-back for the personal usage card: the trailing 30 days. */
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Read surface for coding-agent SESSION usage (ADR-056).
 *
 * Project-scoped and gated by `traces:view`, like tracesV2. Personal-workspace
 * usage passes the caller's personal project id (the /me page already resolves
 * it via `user.personalContext`), and the personal project isolates the user's
 * sessions — so no per-user filter is applied here; the stored UserId is the
 * agent's own identity, not the LangWatch account (see the service).
 */
export const codingAgentsRouter = createTRPCRouter({
  /**
   * The "at a glance" usage totals for a project's coding-agent sessions in a
   * window — cost, tokens, active time and session count, plus what the
   * sessions produced. Metric-only sessions are included.
   */
  usageTotals: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        /** Window bounds in epoch ms; defaults to the trailing 30 days. */
        fromMs: z.number().int().optional(),
        toMs: z.number().int().optional(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      const toMs = input.toMs ?? Date.now();
      const fromMs = input.fromMs ?? toMs - DEFAULT_WINDOW_MS;
      return app.codingAgents.sessions.getUsageTotals({
        projectId: input.projectId,
        fromMs,
        toMs,
      });
    }),

  /**
   * The project's recent coding-agent sessions in a window, newest first —
   * the list behind the personal usage surface. Each row is counters, bounded
   * sets and ids only (no prompt/reply/tool content).
   */
  recentSessions: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        fromMs: z.number().int().optional(),
        toMs: z.number().int().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      const toMs = input.toMs ?? Date.now();
      const fromMs = input.fromMs ?? toMs - DEFAULT_WINDOW_MS;
      return app.codingAgents.sessions.listRecent({
        projectId: input.projectId,
        fromMs,
        toMs,
        limit: input.limit ?? 50,
      });
    }),

  /**
   * What each of the project's pull requests cost, plus the branches whose
   * pull request has not been opened (or mapped) yet, plus whether GitHub is
   * connected at all, in one query, because the page needs all three to decide
   * what to render, and three round trips would show it in three stages.
   */
  pullRequestUsage: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const app = getApp();
      const usage =
        await app.codingAgents.pullRequestUsage.getForPersonalProject({
          projectId: input.projectId,
        });
      return { ...usage, connection: await connectionFor(input.projectId) };
    }),
});

/**
 * Whether the project's organization has GitHub connected, and where to start
 * an install. Mirrors `github.getConnectionStatus`'s install link so a page
 * that has this answer never needs the organization-scoped query too.
 */
async function connectionFor(projectId: string): Promise<{
  connected: boolean;
  installUrl: string | null;
}> {
  const organizationId = await resolveOrganizationId(projectId);
  if (!organizationId) return { connected: false, installUrl: null };
  const installations =
    await getApp().github.installations.getAllForOrganization(organizationId);
  return {
    connected: installations.length > 0,
    installUrl: `/api/github/install?organizationId=${encodeURIComponent(organizationId)}`,
  };
}
