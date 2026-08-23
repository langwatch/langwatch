import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { GithubPullRequestNotMappedError } from "~/server/app-layer/github/errors";
import { getGithubAppConfig } from "~/server/app-layer/github/githubAppConfig";
import {
  type CallerProjectScope,
  resolveCallerProjectScope,
} from "~/server/organizations/resolveCallerProjectScope";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { canReadCapturedContent } from "~/server/traces/protections";
import { getUserProtectionsForProject } from "../utils";
import {
  gatePullRequestSessionTitles,
  gateSessionListCost,
  gateSessionListTitles,
} from "./codingAgents.gates";

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
    .permission("traces:view")
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
    .permission("traces:view")
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
   * The Sessions screen's list: the project's coding-agent sessions of the
   * last ninety days, each named by the title its agent generated, priced, and
   * carrying the pull requests it drove.
   *
   * Its own read rather than a shape on `recentSessions`, which answers with
   * the stored row verbatim for the personal usage card. This one is a display
   * projection: it drops the columns no column of the table shows, and it
   * joins the organization's pull-request mapping onto the page.
   *
   * The title is the one conversation-derived value on the row, so it follows
   * the project's content visibility; the cost follows `cost:view`, like every
   * other spend on the platform.
   */
  sessionsList: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("traces:view")
    .query(async ({ ctx, input }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });
      const rows = await getApp().codingAgents.sessionsList.listForProject({
        projectId: input.projectId,
      });
      return gateSessionListCost({
        rows: gateSessionListTitles({ rows, protections }),
        protections,
      });
    }),

  /**
   * What each of the project's pull requests cost, plus the branches whose
   * pull request has not been opened (or mapped) yet, plus whether GitHub is
   * connected at all, in one query, because the page needs all three to decide
   * what to render, and three round trips would show it in three stages.
   *
   * The rows the caller's own project discovers are priced across every
   * project the caller may read, so a shared pull request reports its whole
   * price rather than one person's share of it.
   */
  pullRequestUsage: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("traces:view")
    .query(async ({ ctx, input }) => {
      const app = getApp();
      const scope = await scopeFor({
        userId: ctx.session.user.id,
        projectId: input.projectId,
      });
      const usage =
        await app.codingAgents.pullRequestUsage.getForPersonalProject({
          projectId: input.projectId,
          ...scope,
        });
      return { ...usage, connection: await connectionFor(input.projectId) };
    }),

  /**
   * One pull request in full: its totals, who worked on it, what each model
   * consumed, and the sessions that ran. Same permission cut as the list.
   *
   * Each session is named by the title its agent generated, and that title is
   * resolved against the protections of the project the session ran in: the
   * detail spans an organization, and a reader can be trusted with one
   * project's conversations and not another's. Only the projects that actually
   * contributed a session are resolved, so the cost is bounded by what the
   * detail lists rather than by the size of the organization.
   */
  pullRequestDetail: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        repositoryHost: z.string(),
        repositoryFullName: z.string(),
        prNumber: z.number().int().positive(),
      }),
    )
    .permission("traces:view")
    .query(async ({ ctx, input }) => {
      const organizationId = await resolveOrganizationId(input.projectId);
      if (!organizationId) {
        throw new GithubPullRequestNotMappedError({
          repositoryFullName: input.repositoryFullName,
          prNumber: input.prNumber,
        });
      }
      const scope = await resolveCallerProjectScope({
        userId: ctx.session.user.id,
        organizationId,
      });
      const detail =
        await getApp().codingAgents.pullRequestUsage.getPullRequestDetail({
          organizationId,
          repositoryHost: input.repositoryHost,
          repositoryFullName: input.repositoryFullName,
          prNumber: input.prNumber,
          ...scope,
        });
      return {
        ...detail,
        sessions: gatePullRequestSessionTitles({
          sessions: detail.sessions,
          contentProjectIds: await contentProjectIdsFor({
            ctx,
            projectIds: detail.sessions.map((session) => session.projectId),
          }),
        }),
      };
    }),
});

/**
 * Which of these projects the caller may read the captured content of.
 *
 * Resolved once per distinct project, because the input is a list of sessions
 * and several of them routinely ran in the same workspace. A project whose
 * protections cannot be resolved at all is absent from the set, which hides
 * its titles: the same fail-closed reading `getUserProtectionsForProject`
 * applies when a policy lookup fails.
 */
async function contentProjectIdsFor({
  ctx,
  projectIds,
}: {
  ctx: Parameters<typeof getUserProtectionsForProject>[0];
  projectIds: string[];
}): Promise<Set<string>> {
  const distinct = [...new Set(projectIds)];
  const visible = await Promise.all(
    distinct.map(async (projectId) => {
      try {
        const protections = await getUserProtectionsForProject(ctx, {
          projectId,
        });
        return canReadCapturedContent(protections) ? projectId : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(visible.filter((projectId) => projectId !== null));
}

/**
 * The caller's permission cut over the project's organization. An empty cut
 * when the project belongs to no organization: nothing is readable, which is
 * the same answer the rest of this surface gives.
 */
async function scopeFor({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}): Promise<CallerProjectScope> {
  const organizationId = await resolveOrganizationId(projectId);
  if (!organizationId) {
    return { permittedProjectIds: [], costProjectIds: [], projects: {} };
  }
  return resolveCallerProjectScope({ userId, organizationId });
}

/**
 * Whether the project's organization has GitHub connected, and where to start
 * an install. Mirrors `github.getConnectionStatus`'s install link so a page
 * that has this answer never needs the organization-scoped query too.
 *
 * The link is null on an instance with no GitHub App configured: the install
 * route answers 503 there, and a link that cannot start its flow is worse than
 * no link at all. It is the only availability signal in this payload, so its
 * absence is what tells the page not to offer connecting.
 *
 * "Configured" is read the way the install route reads it, App slug included.
 * The token service answers a narrower question, whether it can mint, and an
 * instance holding an id and a key but no slug mints happily while the deep
 * link this builds has nowhere on github.com to point.
 */
async function connectionFor(projectId: string): Promise<{
  connected: boolean;
  installUrl: string | null;
}> {
  const installations = getApp().github.installations;
  const organizationId = await resolveOrganizationId(projectId);
  if (!organizationId) return { connected: false, installUrl: null };
  const existing = await installations.getAllForOrganization(organizationId);
  return {
    connected: existing.length > 0,
    installUrl: getGithubAppConfig().configured
      ? `/api/github/install?organizationId=${encodeURIComponent(organizationId)}`
      : null,
  };
}
