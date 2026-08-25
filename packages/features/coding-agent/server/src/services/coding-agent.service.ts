import {
  codingAgentRecentSessionsInputSchema,
  codingAgentSessionsListInputSchema,
  codingAgentPullRequestUsageInputSchema,
  codingAgentPersonalPullRequestUsageInputSchema,
  codingAgentPullRequestUsageSchema,
  codingAgentPersonalPullRequestUsageSchema,
  codingAgentPullRequestDetailSchema,
  codingAgentSessionEventsInputSchema,
  codingAgentSessionLookupInputSchema,
  codingAgentTraceSessionLookupInputSchema,
  codingAgentUsageTotalsSchema,
  codingAgentUsageTotalsInputSchema,
  CodingAgentService as CodingAgentServiceContract,
  type CodingAgentRecentSessionsInput,
  type CodingAgentSession,
  type CodingAgentUsageTotals,
  type CodingAgentUsageTotalsInput,
  type CodingAgentContributorProject,
  type CodingAgentPullRequestUsage,
  type CodingAgentPullRequestUsageInput,
  type CodingAgentPersonalPullRequestUsage,
  type CodingAgentPullRequestDetail,
} from "@langwatch/coding-agent-contract";
import {
  GithubPullRequestNotMappedError,
  type GithubPullRequest,
  type GithubService,
} from "@langwatch/github-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { CodingAgentSessionEventRepository } from "../repositories/coding-agent-session-event.repository";
import { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository";
import { CodingAgentTraceSessionRepository } from "../repositories/coding-agent-trace-session.repository";
import {
  SessionMetricSeriesRepository,
  type SessionMetricTotal,
} from "../repositories/session-metric-series.repository";
import type { SessionModelTotalsRow } from "../repositories/coding-agent-session-event.repository";

export const MAX_SESSION_EVENTS_PAGE_SIZE = 1000;
export const CODING_AGENT_SESSION_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSIONS_LIST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSIONS_LIST_LIMIT = 200;
export const USAGE_SESSION_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
export const PERSONAL_SESSION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const PERSONAL_SESSION_LIMIT = 1000;
export const DETAIL_SESSIONS_LIMIT = 50;

/**
 * The one enterprise policy seam this read needs. It is deliberately named at
 * composition: entitlement does not yet publish this capability.
 */
export interface CodingAgentBillingPolicy {
  isSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean>;
}

function readWindowAround(anchorMs: number): { fromMs: number; toMs: number } {
  return {
    fromMs: anchorMs - CODING_AGENT_SESSION_READ_WINDOW_MS,
    toMs: anchorMs + CODING_AGENT_SESSION_READ_WINDOW_MS,
  };
}

function clampSessionEventsLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_SESSION_EVENTS_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SESSION_EVENTS_PAGE_SIZE);
}

/**
 * The canonical coding-agent session aggregate reader. It deliberately owns
 * all four private read models because metric-only overlays and trace/session
 * resolution are one session capability, not callers' composition work.
 */
export class CodingAgentFeatureService extends CodingAgentServiceContract {
  static create(options: {
    sessions: CodingAgentSessionRepository;
    traceSessions: CodingAgentTraceSessionRepository;
    metricSeries: SessionMetricSeriesRepository;
    sessionEvents: CodingAgentSessionEventRepository;
    github: GithubService;
    projects: ProjectService;
    billing: CodingAgentBillingPolicy;
    githubHost?: string;
    now?: () => number;
  }): CodingAgentFeatureService {
    return new CodingAgentFeatureService(options);
  }

  private constructor(
    private readonly repositories: {
      sessions: CodingAgentSessionRepository;
      traceSessions: CodingAgentTraceSessionRepository;
      metricSeries: SessionMetricSeriesRepository;
      sessionEvents: CodingAgentSessionEventRepository;
      github: GithubService;
      projects: ProjectService;
      billing: CodingAgentBillingPolicy;
      githubHost?: string;
      now?: () => number;
    },
  ) {
    super();
  }

