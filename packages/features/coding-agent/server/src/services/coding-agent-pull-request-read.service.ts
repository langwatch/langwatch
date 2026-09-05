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
import { CodingAgentSessionCandidatesService } from "./coding-agent-session-candidates.service";
import {
  assignablePullRequests,
  pullRequestIdentity,
} from "../rules/coding-agent-pull-request.rules";

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
    return new CodingAgentPullRequestReadService({
      ...options,
      candidates: CodingAgentSessionCandidatesService.create({
        sessions: options.sessions,
        sessionEvents: options.sessionEvents,
        billing: options.billing,
        usage: options.usage,
      }),
    });
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
      candidates: CodingAgentSessionCandidatesService;
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
      pullRequest: pullRequestIdentity(gathered.target),
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
        ...pullRequestIdentity(gathered.target),
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
    const nonBillableAgents = await this.dependencies.candidates.nonBillableAgents(
      organizationId,
      sessions.map((session) => session.agent),
    );
    for (const group of groups) {
      const found = await this.personalGroupRows({
        group,
        query,
        organizationId,
        toMs,
        nonBillableAgents,
      });
      rows.push(...found.rows);
      unlinked.push(...found.unlinked);
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
    const candidates = await this.dependencies.candidates.findCandidates({
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
      pullRequests: assignablePullRequests(siblings),
      prNumber: target.prNumber,
      repositoryHost: target.repositoryHost,
      repositoryFullName: target.repositoryFullName,
      modelTotals,
    });
    const attached = attribution.sessions;
    const costProjects = new Set(query.costProjectIds);
    const nonBillableAgents = await this.dependencies.candidates.nonBillableAgents(
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
    if (input.query.permittedProjectIds.length === 0) {
      return [];
    }

    const [repositoryOwner, repositoryName] = input.group.repositoryFullName.split("/");
    if (!repositoryOwner || !repositoryName) {
      return [];
    }

    const candidates = await this.dependencies.candidates.findCandidates({
      tenantIds: input.query.permittedProjectIds,
      repositoryHost: input.group.repositoryHost,
      repositoryOwner,
      repositoryName,
      branches: [...new Set(input.discovered.map((pullRequest) => pullRequest.headBranch))],
      fromMs: input.toMs - USAGE_SESSION_WINDOW_MS,
    });
    const nonBillableAgents = await this.dependencies.candidates.nonBillableAgents(
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
        pullRequests: assignablePullRequests(input.pullRequests),
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
        ...pullRequestIdentity(pullRequest),
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

  /** One repository group's discovered pull-request rows, plus its sessions that matched none. */
  private async personalGroupRows(input: {
    group: CodingAgentPersonalRepositoryGroup;
    query: {
      permittedProjectIds: string[];
      costProjectIds: string[];
      projects: Record<string, CodingAgentContributorProject>;
    };
    organizationId: string;
    toMs: number;
    nonBillableAgents: ReadonlySet<string>;
  }): Promise<{ rows: unknown[]; unlinked: unknown[] }> {
    const { group, query, organizationId, toMs, nonBillableAgents } = input;
    const rows: unknown[] = [];
    const unlinked: unknown[] = [];
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
      pullRequests: assignablePullRequests(pullRequests),
    });
    const discovered = pullRequests.filter((pullRequest) =>
      group.sessions.some((session) => {
        const branchWinners = assignments.get(session.sessionId);
        if (branchWinners === undefined) {
          return false;
        }

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
    if (unmatched.length === 0) {
      return { rows, unlinked };
    }

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

    return { rows, unlinked };
  }
}
