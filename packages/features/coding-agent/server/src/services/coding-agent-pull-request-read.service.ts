import {
  codingAgentPersonalPullRequestUsageInputSchema,
  codingAgentPersonalPullRequestUsageSchema,
  codingAgentPullRequestDetailSchema,
  codingAgentPullRequestUsageInputSchema,
  codingAgentPullRequestUsageSchema,
  codingAgentSessionsListInputSchema,
  type CodingAgentContributorProject,
  type CodingAgentPersonalPullRequestUsage,
  type CodingAgentPullRequestDetail,
  type CodingAgentPullRequestUsage,
  type CodingAgentPullRequestUsageInput,
  type CodingAgentSessionBranchRecord,
  type CodingAgentSessionListRow,
} from "@langwatch/coding-agent-contract";
import {
  GithubPullRequestNotMappedError,
  type GithubPullRequest,
  type GithubService,
} from "@langwatch/github-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { CodingAgentBillingPolicyPort } from "../ports/coding-agent-billing.port";
import type { CodingAgentClockPort } from "../ports/coding-agent-clock.port";
import { CodingAgentSessionEventRepository } from "../repositories/coding-agent-session-event.repository";
import { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository";
import {
  CodingAgentPersonalPullRequestValuesService,
  type CodingAgentPersonalRepositoryGroup,
} from "./coding-agent-personal-pull-request-values.service";
import { CodingAgentPullRequestAssignmentService } from "./coding-agent-pull-request-assignment.service";
import { CodingAgentPullRequestShareService } from "./coding-agent-pull-request-share.service";
import {
  CodingAgentPullRequestUsageService,
  type CodingAgentModelUsage,
  type CodingAgentUsageRow,
} from "./coding-agent-pull-request-usage.service";
import { CodingAgentSessionReadService } from "./coding-agent-session-read.service";
import { CodingAgentSessionListPullRequestService } from "./coding-agent-session-list-pull-request.service";

export const SESSIONS_LIST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSIONS_LIST_LIMIT = 200;
export const USAGE_SESSION_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
export const PERSONAL_SESSION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const PERSONAL_SESSION_LIMIT = 1000;
export const DETAIL_SESSIONS_LIMIT = 50;

/** Private owner of GitHub-enriched coding-agent session and pull-request reads. */
export class CodingAgentPullRequestReadService {
  static create(options: {
    sessions: CodingAgentSessionRepository;
    sessionEvents: CodingAgentSessionEventRepository;
    sessionReads: CodingAgentSessionReadService;
    github: GithubService;
    projects: ProjectService;
    billing: CodingAgentBillingPolicyPort;
    clock: CodingAgentClockPort;
    assignments: CodingAgentPullRequestAssignmentService;
    shares: CodingAgentPullRequestShareService;
    usage: CodingAgentPullRequestUsageService;
    personalValues: CodingAgentPersonalPullRequestValuesService;
    sessionListPullRequests: CodingAgentSessionListPullRequestService;
  }): CodingAgentPullRequestReadService {
    return new CodingAgentPullRequestReadService(options);
  }

  private constructor(
    private readonly dependencies: {
      sessions: CodingAgentSessionRepository;
      sessionEvents: CodingAgentSessionEventRepository;
      sessionReads: CodingAgentSessionReadService;
      github: GithubService;
      projects: ProjectService;
      billing: CodingAgentBillingPolicyPort;
      clock: CodingAgentClockPort;
      assignments: CodingAgentPullRequestAssignmentService;
      shares: CodingAgentPullRequestShareService;
      usage: CodingAgentPullRequestUsageService;
      personalValues: CodingAgentPersonalPullRequestValuesService;
      sessionListPullRequests: CodingAgentSessionListPullRequestService;
    },
  ) {}

  async listForProject(input: { projectId: string }): Promise<CodingAgentSessionListRow[]> {
    const parsed = codingAgentSessionsListInputSchema.parse(input);
    const toMs = this.dependencies.clock.nowMs();
    const rows = await this.dependencies.sessionReads.listRecent({
      projectId: parsed.projectId,
      fromMs: toMs - SESSIONS_LIST_WINDOW_MS,
      toMs,
      limit: SESSIONS_LIST_LIMIT,
    });
    const pullRequests = await this.dependencies.sessionListPullRequests.findForProject({
      projectId: parsed.projectId,
      sessions: rows,
    });
    return rows.map((row) => ({
      sessionId: row.sessionId,
      title: row.title === "" ? null : row.title,
      agent: row.agent,
      agentVersion: row.agentVersion,
      repositoryHost: row.repositoryHost,
      repositoryOwner: row.repositoryOwner,
      repositoryName: row.repositoryName,
      gitBranch: row.gitBranch,
      gitBranches: this.dependencies.assignments.branchesOf(row),
      startedAtMs: row.startedAtMs,
      lastEventOccurredAtMs: row.lastEventOccurredAt,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      costUsd: row.costUsd,
      peakContextTokens: row.peakContextTokens,
      compactions: row.compactions,
      compactionTokensBefore: row.compactionTokensBefore,
      compactionTokensAfter: row.compactionTokensAfter,
      cacheRebuildCount: row.cacheRebuildCount,
      largestCacheRebuildTokens: row.largestCacheRebuildTokens,
      activeTimeCliSec: row.activeTimeCliSec,
      blockedOnUserMs: row.blockedOnUserMs,
      models: row.models,
      pullRequests: pullRequests.get(row.sessionId) ?? [],
    }));
  }

  async getPullRequestUsage(
    input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestUsage> {
    const query = codingAgentPullRequestUsageInputSchema.parse(input);
    const gathered = await this.gatherPullRequest(query);
    return codingAgentPullRequestUsageSchema.parse({
      pullRequest: this.pullRequestIdentity(gathered.target),
      rows: gathered.rows,
      totals: this.dependencies.usage.totals(gathered.rows),
      modelBreakdown: gathered.modelBreakdown,
    });
  }

  async getPullRequestDetail(
    input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestDetail> {
    const query = codingAgentPullRequestUsageInputSchema.parse(input);
    const gathered = await this.gatherPullRequest(query);
    const costProjects = new Set(query.costProjectIds);
    return codingAgentPullRequestDetailSchema.parse({
      pullRequest: {
        ...this.pullRequestIdentity(gathered.target),
        title: gathered.target.title,
      },
      totals: this.dependencies.usage.totals(gathered.rows),
      contributors: gathered.rows,
      modelBreakdown: gathered.modelBreakdown,
      sessions: [...gathered.sessions]
        .sort((a, b) => b.startedAtMs - a.startedAtMs)
        .slice(0, DETAIL_SESSIONS_LIMIT)
        .map((session) => ({
          sessionId: session.sessionId,
          startedAtMs: session.startedAtMs,
          ...this.dependencies.usage.contributorFor(session.tenantId, query.projects),
          agent: session.agent,
          totalTokens: this.dependencies.usage.tokenTotal(session),
          costUsd: costProjects.has(session.tenantId) ? session.costUsd : null,
          title: session.title === "" ? null : session.title,
        })),
    });
  }

  async getForPersonalProject(input: {
    projectId: string;
    permittedProjectIds: string[];
    costProjectIds: string[];
    projects: Record<string, CodingAgentContributorProject>;
  }): Promise<CodingAgentPersonalPullRequestUsage> {
    const query = codingAgentPersonalPullRequestUsageInputSchema.parse(input);
    const project = await this.dependencies.projects.tryGetWithTeam(query.projectId);
    if (project === null) {
      return codingAgentPersonalPullRequestUsageSchema.parse({ rows: [], unlinked: [] });
    }
    const organizationId = project.team.organizationId;
    const toMs = this.dependencies.clock.nowMs();
    const sessions = await this.dependencies.sessionReads.listRecent({
      projectId: query.projectId,
      fromMs: toMs - PERSONAL_SESSION_WINDOW_MS,
      toMs,
      limit: PERSONAL_SESSION_LIMIT,
    });
    const groups = this.dependencies.personalValues.repositoryGroups({
      sessions,
      configuredGithubHost: this.dependencies.github.normalizeRepositoryHost(""),
    });
    const rows: unknown[] = [];
    const unlinked: unknown[] = [];
    const nonBillableAgents = await this.nonBillableAgents(
      organizationId,
      sessions.map((session) => session.agent),
    );
    for (const group of groups) {
      const pullRequests = await this.dependencies.github.findAllByBranches({
        organizationId,
        repositoryHost: group.repositoryHost,
        repositoryFullName: group.repositoryFullName,
        headBranches: [...new Set(group.sessions.flatMap((session) => session.headBranches))],
      });
      // Discovery is personal: only the pull requests this project's own work
      // touched become rows. Per branch, so a session that drove two pull
      // requests surfaces both — each row then prices only its own share of
      // the session.
      const assignments = this.dependencies.assignments.assignDrivingSessionsPerBranch({
        sessions: group.sessions.map((session) => ({
          sessionId: session.sessionId,
          startedAtMs: session.startedAtMs,
          headBranches: session.headBranches,
        })),
        pullRequests: this.assignable(pullRequests),
      });
      const discovered = pullRequests.filter((pullRequest) =>
        group.sessions.some((session) => {
          const branchWinners = assignments.get(session.sessionId);
          if (branchWinners === undefined) return false;
          return [...branchWinners.values()].includes(pullRequest.prNumber);
        }),
      );
      if (discovered.length > 0) {
        rows.push(
          ...(await this.personalOrganizationRows({
            group,
            discovered,
            pullRequests,
            query,
            organizationId,
            toMs,
          })),
        );
      }
      const unmatched = group.sessions.filter((session) => !assignments.has(session.sessionId));
      if (unmatched.length === 0) continue;
      const repoCovered = await this.dependencies.github.coversRepository({
        organizationId,
        repositoryFullName: group.repositoryFullName,
      });
      unlinked.push(
        ...this.dependencies.personalValues.unlinkedRows({
          group,
          sessions: unmatched,
          repoCovered,
          nonBillableAgents,
        }),
      );
    }
    return codingAgentPersonalPullRequestUsageSchema.parse({ rows, unlinked });
  }

  private async gatherPullRequest(query: CodingAgentPullRequestUsageInput): Promise<{
    target: GithubPullRequest;
    sessions: CodingAgentSessionBranchRecord[];
    rows: CodingAgentUsageRow[];
    modelBreakdown: CodingAgentModelUsage[];
  }> {
    const target = await this.dependencies.github.tryFindByNumber({
      organizationId: query.organizationId,
      repositoryHost: query.repositoryHost,
      repositoryFullName: query.repositoryFullName,
      prNumber: query.prNumber,
    });
    if (target === null) {
      throw new GithubPullRequestNotMappedError({
        repositoryFullName: query.repositoryFullName,
        prNumber: query.prNumber,
      });
    }
    if (query.permittedProjectIds.length === 0) {
      return { target, sessions: [], rows: [], modelBreakdown: [] };
    }
    const siblings = await this.dependencies.github.findAllByBranches({
      organizationId: query.organizationId,
      repositoryHost: target.repositoryHost,
      repositoryFullName: target.repositoryFullName,
      headBranches: [target.headBranch],
    });
    const [repositoryOwner, repositoryName] = target.repositoryFullName.split("/");
    if (!repositoryOwner || !repositoryName) {
      return { target, sessions: [], rows: [], modelBreakdown: [] };
    }
    const toMs = this.dependencies.clock.nowMs();
    const candidates = await this.candidateSessionsFor({
      tenantIds: query.permittedProjectIds,
      repositoryHost: target.repositoryHost,
      repositoryOwner,
      repositoryName,
      branches: [target.headBranch],
      fromMs: toMs - USAGE_SESSION_WINDOW_MS,
    });
    const modelTotals = await this.dependencies.sessionEvents.sumTokensByModelPerSession({
      tenantIds: query.permittedProjectIds,
      sessionIds: candidates.sessions.map((session) => session.sessionId),
      fromMs: toMs - USAGE_SESSION_WINDOW_MS,
    });
    const attribution = this.dependencies.shares.attribute({
      sessions: candidates.sessions,
      rowMatchedSessionKeys: candidates.rowMatchedSessionKeys,
      pullRequests: this.assignable(siblings),
      prNumber: target.prNumber,
      repositoryHost: target.repositoryHost,
      repositoryFullName: target.repositoryFullName,
      modelTotals,
    });
    const attached = attribution.sessions;
    const costProjects = new Set(query.costProjectIds);
    const nonBillableAgents = await this.nonBillableAgents(
      query.organizationId,
      attached.map((session) => session.agent),
    );
    return {
      target,
      sessions: attached,
      rows: this.dependencies.usage.groupedRows(
        attached,
        costProjects,
        nonBillableAgents,
        query.projects,
      ),
      modelBreakdown: this.dependencies.usage.modelUsage(
        attached,
        attribution.modelTotals,
        costProjects,
      ),
    };
  }

  private async personalOrganizationRows(input: {
    group: CodingAgentPersonalRepositoryGroup;
    discovered: readonly GithubPullRequest[];
    pullRequests: readonly GithubPullRequest[];
    query: {
      permittedProjectIds: string[];
      costProjectIds: string[];
      projects: Record<string, CodingAgentContributorProject>;
    };
    organizationId: string;
    toMs: number;
  }): Promise<unknown[]> {
    if (input.query.permittedProjectIds.length === 0) return [];
    const [repositoryOwner, repositoryName] = input.group.repositoryFullName.split("/");
    if (!repositoryOwner || !repositoryName) return [];
    const candidates = await this.candidateSessionsFor({
      tenantIds: input.query.permittedProjectIds,
      repositoryHost: input.group.repositoryHost,
      repositoryOwner,
      repositoryName,
      branches: [...new Set(input.discovered.map((pullRequest) => pullRequest.headBranch))],
      fromMs: input.toMs - USAGE_SESSION_WINDOW_MS,
    });
    const nonBillableAgents = await this.nonBillableAgents(
      input.organizationId,
      candidates.sessions.map((session) => session.agent),
    );
    const modelTotals = await this.dependencies.sessionEvents.sumTokensByModelPerSession({
      tenantIds: input.query.permittedProjectIds,
      sessionIds: candidates.sessions.map((session) => session.sessionId),
      fromMs: input.toMs - USAGE_SESSION_WINDOW_MS,
    });
    const costProjects = new Set(input.query.costProjectIds);
    return input.discovered.map((pullRequest) => {
      const attribution = this.dependencies.shares.attribute({
        sessions: candidates.sessions,
        rowMatchedSessionKeys: candidates.rowMatchedSessionKeys,
        pullRequests: this.assignable(input.pullRequests),
        prNumber: pullRequest.prNumber,
        repositoryHost: input.group.repositoryHost,
        repositoryFullName: input.group.repositoryFullName,
        modelTotals,
      });
      const attached = attribution.sessions;
      const rows = this.dependencies.usage.groupedRows(
        attached,
        costProjects,
        nonBillableAgents,
        input.query.projects,
      );
      return {
        ...this.pullRequestIdentity(pullRequest),
        title: pullRequest.title,
        // Discovery runs on this project's own sessions, the share runs on
        // the stamps, so a discovered pull request can end up with no session
        // attached: every stamp of the session that found it landed on a
        // neighbour. The row stays, reporting no tokens and no cost, and
        // dates itself by the pull request rather than by the epoch.
        lastActivityAtMs:
          this.dependencies.usage.latestActivity(attached) ||
          (pullRequest.prUpdatedAt ?? pullRequest.prCreatedAt).getTime(),
        ...this.dependencies.usage.totals(rows),
        modelBreakdown: this.dependencies.usage.modelUsage(
          attached,
          attribution.modelTotals,
          costProjects,
        ),
        contributorsSummary: this.dependencies.usage.contributorsSummary(
          attached,
          input.query.projects,
        ),
      };
    });
  }

  /**
   * Every session that may have worked on one repository's branches, found two
   * ways and merged: sessions whose own row matches (the legacy read), plus
   * sessions whose STAMPED fact rows name the repository even though their row
   * has since moved to another one — a resumed agent cycling between
   * repositories is one session, and only its stamps remember everywhere it
   * has been. The returned key set marks the row-matched ones, which are the
   * only candidates the unstamped bucket may be priced under here.
   */
  private async candidateSessionsFor({
    tenantIds,
    repositoryHost,
    repositoryOwner,
    repositoryName,
    branches,
    fromMs,
  }: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    fromMs: number;
  }): Promise<{
    sessions: CodingAgentSessionBranchRecord[];
    rowMatchedSessionKeys: ReadonlySet<string>;
  }> {
    // Independent reads, so they go together: the stamped one needs the
    // row-matched keys only to subtract them, which happens after both land.
    const [rowMatched, stamped] = await Promise.all([
      this.dependencies.sessions.listByRepositoryBranch({
        tenantIds,
        repositoryHost,
        repositoryOwner,
        repositoryName,
        branches,
        startedAtFromMs: fromMs,
      }),
      this.dependencies.sessionEvents.listSessionsByStampedBranch({
        tenantIds,
        repositoryHost,
        repositoryOwner,
        repositoryName,
        branches,
        fromMs,
      }),
    ]);
    const rowMatchedSessionKeys = new Set(
      rowMatched.map(CodingAgentPullRequestShareService.sessionKey),
    );

    const missing = stamped.filter(
      (pair) => !rowMatchedSessionKeys.has(CodingAgentPullRequestShareService.sessionKey(pair)),
    );
    if (missing.length === 0) {
      return { sessions: rowMatched, rowMatchedSessionKeys };
    }

    const fetched = await this.dependencies.sessions.listBySessionIds({
      tenantIds,
      sessionIds: [...new Set(missing.map((pair) => pair.sessionId))],
      startedAtFromMs: fromMs,
    });
    // The id read cannot scope per tenant, so a provider session id shared by
    // two projects fetches both; keep only the (tenant, session) pairs the
    // stamps actually named.
    const missingKeys = new Set(missing.map(CodingAgentPullRequestShareService.sessionKey));
    const stampedOnly = fetched.filter((session) =>
      missingKeys.has(CodingAgentPullRequestShareService.sessionKey(session)),
    );
    return {
      sessions: [...rowMatched, ...stampedOnly],
      rowMatchedSessionKeys,
    };
  }

  private async nonBillableAgents(
    organizationId: string,
    agents: string[],
  ): Promise<ReadonlySet<string>> {
    const distinct = [...new Set(agents.filter((agent) => agent !== ""))];
    const answers = await Promise.all(
      distinct.map(async (agent) => ({
        agent,
        nonBillable: await this.dependencies.billing.isSourceNonBillable({
          organizationId,
          sourceType: this.dependencies.usage.ingestSourceType(agent),
        }),
      })),
    );
    return new Set(answers.filter((answer) => answer.nonBillable).map((answer) => answer.agent));
  }

  private assignable(pullRequests: readonly GithubPullRequest[]): Array<{
    prNumber: number;
    headBranch: string;
    prCreatedAtMs: number;
    prClosedAtMs: number | null;
    prMergedAtMs: number | null;
  }> {
    return pullRequests.map((pullRequest) => ({
      prNumber: pullRequest.prNumber,
      headBranch: pullRequest.headBranch,
      prCreatedAtMs: pullRequest.prCreatedAt.getTime(),
      prClosedAtMs: pullRequest.prClosedAt?.getTime() ?? null,
      prMergedAtMs: pullRequest.prMergedAt?.getTime() ?? null,
    }));
  }

  private pullRequestIdentity(pullRequest: GithubPullRequest) {
    return {
      repositoryHost: pullRequest.repositoryHost,
      repositoryFullName: pullRequest.repositoryFullName,
      prNumber: pullRequest.prNumber,
      headBranch: pullRequest.headBranch,
      htmlUrl: pullRequest.htmlUrl,
      state: pullRequest.state,
      isDraft: pullRequest.isDraft,
      authorLogin: pullRequest.authorLogin,
      prCreatedAtMs: pullRequest.prCreatedAt.getTime(),
      prClosedAtMs: pullRequest.prClosedAt?.getTime() ?? null,
      prMergedAtMs: pullRequest.prMergedAt?.getTime() ?? null,
    };
  }
}
