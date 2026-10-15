import type { Authorization } from "@langwatch/authorization";
import type {
  CodingAgentSession,
  CodingAgentSessionLookupInput,
  CodingAgentTracePullRequestInput,
  CodingAgentTracePullRequestLink,
} from "@langwatch/coding-agent-contract";
import {
  gateSessionTitle,
  teaserOf,
  type SessionGroupCodingAgentDto,
  type TraceApi,
  type TraceSessionGroupsInput,
  type TracesSessionsPage,
} from "@langwatch/trace-contract";

/** The session reads the Sessions lens enrichment is drawn from. */
export interface CodingAgentSessionGroupsSessions {
  findBySessionId(input: CodingAgentSessionLookupInput): Promise<CodingAgentSession | null>;
  linkTraceSessionsToPullRequests(
    input: CodingAgentTracePullRequestInput,
  ): Promise<CodingAgentTracePullRequestLink[]>;
}

type SessionGroupsPageRow = TracesSessionsPage["sessions"][number];

/** How many coding-agent session lookups run concurrently per page. */
const ENRICHMENT_CONCURRENCY = 10;

/** A session row stores "nothing reported this" as an empty string. */
const normalizeEmptyToNull = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === "" ? null : value;

/**
 * The Sessions lens (main's `traces.sessions`, modules/trace/specs/sessions-lens.feature): trace
 * reads the page through the viewer's protections, then each session whose conversation id is a
 * coding-agent session gains its counters, git context, title and pull request.
 */
export class CodingAgentSessionGroupsReadService {
  static create(deps: {
    traces: Pick<TraceApi, "resolveViewerProtections" | "readSessionGroups">;
    sessions: CodingAgentSessionGroupsSessions;
    findOrganizationForProject: (projectId: string) => Promise<string | undefined>;
  }): CodingAgentSessionGroupsReadService {
    return new CodingAgentSessionGroupsReadService(deps);
  }

  private readonly traces: Pick<TraceApi, "resolveViewerProtections" | "readSessionGroups">;
  private readonly sessions: CodingAgentSessionGroupsSessions;
  private readonly findOrganizationForProject: (projectId: string) => Promise<string | undefined>;

  private constructor(deps: {
    traces: Pick<TraceApi, "resolveViewerProtections" | "readSessionGroups">;
    sessions: CodingAgentSessionGroupsSessions;
    findOrganizationForProject: (projectId: string) => Promise<string | undefined>;
  }) {
    this.traces = deps.traces;
    this.sessions = deps.sessions;
    this.findOrganizationForProject = deps.findOrganizationForProject;
  }

  async readForViewer(
    input: TraceSessionGroupsInput & { viewerUserId: string; authorization: Authorization },
  ): Promise<TracesSessionsPage> {
    const { viewerUserId, ...request } = input;
    const protections = await this.traces.resolveViewerProtections({
      projectId: request.projectId,
      userId: viewerUserId,
    });
    const page = await this.traces.readSessionGroups({ ...request, protections });
    const enrichments = await this.enrich({ projectId: request.projectId, rows: page.sessions });
    await this.linkPullRequests({ projectId: request.projectId, rows: page.sessions, enrichments });

    const cutoffMs = protections.visibilityCutoffMs ?? null;
    const sessions = page.sessions.map((session, index) => {
      const codingAgent = enrichments[index] ?? null;
      const beyondWindow = cutoffMs !== null && session.lastActivityMs < cutoffMs;

      return {
        ...session,
        codingAgent: beyondWindow && codingAgent ? withTeasedTitle(codingAgent) : codingAgent,
      };
    });

    return { ...page, sessions: gateSessionTitle({ sessions, protections }) };
  }

  /**
   * Coding-agent counters per session, bounded fan-out. Best-effort by design: a missing session
   * row is the normal answer for ordinary conversations, and a failed lookup must not take the
   * whole list down.
   */
  private async enrich({
    projectId,
    rows,
  }: {
    projectId: string;
    rows: SessionGroupsPageRow[];
  }): Promise<(SessionGroupCodingAgentDto | null)[]> {
    const results: (SessionGroupCodingAgentDto | null)[] = [];
    for (let i = 0; i < rows.length; i += ENRICHMENT_CONCURRENCY) {
      const chunk = rows.slice(i, i + ENRICHMENT_CONCURRENCY);
      const settled = await Promise.all(
        chunk.map((row) =>
          this.sessions
            .findBySessionId({
              projectId,
              sessionId: row.conversationId,
              startedAtMs: row.startedAtMs,
            })
            .then((session) => (session ? enrichmentOf(session) : null))
            .catch(() => null),
        ),
      );
      results.push(...settled);
    }

    return results;
  }

  /**
   * Attach each session to the pull request its branch's history says it belongs to, for the whole
   * page in one lookup. Best-effort like the enrichment it decorates: no GitHub connection, an
   * unreachable repository or a failed read all leave rows unlinked rather than failing the list.
   */
  private async linkPullRequests({
    projectId,
    rows,
    enrichments,
  }: {
    projectId: string;
    rows: SessionGroupsPageRow[];
    enrichments: (SessionGroupCodingAgentDto | null)[];
  }): Promise<void> {
    try {
      const organizationId = await this.findOrganizationForProject(projectId);
      if (!organizationId) {
        return;
      }

      const links = await this.sessions.linkTraceSessionsToPullRequests({
        organizationId,
        sessions: rows.map((row, index) => {
          const codingAgent = enrichments[index];

          return {
            sessionId: row.conversationId,
            startedAtMs: row.startedAtMs,
            repositoryHost: codingAgent?.repositoryHost ?? null,
            repositoryOwner: codingAgent?.repositoryOwner ?? null,
            repositoryName: codingAgent?.repositoryName ?? null,
            gitBranch: codingAgent?.gitBranch ?? null,
          };
        }),
      });
      const pullRequestBySessionId = new Map(
        links.map((link) => [link.sessionId, link.pullRequest]),
      );

      rows.forEach((row, index) => {
        const pullRequest = pullRequestBySessionId.get(row.conversationId);
        const codingAgent = enrichments[index];
        if (pullRequest && codingAgent) {
          codingAgent.pullRequest = pullRequest;
        }
      });
    } catch {
      // Unlinked is a correct answer; a failed join must not take the list down.
      return;
    }
  }
}

/** One session row as the lens reads it; the pull request is joined for the whole page after. */
function enrichmentOf(session: CodingAgentSession): SessionGroupCodingAgentDto {
  return {
    modelCalls: session.modelCalls,
    compactions: session.compactions,
    peakContextTokens: session.peakContextTokens,
    subAgents: session.subAgents,
    repositoryHost: normalizeEmptyToNull(session.repositoryHost),
    repositoryOwner: normalizeEmptyToNull(session.repositoryOwner),
    repositoryName: normalizeEmptyToNull(session.repositoryName),
    gitBranch: normalizeEmptyToNull(session.gitBranch),
    gitWorktree: normalizeEmptyToNull(session.gitWorktree),
    title: normalizeEmptyToNull(session.title),
    pullRequest: null,
  };
}

/** Past the viewer's window the generated title is conversation content, so it is teased too. */
function withTeasedTitle(codingAgent: SessionGroupCodingAgentDto): SessionGroupCodingAgentDto {
  if (!codingAgent.title) return codingAgent;
  return { ...codingAgent, title: teaserOf(codingAgent.title) };
}
