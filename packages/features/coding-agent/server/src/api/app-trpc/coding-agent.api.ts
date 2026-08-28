/**
 * The coding-agent SESSION read surface over the process's tRPC transport
 * (ADR-056).
 *
 * Project-scoped and gated by `traces:view`, like tracesV2. Personal-workspace
 * usage passes the caller's personal project id (the /me page already resolves
 * it via `user.personalContext`), and the personal project isolates the user's
 * sessions — so no per-user filter is applied here; the stored UserId is the
 * agent's own identity, not the LangWatch account (see the service).
 *
 * Transport only: gates, viewer-scoped redaction and delegation to the
 * canonical `CodingAgentService`.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type {
  CodingAgentPersonalPullRequestUsageInput,
  CodingAgentService,
} from "@langwatch/coding-agent-contract";
import {
  GithubPullRequestNotMappedError,
  type GithubService,
} from "@langwatch/github-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import {
  gatePullRequestSessionTitles,
  gateSessionListCost,
  gateSessionListTitles,
} from "./coding-agent.gates";

/** Default look-back for the personal usage card: the trailing 30 days. */
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type CodingAgentApplication = Readonly<{
  codingAgents: CodingAgentService;
  github: GithubService;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type CodingAgentTrpcContext = Readonly<{
  app: CodingAgentApplication;
  actor(): Readonly<{ id: string }>;
}>;

type CodingAgentTrpcProcedures<
  TContext extends CodingAgentTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The caller's permission cut over an organization: which of its projects they
 * may read, which of those they may also price, and how each is named to them.
 * Exactly the shape both priced reads take.
 */
export type CodingAgentCallerScope = Pick<
  CodingAgentPersonalPullRequestUsageInput,
  "permittedProjectIds" | "costProjectIds" | "projects"
>;

/** What a single viewer may see of one project. */
export type CodingAgentViewerVisibility = Readonly<{
  /** Whether the generated session titles are readable — they paraphrase the conversation. */
  canReadCapturedContent: boolean;
  /** Whether spend is readable, the `cost:view` cut. */
  canSeeCosts: boolean;
}>;

/**
 * The per-request handle the process's visibility reader needs. Opaque here on
 * purpose: only the process knows what identifies a caller to its own database
 * and session, and this transport never reads it — it only decides which
 * project to ask about.
 */
export type CodingAgentTrpcRequest = unknown;

/** The process capabilities this transport needs that are not coding-agent's own. */
export type CodingAgentTrpcPorts = Readonly<{
  /**
   * The organization a project belongs to, or undefined for an orphan project.
   * Derived here rather than taken from the client, so a caller cannot ask
   * about another tenant's pull requests by naming its id.
   */
  tryResolveOrganizationForProject(projectId: string): Promise<string | undefined>;
  /** The caller's permission cut over one organization. */
  resolveCallerProjectScope(input: {
    userId: string;
    organizationId: string;
  }): Promise<CodingAgentCallerScope>;
  /**
   * What this viewer may see of one project. Throws when the policy cannot be
   * resolved at all, which the pull-request detail reads as "not visible" —
   * the same fail-closed reading the process's own protections lookup applies.
   */
  readViewerVisibility(
    request: CodingAgentTrpcRequest,
    input: { projectId: string },
  ): Promise<CodingAgentViewerVisibility>;
}>;

/** The permission cut every procedure on this surface declares. */
const CODING_AGENT_PERMISSION: AuthzPermission = "traces:view";

const projectScopeSchema = z.object({ projectId: z.string() });

const usageTotalsInputSchema = z.object({
  projectId: z.string(),
  /** Window bounds in epoch ms; defaults to the trailing 30 days. */
  fromMs: z.number().int().optional(),
  toMs: z.number().int().optional(),
});

const recentSessionsInputSchema = z.object({
  projectId: z.string(),
  fromMs: z.number().int().optional(),
  toMs: z.number().int().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const pullRequestDetailInputSchema = z.object({
  projectId: z.string(),
  repositoryHost: z.string(),
  repositoryFullName: z.string(),
  prNumber: z.number().int().positive(),
});

/**
 * Which of these projects the caller may read the captured content of.
 *
 * Resolved once per distinct project, because the input is a list of sessions
 * and several of them routinely ran in the same workspace. A project whose
 * visibility cannot be resolved at all is absent from the set, which hides its
 * titles: the same fail-closed reading the process's protections lookup
 * applies when a policy lookup fails.
 */
async function contentProjectIdsFor({
  ports,
  request,
  projectIds,
}: {
  ports: CodingAgentTrpcPorts;
  request: CodingAgentTrpcRequest;
  projectIds: string[];
}): Promise<Set<string>> {
  const distinct = [...new Set(projectIds)];
  const visible = await Promise.all(
    distinct.map(async (projectId) => {
      try {
        const visibility = await ports.readViewerVisibility(request, { projectId });
        return visibility.canReadCapturedContent ? projectId : null;
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
  ports,
  userId,
  projectId,
}: {
  ports: CodingAgentTrpcPorts;
  userId: string;
  projectId: string;
}): Promise<CodingAgentCallerScope> {
  const organizationId = await ports.tryResolveOrganizationForProject(projectId);
  if (!organizationId) {
    return { permittedProjectIds: [], costProjectIds: [], projects: {} };
  }
  return ports.resolveCallerProjectScope({ userId, organizationId });
}

/**
 * Installs the complete `codingAgents.*` tRPC surface on a process-owned root.
 * The procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class CodingAgentTrpcApi {
  static create<
    TContext extends CodingAgentTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: CodingAgentTrpcProcedures<TContext, TOptions, TRoot>,
    ports: CodingAgentTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * The "at a glance" usage totals for a project's coding-agent sessions in a
       * window — cost, tokens, active time and session count, plus what the
       * sessions produced. Metric-only sessions are included.
       */
      usageTotals: policy(CODING_AGENT_PERMISSION)(
        procedure.input(usageTotalsInputSchema),
      ).query(async ({ ctx, input }) => {
        const toMs = input.toMs ?? Date.now();
        const fromMs = input.fromMs ?? toMs - DEFAULT_WINDOW_MS;
        return ctx.app.codingAgents.getUsageTotals({
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
      recentSessions: policy(CODING_AGENT_PERMISSION)(
        procedure.input(recentSessionsInputSchema),
      ).query(async ({ ctx, input }) => {
        const toMs = input.toMs ?? Date.now();
        const fromMs = input.fromMs ?? toMs - DEFAULT_WINDOW_MS;
        return ctx.app.codingAgents.listRecent({
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
      sessionsList: policy(CODING_AGENT_PERMISSION)(
        procedure.input(projectScopeSchema),
      ).query(async ({ ctx, input }) => {
        const visibility = await ports.readViewerVisibility(ctx, {
          projectId: input.projectId,
        });
        const rows = await ctx.app.codingAgents.listForProject({
          projectId: input.projectId,
        });
        return gateSessionListCost({
          rows: gateSessionListTitles({
            rows,
            canReadCapturedContent: visibility.canReadCapturedContent,
          }),
          canSeeCosts: visibility.canSeeCosts,
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
      pullRequestUsage: policy(CODING_AGENT_PERMISSION)(
        procedure.input(projectScopeSchema),
      ).query(async ({ ctx, input }) => {
        const app = ctx.app;
        const scope = await scopeFor({
          ports,
          userId: ctx.actor().id,
          projectId: input.projectId,
        });
        const usage = await app.codingAgents.getForPersonalProject({
          projectId: input.projectId,
          ...scope,
        });
        const organizationId = await ports.tryResolveOrganizationForProject(input.projectId);
        const installations = organizationId
          ? await app.github.getAllForOrganization(organizationId)
          : [];
        return {
          ...usage,
          connection: {
            connected: installations.length > 0,
            installUrl:
              organizationId &&
              app.github.configured &&
              Boolean(app.github.getAppConfig().appSlug)
                ? `/api/github/install?organizationId=${encodeURIComponent(organizationId)}`
                : null,
          },
        };
      }),

      /**
       * One pull request in full: its totals, who worked on it, what each model
       * consumed, and the sessions that ran. Same permission cut as the list.
       *
       * Each session is named by the title its agent generated, and that title is
       * resolved against the visibility of the project the session ran in: the
       * detail spans an organization, and a reader can be trusted with one
       * project's conversations and not another's. Only the projects that actually
       * contributed a session are resolved, so the cost is bounded by what the
       * detail lists rather than by the size of the organization.
       */
      pullRequestDetail: policy(CODING_AGENT_PERMISSION)(
        procedure.input(pullRequestDetailInputSchema),
      ).query(async ({ ctx, input }) => {
        const organizationId = await ports.tryResolveOrganizationForProject(input.projectId);
        if (!organizationId) {
          throw new GithubPullRequestNotMappedError({
            repositoryFullName: input.repositoryFullName,
            prNumber: input.prNumber,
          });
        }
        const scope = await ports.resolveCallerProjectScope({
          userId: ctx.actor().id,
          organizationId,
        });
        const detail = await ctx.app.codingAgents.getPullRequestDetail({
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
              ports,
              request: ctx,
              projectIds: detail.sessions.map((session) => session.projectId),
            }),
          }),
        };
      }),
    });
  }
}
