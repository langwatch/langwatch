import {
  codingAgentPullRequestDetailSchema,
  codingAgentPullRequestUsageInputSchema,
  codingAgentPullRequestUsageSchema,
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
  type GithubApi,
} from "@langwatch/github-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { CodingAgentBillingPolicy, CodingAgentClock } from "../app/coding-agent.members.ts";
import type { CodingAgentSessionEventRepository } from "../repositories/coding-agent-session-event.repository.ts";
import type { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository.ts";
import {
  assignablePullRequests,
  pullRequestIdentity,
} from "../rules/coding-agent-pull-request.rules.ts";
import {
  CodingAgentPersonalPullRequestReadService,
  USAGE_SESSION_WINDOW_MS,
} from "./coding-agent-personal-pull-request-read.service.ts";
import type { CodingAgentPersonalPullRequestValuesService } from "./coding-agent-personal-pull-request-values.service.ts";
import type { CodingAgentPullRequestAssignmentService } from "./coding-agent-pull-request-assignment.service.ts";
import type { CodingAgentPullRequestShareService } from "./coding-agent-pull-request-share.service.ts";
import {
  type CodingAgentPullRequestUsageService,
  type CodingAgentModelUsage,
  type CodingAgentUsageRow,
} from "./coding-agent-pull-request-usage.service.ts";
import { CodingAgentSessionCandidatesService } from "./coding-agent-session-candidates.service.ts";
import type { CodingAgentSessionListPullRequestService } from "./coding-agent-session-list-pull-request.service.ts";
import type { CodingAgentSessionReadService } from "./coding-agent-session-read.service.ts";

export const SESSIONS_LIST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSIONS_LIST_LIMIT = 200;
export const DETAIL_SESSIONS_LIMIT = 50;

/** Private owner of GitHub-enriched coding-agent session and pull-request reads. */
export class CodingAgentPullRequestReadService {
  static create(options: {
    sessions: CodingAgentSessionRepository;
    sessionEvents: CodingAgentSessionEventRepository;
    sessionReads: CodingAgentSessionReadService;
    github: GithubApi;
    projects: ProjectApi;
    billing: CodingAgentBillingPolicy;
    clock: CodingAgentClock;
    assignments: CodingAgentPullRequestAssignmentService;
    shares: CodingAgentPullRequestShareService;
    usage: CodingAgentPullRequestUsageService;
    personalValues: CodingAgentPersonalPullRequestValuesService;
    sessionListPullRequests: CodingAgentSessionListPullRequestService;
  }): CodingAgentPullRequestReadService {
    const candidates = CodingAgentSessionCandidatesService.create({
      sessions: options.sessions,
      sessionEvents: options.sessionEvents,
      billing: options.billing,
      usage: options.usage,
    });
    return new CodingAgentPullRequestReadService({
      ...options,
      candidates,
      personal: CodingAgentPersonalPullRequestReadService.create({ ...options, candidates }),
    });
  }

  private constructor(
    private readonly dependencies: {
      sessionEvents: CodingAgentSessionEventRepository;
      sessionReads: CodingAgentSessionReadService;
      github: GithubApi;
      clock: CodingAgentClock;
      assignments: CodingAgentPullRequestAssignmentService;
      shares: CodingAgentPullRequestShareService;
      usage: CodingAgentPullRequestUsageService;
      sessionListPullRequests: CodingAgentSessionListPullRequestService;
      candidates: CodingAgentSessionCandidatesService;
      personal: CodingAgentPersonalPullRequestReadService;
    },
  ) {}

  async listForProject(input: { projectId: string }): Promise<CodingAgentSessionListRow[]> {
    const toMs = this.dependencies.clock.nowMs();
    const rows = await this.dependencies.sessionReads.listRecent({
      projectId: input.projectId,
      fromMs: toMs - SESSIONS_LIST_WINDOW_MS,
      toMs,
      limit: SESSIONS_LIST_LIMIT,
    });
    const pullRequests = await this.dependencies.sessionListPullRequests.findForProject({
      projectId: input.projectId,
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
        .toSorted((a, b) => b.startedAtMs - a.startedAtMs)
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

  getForPersonalProject(input: {
    projectId: string;
    permittedProjectIds: string[];
    costProjectIds: string[];
    projects: Record<string, CodingAgentContributorProject>;
  }): Promise<CodingAgentPersonalPullRequestUsage> {
    return this.dependencies.personal.getForPersonalProject(input);
  }

  private async gatherPullRequest(query: CodingAgentPullRequestUsageInput): Promise<{
    target: GithubPullRequest;
    sessions: CodingAgentSessionBranchRecord[];
    rows: CodingAgentUsageRow[];
    modelBreakdown: CodingAgentModelUsage[];
  }> {
    const target = await this.dependencies.github.findByNumber({
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

    const [repositoryOwner, repositoryName] = target.repositoryFullName.split("/");
    if (!repositoryOwner || !repositoryName) {
      return { target, sessions: [], rows: [], modelBreakdown: [] };
    }

    return this.attributedToTarget({ query, target, repositoryOwner, repositoryName });
  }

  /** The candidate sessions of `target`'s branch, attributed and priced for the read. */
  private async attributedToTarget({
    query,
    target,
    repositoryOwner,
    repositoryName,
  }: {
    query: CodingAgentPullRequestUsageInput;
    target: GithubPullRequest;
    repositoryOwner: string;
    repositoryName: string;
  }): Promise<{
    target: GithubPullRequest;
    sessions: CodingAgentSessionBranchRecord[];
    rows: CodingAgentUsageRow[];
    modelBreakdown: CodingAgentModelUsage[];
  }> {
    const toMs = this.dependencies.clock.nowMs();
    const candidates = await this.dependencies.candidates.findCandidates({
      tenantIds: query.permittedProjectIds,
      repositoryHost: target.repositoryHost,
      repositoryOwner,
      repositoryName,
      branches: [target.headBranch],
      fromMs: toMs - USAGE_SESSION_WINDOW_MS,
    });
    // Every pull request the branch ever hosted, because the tenure rule needs
    // the neighbours to know where this one's era ends, plus the pull requests
    // of every other branch the candidates drove, so a session is attributed
    // here exactly as the personal page attributes it.
    const [modelTotals, attributable] = await Promise.all([
      this.dependencies.sessionEvents.sumTokensByModelPerSession({
        tenantIds: query.permittedProjectIds,
        sessionIds: candidates.sessions.map((session) => session.sessionId),
        fromMs: toMs - USAGE_SESSION_WINDOW_MS,
      }),
      this.dependencies.personal.pullRequestsForAttribution({
        organizationId: query.organizationId,
        repositoryHost: target.repositoryHost,
        repositoryFullName: target.repositoryFullName,
        known: [],
        queriedBranches: [],
        sessions: candidates.sessions,
        branches: [target.headBranch],
      }),
    ]);
    const attribution = this.dependencies.shares.attribute({
      sessions: candidates.sessions,
      rowMatchedSessionKeys: candidates.rowMatchedSessionKeys,
      pullRequests: assignablePullRequests(attributable),
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
      rows: this.dependencies.usage.groupedRows({
        sessions: attached,
        costProjects,
        nonBillableAgents,
        projects: query.projects,
      }),
      modelBreakdown: this.dependencies.usage.modelUsage(
        attached,
        attribution.modelTotals,
        costProjects,
      ),
    };
  }
}
