import {
  codingAgentPersonalPullRequestUsageInputSchema,
  codingAgentPersonalPullRequestUsageSchema,
  type CodingAgentContributorProject,
  type CodingAgentPersonalPullRequestUsage,
  type CodingAgentSessionBranchRecord,
} from "@langwatch/coding-agent-contract";
import type { GithubPullRequest, GithubApi } from "@langwatch/github-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  CodingAgentSessionEventRepository,
  SessionModelTotalsRow,
} from "../repositories/coding-agent-session-event.repository.ts";
import {
  assignablePullRequests,
  pullRequestIdentity,
} from "../rules/coding-agent-pull-request.rules.ts";
import type { CodingAgentClock } from "./coding-agent-clock.service.ts";
import type {
  CodingAgentPersonalPullRequestValuesService,
  CodingAgentPersonalRepositoryGroup,
} from "./coding-agent-personal-pull-request-values.service.ts";
import type { CodingAgentPullRequestAssignmentService } from "./coding-agent-pull-request-assignment.service.ts";
import type { CodingAgentPullRequestShareService } from "./coding-agent-pull-request-share.service.ts";
import type { CodingAgentPullRequestUsageService } from "./coding-agent-pull-request-usage.service.ts";
import type { CodingAgentSessionCandidatesService } from "./coding-agent-session-candidates.service.ts";
import type { CodingAgentSessionReadService } from "./coding-agent-session-read.service.ts";

export const USAGE_SESSION_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
export const PERSONAL_SESSION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const PERSONAL_SESSION_LIMIT = 1000;

/** Private owner of the personal page's pull-request reads and the shared attribution set. */
export class CodingAgentPersonalPullRequestReadService {
  static create(options: {
    sessionEvents: CodingAgentSessionEventRepository;
    sessionReads: CodingAgentSessionReadService;
    github: GithubApi;
    projects: ProjectApi;
    clock: CodingAgentClock;
    assignments: CodingAgentPullRequestAssignmentService;
    shares: CodingAgentPullRequestShareService;
    usage: CodingAgentPullRequestUsageService;
    personalValues: CodingAgentPersonalPullRequestValuesService;
    candidates: CodingAgentSessionCandidatesService;
  }): CodingAgentPersonalPullRequestReadService {
    return new CodingAgentPersonalPullRequestReadService(options);
  }

  private constructor(
    private readonly dependencies: {
      sessionEvents: CodingAgentSessionEventRepository;
      sessionReads: CodingAgentSessionReadService;
      github: GithubApi;
      projects: ProjectApi;
      clock: CodingAgentClock;
      assignments: CodingAgentPullRequestAssignmentService;
      shares: CodingAgentPullRequestShareService;
      usage: CodingAgentPullRequestUsageService;
      personalValues: CodingAgentPersonalPullRequestValuesService;
      candidates: CodingAgentSessionCandidatesService;
    },
  ) {}

  async getForPersonalProject(input: {
    projectId: string;
    permittedProjectIds: string[];
    costProjectIds: string[];
    projects: Record<string, CodingAgentContributorProject>;
  }): Promise<CodingAgentPersonalPullRequestUsage> {
    const query = codingAgentPersonalPullRequestUsageInputSchema.parse(input);
    const project = await this.dependencies.projects.findWithTeam(query.projectId);
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

  /**
   * The pull requests the tenure rule needs: `known` (which answers for
   * `queriedBranches`) plus, in one more read, those of every other branch a
   * candidate drove. Both read surfaces must hand the rule the same set.
   */
  async pullRequestsForAttribution({
    organizationId,
    repositoryHost,
    repositoryFullName,
    known,
    queriedBranches,
    sessions,
    branches = [],
  }: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    known: readonly GithubPullRequest[];
    queriedBranches: readonly string[];
    sessions: readonly CodingAgentSessionBranchRecord[];
    branches?: readonly string[];
  }): Promise<GithubPullRequest[]> {
    const queried = new Set(queriedBranches);
    const missing = [
      ...new Set([
        ...branches,
        ...sessions.flatMap((session) => this.dependencies.assignments.branchesOf(session)),
      ]),
    ].filter((branch) => !queried.has(branch));
    if (missing.length === 0) {
      return [...known];
    }

    const fetched = await this.dependencies.github.findAllByBranches({
      organizationId,
      repositoryHost,
      repositoryFullName,
      headBranches: missing,
    });
    const seen = new Set(known.map((pullRequest) => pullRequest.prNumber));
    return [...known, ...fetched.filter((pullRequest) => !seen.has(pullRequest.prNumber))];
  }

  private async personalOrganizationRows(input: {
    group: CodingAgentPersonalRepositoryGroup;
    discovered: readonly GithubPullRequest[];
    pullRequests: readonly GithubPullRequest[];
    /** The branches `pullRequests` already answers for. */
    queriedBranches: readonly string[];
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
    const [modelTotals, attributable] = await Promise.all([
      this.dependencies.sessionEvents.sumTokensByModelPerSession({
        tenantIds: input.query.permittedProjectIds,
        sessionIds: candidates.sessions.map((session) => session.sessionId),
        fromMs: input.toMs - USAGE_SESSION_WINDOW_MS,
      }),
      this.pullRequestsForAttribution({
        organizationId: input.organizationId,
        repositoryHost: input.group.repositoryHost,
        repositoryFullName: input.group.repositoryFullName,
        known: input.pullRequests,
        queriedBranches: input.queriedBranches,
        sessions: candidates.sessions,
      }),
    ]);
    const costProjects = new Set(input.query.costProjectIds);

    return input.discovered.map((pullRequest) =>
      this.personalPullRequestRow({
        pullRequest,
        group: input.group,
        candidates,
        attributable,
        modelTotals,
        costProjects,
        nonBillableAgents,
        projects: input.query.projects,
      }),
    );
  }

  private personalPullRequestRow({
    pullRequest,
    group,
    candidates,
    attributable,
    modelTotals,
    costProjects,
    nonBillableAgents,
    projects,
  }: {
    pullRequest: GithubPullRequest;
    group: CodingAgentPersonalRepositoryGroup;
    candidates: {
      sessions: CodingAgentSessionBranchRecord[];
      rowMatchedSessionKeys: ReadonlySet<string>;
    };
    attributable: GithubPullRequest[];
    modelTotals: readonly SessionModelTotalsRow[];
    costProjects: Set<string>;
    nonBillableAgents: ReadonlySet<string>;
    projects: Record<string, CodingAgentContributorProject>;
  }): unknown {
    const attribution = this.dependencies.shares.attribute({
      sessions: candidates.sessions,
      rowMatchedSessionKeys: candidates.rowMatchedSessionKeys,
      pullRequests: assignablePullRequests(attributable),
      prNumber: pullRequest.prNumber,
      repositoryHost: group.repositoryHost,
      repositoryFullName: group.repositoryFullName,
      modelTotals,
    });
    const attached = attribution.sessions;
    const rows = this.dependencies.usage.groupedRows({
      sessions: attached,
      costProjects,
      nonBillableAgents,
      projects,
    });

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
      contributorsSummary: this.dependencies.usage.contributorsSummary(attached, projects),
    };
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
    const queriedBranches = [...new Set(group.sessions.flatMap((session) => session.headBranches))];
    const pullRequests = await this.dependencies.github.findAllByBranches({
      organizationId,
      repositoryHost: group.repositoryHost,
      repositoryFullName: group.repositoryFullName,
      headBranches: queriedBranches,
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
          queriedBranches,
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