  async getSessionEvents(input: {
    projectId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: { timeUnixMs: number; recordId: string };
    limit: number;
  }) {
    const parsed = codingAgentSessionEventsInputSchema.parse(input);
    const limit = clampSessionEventsLimit(parsed.limit);
    const window =
      parsed.occurredAt ??
      (await this.resolveEventsWindow({
        projectId: parsed.projectId,
        sessionId: parsed.sessionId,
      }));
    const page = await this.repositories.sessionEvents.findBySessionId({
      tenantId: parsed.projectId,
      sessionId: parsed.sessionId,
      kinds: parsed.kinds,
      occurredAt: window,
      cursor: parsed.cursor,
      limit,
    });
    const derivedWindow = parsed.occurredAt === undefined ? window : undefined;
    if (page.events.length > 0 || parsed.cursor !== undefined || !derivedWindow) {
      return page;
    }
    return this.repositories.sessionEvents.findBySessionId({
      tenantId: parsed.projectId,
      sessionId: parsed.sessionId,
      kinds: parsed.kinds,
      occurredAt: {
        fromMs: derivedWindow.fromMs,
        toMs: Math.max(Date.now(), derivedWindow.toMs),
      },
      cursor: parsed.cursor,
      limit,
    });
  }

  async tryGetBySessionId(input: {
    projectId: string;
    sessionId: string;
    startedAtMs?: number;
  }): Promise<CodingAgentSession | null> {
    const parsed = codingAgentSessionLookupInputSchema.parse(input);
    const window =
      parsed.startedAtMs === undefined
        ? undefined
        : readWindowAround(parsed.startedAtMs);
    const row =
      (await this.repositories.sessions.findBySessionId({
        tenantId: parsed.projectId,
        sessionId: parsed.sessionId,
        window,
      })) ??
      (window === undefined
        ? null
        : await this.repositories.sessions.findBySessionId({
            tenantId: parsed.projectId,
            sessionId: parsed.sessionId,
          }));
    if (row === null) return null;
    const [overlaid] = await this.withMetricTotals(parsed.projectId, [row]);
    return overlaid ?? row;
  }

  async tryGetSessionForTrace(input: {
    projectId: string;
    traceId: string;
  }): Promise<CodingAgentSession | null> {
    const parsed = codingAgentTraceSessionLookupInputSchema.parse(input);
    const mapping = await this.repositories.traceSessions.findByTraceId({
      tenantId: parsed.projectId,
      traceId: parsed.traceId,
    });
    if (mapping === null) return null;
    return this.tryGetBySessionId({
      projectId: parsed.projectId,
      sessionId: mapping.sessionId,
      startedAtMs: mapping.occurredAtMs,
    });
  }

  async listRecent(input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]> {
    const parsed = codingAgentRecentSessionsInputSchema.parse(input);
    const rows = await this.repositories.sessions.findManyRecent({
      tenantId: parsed.projectId,
      userId: parsed.userId,
      fromMs: parsed.fromMs,
      toMs: parsed.toMs,
      limit: parsed.limit ?? 50,
    });
    return this.withMetricTotals(parsed.projectId, rows, parsed);
  }

  async getUsageTotals(
    input: CodingAgentUsageTotalsInput,
  ): Promise<CodingAgentUsageTotals> {
    const parsed = codingAgentUsageTotalsInputSchema.parse(input);
    const rows = await this.listRecent({ ...parsed, limit: 1000 });
    return codingAgentUsageTotalsSchema.parse(
      rows.reduce<CodingAgentUsageTotals>(
        (totals, row) => ({
          sessionCount: totals.sessionCount + 1,
          costUsd: totals.costUsd + row.costUsd,
          totalTokens:
            totals.totalTokens +
            row.inputTokens +
            row.outputTokens +
            row.cacheReadTokens +
            row.cacheCreationTokens,
          activeTimeSec:
            totals.activeTimeSec + row.activeTimeUserSec + row.activeTimeCliSec,
          linesAdded: totals.linesAdded + row.linesAdded,
          linesRemoved: totals.linesRemoved + row.linesRemoved,
          commits: totals.commits + row.commits,
          pullRequests: totals.pullRequests + row.pullRequests,
        }),
        {
          sessionCount: 0,
          costUsd: 0,
          totalTokens: 0,
          activeTimeSec: 0,
          linesAdded: 0,
          linesRemoved: 0,
          commits: 0,
          pullRequests: 0,
        },
      ),
    );
  }

  async listForProject(input: { projectId: string }) {
    const parsed = codingAgentSessionsListInputSchema.parse(input);
    const toMs = this.repositories.now?.() ?? Date.now();
    const rows = await this.listRecent({
      projectId: parsed.projectId,
      fromMs: toMs - SESSIONS_LIST_WINDOW_MS,
      toMs,
      limit: SESSIONS_LIST_LIMIT,
    });
    const pullRequests = await this.pullRequestsForList(parsed.projectId, rows);
    return rows.map((row) => ({
      sessionId: row.sessionId,
      title: row.title === "" ? null : row.title,
      agent: row.agent,
      agentVersion: row.agentVersion,
      repositoryHost: row.repositoryHost,
      repositoryOwner: row.repositoryOwner,
      repositoryName: row.repositoryName,
      gitBranch: row.gitBranch,
      gitBranches: branchesOf(row),
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
      totals: usageTotals(gathered.rows),
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
      pullRequest: { ...pullRequestIdentity(gathered.target), title: gathered.target.title },
      totals: usageTotals(gathered.rows),
      contributors: gathered.rows,
      modelBreakdown: gathered.modelBreakdown,
      sessions: [...gathered.sessions]
        .sort((a, b) => b.startedAtMs - a.startedAtMs)
        .slice(0, DETAIL_SESSIONS_LIMIT)
        .map((session) => ({
          sessionId: session.sessionId,
          startedAtMs: session.startedAtMs,
          ...contributorFor(session.tenantId, query.projects),
          agent: session.agent,
          totalTokens: tokenTotal(session),
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
    const project = await this.repositories.projects.tryGetWithTeam(query.projectId);
    if (project === null) {
      return codingAgentPersonalPullRequestUsageSchema.parse({ rows: [], unlinked: [] });
    }
    const organizationId = project.team.organizationId;
    const toMs = this.repositories.now?.() ?? Date.now();
    const personalSessions = await this.listRecent({
      projectId: query.projectId,
      fromMs: toMs - PERSONAL_SESSION_WINDOW_MS,
      toMs,
      limit: PERSONAL_SESSION_LIMIT,
    });
    const groups = personalRepositoryGroups(personalSessions, this.githubHost());
    const rows: unknown[] = [];
    const unlinked: unknown[] = [];
    const nonBillableAgents = await this.nonBillableAgents(
      organizationId,
      personalSessions.map((session) => session.agent),
    );
    for (const group of groups) {
      const pullRequests = await this.repositories.github.findAllByBranches({
        organizationId,
        repositoryHost: group.repositoryHost,
        repositoryFullName: group.repositoryFullName,
        headBranches: [...new Set(group.sessions.flatMap((session) => session.headBranches))],
      });
      const assignments = assignmentFor(
        group.sessions.map((session) => ({
          sessionId: session.sessionId,
          startedAtMs: session.startedAtMs,
          gitBranch: session.headBranch,
          gitBranches: session.headBranches,
        })),
        pullRequests,
      );
      const discovered = pullRequests.filter((pullRequest) =>
        group.sessions.some((session) => assignments.get(session.sessionId) === pullRequest.prNumber),
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
      const repoCovered = await this.repositories.github.coversRepository({
        organizationId,
        repositoryFullName: group.repositoryFullName,
      });
      unlinked.push(...unlinkedRows(group, unmatched, repoCovered, nonBillableAgents));
    }
    return codingAgentPersonalPullRequestUsageSchema.parse({ rows, unlinked });
  }

  private async pullRequestsForList(
    projectId: string,
    rows: CodingAgentSession[],
  ): Promise<Map<string, Array<{ number: number; url: string; title: string }>>> {
    const drives = listBranchDrives(rows, this.githubHost());
    if (drives.length === 0) return new Map();
    try {
      const project = await this.repositories.projects.tryGetWithTeam(projectId);
      if (project === null) return new Map();
      const organizationId = project.team.organizationId;
      const candidates = await this.repositories.github.findForBranches({
        organizationId,
        keys: uniqueBranchKeys(drives),
      });
      return linkedListPullRequests(drives, candidates);
    } catch {
      // The legacy screen intentionally treats GitHub enrichment as best effort.
      return new Map();
    }
  }

  private async gatherPullRequest(query: CodingAgentPullRequestUsageInput): Promise<{
    target: GithubPullRequest;
    sessions: CodingAgentSession[];
    rows: UsageRow[];
    modelBreakdown: ModelUsage[];
  }> {
    const target = await this.repositories.github.tryFindByNumber({
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
    const siblings = await this.repositories.github.findAllByBranches({
      organizationId: query.organizationId,
      repositoryHost: target.repositoryHost,
      repositoryFullName: target.repositoryFullName,
      headBranches: [target.headBranch],
    });
    const [repositoryOwner, repositoryName] = target.repositoryFullName.split("/");
    if (!repositoryOwner || !repositoryName) {
      return { target, sessions: [], rows: [], modelBreakdown: [] };
    }
    const toMs = this.repositories.now?.() ?? Date.now();
    const sessions = await this.repositories.sessions.listByRepositoryBranch({
      tenantIds: query.permittedProjectIds,
      repositoryHost: target.repositoryHost,
      repositoryOwner,
      repositoryName,
      branches: [target.headBranch],
      startedAtFromMs: toMs - USAGE_SESSION_WINDOW_MS,
    });
    const attached = attachedSessions(sessions, siblings, target.prNumber);
    const costProjects = new Set(query.costProjectIds);
    const nonBillableAgents = await this.nonBillableAgents(
      query.organizationId,
      attached.map((session) => session.agent),
    );
    const modelTotals = await this.repositories.sessionEvents.sumTokensByModelPerSession({
      tenantIds: query.permittedProjectIds,
      sessionIds: attached.map((session) => session.sessionId),
      fromMs: toMs - USAGE_SESSION_WINDOW_MS,
    });
    return {
      target,
      sessions: attached,
      rows: groupedUsageRows(attached, costProjects, nonBillableAgents, query.projects),
      modelBreakdown: modelUsage(attached, modelTotals, costProjects),
    };
  }

  private async personalOrganizationRows(input: {
    group: PersonalRepositoryGroup;
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
    const sessions = await this.repositories.sessions.listByRepositoryBranch({
      tenantIds: input.query.permittedProjectIds,
      repositoryHost: input.group.repositoryHost,
      repositoryOwner,
      repositoryName,
      branches: [...new Set(input.discovered.map((pullRequest) => pullRequest.headBranch))],
      startedAtFromMs: input.toMs - USAGE_SESSION_WINDOW_MS,
    });
    const assignments = assignmentFor(sessions, input.pullRequests);
    const nonBillableAgents = await this.nonBillableAgents(
      input.organizationId,
      sessions.map((session) => session.agent),
    );
    const modelTotals = await this.repositories.sessionEvents.sumTokensByModelPerSession({
      tenantIds: input.query.permittedProjectIds,
      sessionIds: sessions.map((session) => session.sessionId),
      fromMs: input.toMs - USAGE_SESSION_WINDOW_MS,
    });
    const costProjects = new Set(input.query.costProjectIds);
    return input.discovered.map((pullRequest) => {
      const attached = sessions.filter((session) => assignments.get(session.sessionId) === pullRequest.prNumber);
      const rows = groupedUsageRows(attached, costProjects, nonBillableAgents, input.query.projects);
      const totals = usageTotals(rows);
      return {
        ...pullRequestIdentity(pullRequest),
        title: pullRequest.title,
        lastActivityAtMs: latestActivity(attached),
        ...totals,
        modelBreakdown: modelUsage(attached, modelTotals, costProjects),
        contributorsSummary: contributorsSummary(attached, input.query.projects),
      };
    });
  }

  private async nonBillableAgents(
    organizationId: string,
    agents: string[],
  ): Promise<ReadonlySet<string>> {
    const distinct = [...new Set(agents.filter((agent) => agent !== ""))];
    const answers = await Promise.all(
      distinct.map(async (agent) => ({
        agent,
        nonBillable: await this.repositories.billing.isSourceNonBillable({
          organizationId,
          sourceType: ingestSourceType(agent),
        }),
      })),
    );
    return new Set(answers.filter((answer) => answer.nonBillable).map((answer) => answer.agent));
  }

  private githubHost(): string {
    const host = this.repositories.githubHost?.trim().toLowerCase();
    return host === undefined || host === "" ? "github.com" : host;
  }

  private async resolveEventsWindow(input: {
    projectId: string;
    sessionId: string;
  }): Promise<{ fromMs: number; toMs: number } | undefined> {
    const row = await this.repositories.sessions.findBySessionId({
      tenantId: input.projectId,
      sessionId: input.sessionId,
    });
    return row === null ? undefined : readWindowAround(row.startedAtMs);
  }

  private async withMetricTotals(
    projectId: string,
    rows: CodingAgentSession[],
    range?: { fromMs: number; toMs: number },
  ): Promise<CodingAgentSession[]> {
    const needy = rows.filter(
      (row) => row.costUsd === 0 || row.inputTokens + row.outputTokens === 0,
    );
    if (needy.length === 0) return rows;
    const startedAts = needy.map((row) => row.startedAtMs).filter((ms) => ms > 0);
    const fromMs =
      (range?.fromMs ?? (startedAts.length > 0 ? Math.min(...startedAts) : Date.now())) -
      60 * 60 * 1000;
    const toMs =
      (range?.toMs ?? (startedAts.length > 0 ? Math.max(...startedAts) : Date.now())) +
      7 * 24 * 60 * 60 * 1000;
    let totals: SessionMetricTotal[];
    try {
      totals = await this.repositories.metricSeries.findTotalsBySessionIds({
        tenantId: projectId,
        sessionIds: needy.map((row) => row.sessionId),
        fromMs,
        toMs,
      });
    } catch {
      return rows;
    }
    if (totals.length === 0) return rows;
    const bySession = new Map<string, SessionMetricTotal[]>();
    for (const total of totals) {
      const sessionTotals = bySession.get(total.sessionId) ?? [];
      sessionTotals.push(total);
      bySession.set(total.sessionId, sessionTotals);
    }
    return rows.map((row) => {
      const totals = bySession.get(row.sessionId);
      if (totals === undefined) return row;
      const filled = foldTokenAndCostTotals(totals);
      return {
        ...row,
        costUsd: row.costUsd || filled.costUsd,
        inputTokens: row.inputTokens || filled.inputTokens,
        outputTokens: row.outputTokens || filled.outputTokens,
        cacheReadTokens: row.cacheReadTokens || filled.cacheReadTokens,
        cacheCreationTokens: row.cacheCreationTokens || filled.cacheCreationTokens,
      };
    });
  }
}

function foldTokenAndCostTotals(totals: SessionMetricTotal[]) {
  const folded = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  for (const total of totals) {
    const metric = normalizeMetricName(total.metricName);
    if (metric === "cost_usage") {
      folded.costUsd += total.total;
      continue;
    }
    if (metric !== "token_usage") continue;
    switch (normalizeTokenType(total.bucket)) {
      case "input":
        folded.inputTokens += total.total;
        break;
      case "output":
        folded.outputTokens += total.total;
        break;
      case "cache_read":
        folded.cacheReadTokens += total.total;
        break;
      case "cache_creation":
        folded.cacheCreationTokens += total.total;
        break;
    }
  }
  return folded;
}

function normalizeMetricName(raw: string): "token_usage" | "cost_usage" | null {
  const name = raw.replace(
    /^(claude_code|claude_cowork|cowork|opencode|codex|gemini_cli|github\.copilot|copilot)\./,
    "",
  );
  if (name === "token.usage" || name === "turn.token_usage") return "token_usage";
  if (name === "cost.usage") return "cost_usage";
  return null;
}

function normalizeTokenType(raw: string):
  | "input"
  | "output"
  | "cache_read"
  | "cache_creation"
  | null {
  switch (raw.replace(/[_-]/g, "").toLowerCase()) {
    case "input":
    case "prompt":
    case "noncachedinput":
      return "input";
    case "output":
    case "completion":
      return "output";
    case "cacheread":
    case "cachedinput":
    case "cachereadinput":
    case "cache":
      return "cache_read";
    case "cachecreation":
    case "cachewrite":
    case "cachecreationinput":
      return "cache_creation";
    default:
      return null;
  }
}

type UsageRow = {
  projectId: string;
  projectSlug: string;
  contributorLabel: string;
  contributorIsProject: boolean;
  agent: string;
  models: string[];
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
  billedCostUsd: number | null;
  nonBilledCostUsd: number | null;
};

type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
  tokensKnown: boolean;
};

type UsageTotals = {
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
  billedCostUsd: number | null;
  nonBilledCostUsd: number | null;
};

function branchesOf(session: { gitBranch: string; gitBranches: readonly string[] }): string[] {
  return session.gitBranches.length > 0
    ? [...session.gitBranches]
    : session.gitBranch === "" ? [] : [session.gitBranch];
}

function assignable(pullRequests: readonly GithubPullRequest[]) {
  return pullRequests.map((pullRequest) => ({
    prNumber: pullRequest.prNumber,
    headBranch: pullRequest.headBranch,
    prCreatedAtMs: pullRequest.prCreatedAt.getTime(),
    prClosedAtMs: pullRequest.prClosedAt?.getTime() ?? null,
    prMergedAtMs: pullRequest.prMergedAt?.getTime() ?? null,
  }));
}

function assignmentFor(
  sessions: readonly { sessionId: string; startedAtMs: number; gitBranch: string; gitBranches: readonly string[] }[],
  pullRequests: readonly GithubPullRequest[],
): Map<string, number> {
  const byBranch = new Map<string, ReturnType<typeof assignable>>();
  for (const pullRequest of assignable(pullRequests)) {
    const list = byBranch.get(pullRequest.headBranch) ?? [];
    list.push(pullRequest);
    byBranch.set(pullRequest.headBranch, list);
  }
  for (const list of byBranch.values()) {
    list.sort((a, b) => a.prCreatedAtMs - b.prCreatedAtMs || a.prNumber - b.prNumber);
  }
  const assignments = new Map<string, number>();
  for (const session of sessions) {
    let winner: ReturnType<typeof assignable>[number] | undefined;
    for (const branch of branchesOf(session)) {
      const matched = byBranch.get(branch)?.find((pullRequest) =>
        (pullRequest.prClosedAtMs ?? pullRequest.prMergedAtMs ?? Number.POSITIVE_INFINITY) >= session.startedAtMs,
      );
      if (
        matched &&
        (!winner || matched.prCreatedAtMs < winner.prCreatedAtMs ||
          (matched.prCreatedAtMs === winner.prCreatedAtMs && matched.prNumber < winner.prNumber))
      ) winner = matched;
    }
    if (winner) assignments.set(session.sessionId, winner.prNumber);
  }
  return assignments;
}

function attachedSessions(
  sessions: CodingAgentSession[],
  pullRequests: readonly GithubPullRequest[],
  prNumber: number,
): CodingAgentSession[] {
  const assignments = assignmentFor(sessions, pullRequests);
  return sessions.filter((session) => assignments.get(session.sessionId) === prNumber);
}

function ingestSourceType(agent: string): string {
  if (agent === "gemini_cli") return "gemini";
  if (agent === "copilot") return "github_copilot";
  return agent;
}

function contributorFor(
  projectId: string,
  projects: Record<string, CodingAgentContributorProject>,
) {
  const project = projects[projectId];
  return {
    projectId,
    projectSlug: project?.slug ?? "",
    contributorLabel: project?.contributorLabel ?? projectId,
    contributorIsProject: project?.isLinkable ?? false,
  };
}

function tokenTotal(row: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheCreationTokens;
}

function groupedUsageRows(
  sessions: readonly CodingAgentSession[],
  costProjects: ReadonlySet<string>,
  nonBillableAgents: ReadonlySet<string>,
  projects: Record<string, CodingAgentContributorProject>,
): UsageRow[] {
  const grouped = new Map<string, UsageRow & { modelSet: Set<string> }>();
  for (const session of sessions) {
    const key = `${session.tenantId}\0${session.agent}`;
    const priced = costProjects.has(session.tenantId);
    const nonBilled = nonBillableAgents.has(session.agent);
    const row = grouped.get(key);
    if (!row) {
      grouped.set(key, {
        ...contributorFor(session.tenantId, projects),
        agent: session.agent,
        models: [],
        modelSet: new Set(session.models),
        sessionsCount: 1,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheCreationTokens: session.cacheCreationTokens,
        totalTokens: tokenTotal(session),
        costUsd: priced ? session.costUsd : null,
        billedCostUsd: priced ? (nonBilled ? 0 : session.costUsd) : null,
        nonBilledCostUsd: priced ? (nonBilled ? session.costUsd : 0) : null,
      });
      continue;
    }
    row.sessionsCount += 1;
    row.inputTokens += session.inputTokens;
    row.outputTokens += session.outputTokens;
    row.cacheReadTokens += session.cacheReadTokens;
    row.cacheCreationTokens += session.cacheCreationTokens;
    row.totalTokens += tokenTotal(session);
    if (priced) {
      row.costUsd = (row.costUsd ?? 0) + session.costUsd;
      row.billedCostUsd = (row.billedCostUsd ?? 0) + (nonBilled ? 0 : session.costUsd);
      row.nonBilledCostUsd = (row.nonBilledCostUsd ?? 0) + (nonBilled ? session.costUsd : 0);
    }
    for (const model of session.models) row.modelSet.add(model);
  }
  return [...grouped.values()].map(({ modelSet, ...row }) => ({ ...row, models: [...modelSet].sort() }));
}

function usageTotals(rows: readonly UsageRow[]): UsageTotals {
  const empty: UsageTotals = {
    sessionsCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costUsd: null,
    billedCostUsd: null,
    nonBilledCostUsd: null,
  };
  return rows.reduce<UsageTotals>(
    (totals, row) => ({
      sessionsCount: totals.sessionsCount + row.sessionsCount,
      inputTokens: totals.inputTokens + row.inputTokens,
      outputTokens: totals.outputTokens + row.outputTokens,
      cacheReadTokens: totals.cacheReadTokens + row.cacheReadTokens,
      cacheCreationTokens: totals.cacheCreationTokens + row.cacheCreationTokens,
      totalTokens: totals.totalTokens + row.totalTokens,
      costUsd: row.costUsd === null ? totals.costUsd : (totals.costUsd ?? 0) + row.costUsd,
      billedCostUsd: row.billedCostUsd === null ? totals.billedCostUsd : (totals.billedCostUsd ?? 0) + row.billedCostUsd,
      nonBilledCostUsd: row.nonBilledCostUsd === null ? totals.nonBilledCostUsd : (totals.nonBilledCostUsd ?? 0) + row.nonBilledCostUsd,
    }),
    empty,
  );
}

function modelUsage(
  sessions: readonly CodingAgentSession[],
  totals: readonly SessionModelTotalsRow[],
  costProjects: ReadonlySet<string>,
): ModelUsage[] {
  const attached = new Set(sessions.map((session) => `${session.tenantId}\0${session.sessionId}`));
  const byModel = new Map<string, ModelUsage>();
  for (const total of totals) {
    if (!attached.has(`${total.tenantId}\0${total.sessionId}`) || total.model === "") continue;
    const existing = byModel.get(total.model) ?? {
      model: total.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheCreationTokens: 0, totalTokens: 0, costUsd: null, tokensKnown: true,
    };
    existing.inputTokens += total.inputTokens;
    existing.outputTokens += total.outputTokens;
    existing.cacheReadTokens += total.cacheReadTokens;
    existing.cacheCreationTokens += total.cacheCreationTokens;
    existing.totalTokens += tokenTotal(total);
    if (costProjects.has(total.tenantId)) existing.costUsd = (existing.costUsd ?? 0) + total.costUsd;
    byModel.set(total.model, existing);
  }
  if (byModel.size > 0) return [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  const models = new Set<string>();
  for (const session of sessions) for (const model of session.models) if (model !== "") models.add(model);
  return [...models].sort().map((model) => ({
    model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, totalTokens: 0, costUsd: null, tokensKnown: false,
  }));
}

function pullRequestIdentity(pullRequest: GithubPullRequest) {
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

function latestActivity(sessions: readonly CodingAgentSession[]): number {
  return sessions.reduce((latest, session) =>
    Math.max(latest, Math.max(session.startedAtMs, session.lastEventOccurredAt || 0)), 0);
}

function contributorsSummary(
  sessions: readonly CodingAgentSession[],
  projects: Record<string, CodingAgentContributorProject>,
) {
  const grouped = new Map<string, ReturnType<typeof contributorFor> & { sessionsCount: number }>();
  for (const session of sessions) {
    const current = grouped.get(session.tenantId);
    if (current) current.sessionsCount += 1;
    else grouped.set(session.tenantId, { ...contributorFor(session.tenantId, projects), sessionsCount: 1 });
  }
  return [...grouped.values()].sort((a, b) => b.sessionsCount - a.sessionsCount);
}

type PersonalSession = {
  sessionId: string;
  startedAtMs: number;
  lastEventOccurredAtMs: number;
  agent: string;
  headBranch: string;
  headBranches: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  models: string[];
};

type PersonalRepositoryGroup = {
  repositoryHost: string;
  repositoryFullName: string;
  sessions: PersonalSession[];
};

function personalRepositoryGroups(
  sessions: readonly CodingAgentSession[],
  configuredGithubHost: string,
): PersonalRepositoryGroup[] {
  const groups = new Map<string, PersonalRepositoryGroup>();
  for (const session of sessions) {
    if (!session.repositoryOwner || !session.repositoryName || !session.gitBranch) continue;
    const repositoryHost = normalizeGithubHost(session.repositoryHost, configuredGithubHost);
    const repositoryFullName = `${session.repositoryOwner}/${session.repositoryName}`.toLowerCase();
    const key = `${repositoryHost} ${repositoryFullName}`;
    const group = groups.get(key) ?? { repositoryHost, repositoryFullName, sessions: [] };
    group.sessions.push({
      sessionId: session.sessionId,
      startedAtMs: session.startedAtMs,
      lastEventOccurredAtMs: session.lastEventOccurredAt,
      agent: session.agent,
      headBranch: session.gitBranch,
      headBranches: branchesOf(session),
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      cacheReadTokens: session.cacheReadTokens,
      cacheCreationTokens: session.cacheCreationTokens,
      costUsd: session.costUsd,
      models: session.models,
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

function unlinkedRows(
  group: PersonalRepositoryGroup,
  sessions: readonly PersonalSession[],
  repoCovered: boolean,
  nonBillableAgents: ReadonlySet<string>,
) {
  const byBranch = new Map<string, PersonalSession[]>();
  for (const session of sessions) {
    const rows = byBranch.get(session.headBranch) ?? [];
    rows.push(session);
    byBranch.set(session.headBranch, rows);
  }
  return [...byBranch.entries()].map(([headBranch, branchSessions]) => ({
    repositoryHost: group.repositoryHost,
    repositoryFullName: group.repositoryFullName,
    headBranch,
    lastActivityAtMs: branchSessions.reduce((latest, session) =>
      Math.max(latest, Math.max(session.startedAtMs, session.lastEventOccurredAtMs || 0)), 0),
    sessionsCount: branchSessions.length,
    totalTokens: branchSessions.reduce((total, session) => total + tokenTotal(session), 0),
    modelBreakdown: namedModels(branchSessions),
    costUsd: branchSessions.reduce((total, session) => total + session.costUsd, 0),
    billedCostUsd: branchSessions.filter((session) => !nonBillableAgents.has(session.agent)).reduce((total, session) => total + session.costUsd, 0),
    nonBilledCostUsd: branchSessions.filter((session) => nonBillableAgents.has(session.agent)).reduce((total, session) => total + session.costUsd, 0),
    repoCovered,
  }));
}

function namedModels(sessions: readonly { models: string[] }[]): ModelUsage[] {
  const models = new Set<string>();
  for (const session of sessions) for (const model of session.models) if (model !== "") models.add(model);
  return [...models].sort().map((model) => ({
    model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, totalTokens: 0, costUsd: null, tokensKnown: false,
  }));
}

type ListBranchDrive = {
  sessionId: string;
  startedAtMs: number;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
};

function normalizeGithubHost(host: string, configuredGithubHost: string): string {
  return host === "" ? configuredGithubHost : host.toLowerCase();
}

function listBranchDrives(sessions: readonly CodingAgentSession[], configuredGithubHost: string): ListBranchDrive[] {
  const drives: ListBranchDrive[] = [];
  for (const session of sessions) {
    if (!session.repositoryOwner || !session.repositoryName) continue;
    for (const headBranch of branchesOf(session)) drives.push({
      sessionId: session.sessionId,
      startedAtMs: session.startedAtMs,
      repositoryHost: normalizeGithubHost(session.repositoryHost, configuredGithubHost),
      repositoryFullName: `${session.repositoryOwner}/${session.repositoryName}`.toLowerCase(),
      headBranch,
    });
  }
  return drives;
}

function uniqueBranchKeys(drives: readonly ListBranchDrive[]) {
  const keys = new Map<string, { repositoryHost: string; repositoryFullName: string; headBranch: string }>();
  for (const drive of drives) keys.set(`${drive.repositoryHost} ${drive.repositoryFullName} ${drive.headBranch}`, {
    repositoryHost: drive.repositoryHost, repositoryFullName: drive.repositoryFullName, headBranch: drive.headBranch,
  });
  return [...keys.values()];
}

function linkedListPullRequests(
  drives: readonly ListBranchDrive[],
  candidates: readonly GithubPullRequest[],
): Map<string, Array<{ number: number; url: string; title: string }>> {
  const found = new Map<string, Map<number, { number: number; url: string; title: string }>>();
  const byRepository = new Map<string, ListBranchDrive[]>();
  for (const drive of drives) {
    const key = `${drive.repositoryHost.toLowerCase()} ${drive.repositoryFullName.toLowerCase()}`;
    const bucket = byRepository.get(key) ?? [];
    bucket.push(drive);
    byRepository.set(key, bucket);
  }
  for (const [bucket, bucketDrives] of byRepository) {
    const bucketCandidates = candidates.filter((candidate) =>
      `${candidate.repositoryHost.toLowerCase()} ${candidate.repositoryFullName.toLowerCase()}` === bucket);
    const assignments = assignmentFor(
      bucketDrives.map((drive) => ({
        sessionId: `${drive.sessionId}\0${drive.headBranch}`,
        startedAtMs: drive.startedAtMs,
        gitBranch: drive.headBranch,
        gitBranches: [drive.headBranch],
      })),
      bucketCandidates,
    );
    for (const drive of bucketDrives) {
      const candidate = bucketCandidates.find((row) =>
        row.prNumber === assignments.get(`${drive.sessionId}\0${drive.headBranch}`));
      if (!candidate) continue;
      const rows = found.get(drive.sessionId) ?? new Map();
      rows.set(candidate.prNumber, { number: candidate.prNumber, url: candidate.htmlUrl, title: candidate.title });
      found.set(drive.sessionId, rows);
    }
  }
  return new Map([...found].map(([sessionId, rows]) =>
    [sessionId, [...rows.values()].sort((a, b) => a.number - b.number)]));
}
