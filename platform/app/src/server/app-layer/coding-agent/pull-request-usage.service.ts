/**
 * What a pull request cost in assistant usage.
 *
 * Organization first: a pull request is worked on by whoever the organization
 * put on it, and their sessions land in whichever projects they use, so the
 * rollup reads across projects and the CALLER's permissions decide which of
 * them appear. Two permissions, two separate cuts: `traces:view` decides
 * whether a project's rows appear at all, `cost:view` decides whether those
 * rows carry money. A project the caller may read but not price returns tokens
 * with a null cost rather than being dropped, because the work happened and
 * hiding it would understate the pull request.
 *
 * The personal page asks a personal question, which pull requests did MY work
 * touch, and answers it with the organization's numbers. Discovery is the
 * caller's own project; the figures on each discovered row come from every
 * project the caller may read. Branch rollups with no pull request stay
 * personal: an unopened branch is one person's work in progress.
 *
 * Cost arrives as one flat list price per session and is split at read time
 * into what was actually billed and what a bundled plan already covered, from
 * the same policy the ingestion receiver applies. The split is per agent and
 * all or nothing: a session's cost is either real spend or theoretical.
 *
 * Numbers and names only. The rows carry counts, token buckets, an agent name,
 * a model list and the agent-reported user id — no session title, no prompt,
 * no file list. That is enforced by the ClickHouse read selecting only those
 * columns, and pinned by a test over the response's own keys.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import { GithubPullRequestNotMappedError } from "../github/errors";
import type {
  GithubPullRequestRow,
  GithubPullRequestsRepository,
} from "../github/repositories/github-pull-requests.repository";
import { ingestSourceTypeOfAgent } from "./coding-agent-source-type";
import { assignSessionsToPullRequests } from "./pull-request-assignment";
import type {
  CodingAgentBranchSessionRow,
  CodingAgentSessionRepository,
} from "./repositories/coding-agent-session.repository";
import type { SessionModelTotalsRow } from "./repositories/coding-agent-session-events.repository";

/**
 * How far back the session read looks.
 *
 * `StartedAt` is the partition key, so this bound is what keeps the read off
 * every partition the retention holds. Half a year comfortably covers a pull
 * request's life — including the long-lived ones that sit open for months —
 * and a session older than that predates any pull request still worth pricing.
 * A pull request whose first session is older simply reports from this bound
 * on, which is a visible undercount rather than a silent full-table scan.
 */
export const USAGE_SESSION_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

/** How far back the personal page looks for a project's own branches. */
export const PERSONAL_SESSION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Sessions read for the personal page. */
const PERSONAL_SESSION_LIMIT = 1000;

/** Sessions listed on a pull request's detail, most recent first. */
export const DETAIL_SESSIONS_LIMIT = 50;

/**
 * Wall clock in milliseconds, read off the injected deps.
 *
 * A free function, and never a method or a function-valued field on the
 * service, because the service is published through `traced()` — a Proxy that
 * wraps every function it hands out in `withActiveSpan`. Anything reached as
 * `this.<something>()` therefore comes back as a Promise, and a Promise minus
 * a number is NaN, which reaches ClickHouse as a query parameter and fails the
 * whole read. `this.deps` is a plain object the Proxy passes through, so
 * reading the clock from it keeps a number a number.
 */
function nowMs(deps: { now?: () => number }): number {
  return deps.now?.() ?? Date.now();
}

/** The pull request itself: identity and lifetime, never its body. */
export interface PullRequestIdentity {
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
  headBranch: string;
  htmlUrl: string;
  state: string;
  isDraft: boolean;
  authorLogin: string | null;
  prCreatedAtMs: number;
  prClosedAtMs: number | null;
  prMergedAtMs: number | null;
}

/**
 * Cost as three numbers rather than one: what a bundled plan already covered,
 * what was genuinely billed per token, and the list-price total of both.
 *
 * All three are null together, for a project the caller may read but not
 * price. Reporting a zero there would read as "this cost nothing", which is a
 * different and wrong claim.
 */
export interface CostSplit {
  /** The grand list-price total: billed plus not billed. */
  costUsd: number | null;
  /** Cost actually billed per token. */
  billedCostUsd: number | null;
  /** Cost a bundled subscription already covered. */
  nonBilledCostUsd: number | null;
}

/** What one model consumed and cost, within one pull request. */
export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  /** Null when no project contributing this model may be priced. */
  costUsd: number | null;
}

/** One (project, user, agent) group's contribution to a pull request. */
export interface PullRequestUsageRow extends CostSplit {
  projectId: string;
  /** The agent's reported identity, blank when the agent reported none. */
  userLabel: string;
  agent: string;
  models: string[];
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface PullRequestUsageTotals extends CostSplit {
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface PullRequestUsage {
  pullRequest: PullRequestIdentity;
  rows: PullRequestUsageRow[];
  totals: PullRequestUsageTotals;
  modelBreakdown: ModelUsage[];
}

/** Who worked on a pull request, as a row's compact summary line. */
export interface ContributorSummary {
  /** The agent's reported identity, blank when the agent reported none. */
  userLabel: string;
  projectName: string;
  sessionsCount: number;
}

/** One mapped pull request as the personal page lists it. */
export interface PersonalPullRequestRow extends PullRequestIdentity, CostSplit {
  /** The pull request's own GitHub title, from the stored snapshot. */
  title: string;
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  modelBreakdown: ModelUsage[];
  contributorsSummary: ContributorSummary[];
}

/** A branch whose sessions attach to no pull request. */
export interface UnlinkedBranchRollup extends CostSplit {
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  sessionsCount: number;
  totalTokens: number;
  /** Whether the organization's connection reaches this repository at all. */
  repoCovered: boolean;
}

export interface PersonalPullRequestUsage {
  rows: PersonalPullRequestRow[];
  unlinked: UnlinkedBranchRollup[];
}

/** One contributor's line on the pull request detail. */
export interface PullRequestContributorRow extends PullRequestUsageRow {
  projectName: string;
}

/**
 * One session as the detail lists it: FACTS ONLY.
 *
 * There is deliberately no title and no content here. A session's title is
 * derived content and is gated behind the content permissions on the session
 * surfaces; this payload answers "what did this pull request consume", which
 * needs none of it. A test pins this row's key set so a title cannot be added
 * without somebody deciding to disclose it.
 */
export interface PullRequestSessionFact {
  sessionId: string;
  startedAtMs: number;
  /** The agent's reported identity, blank when the agent reported none. */
  userLabel: string;
  projectName: string;
  agent: string;
  totalTokens: number;
  costUsd: number | null;
}

export interface PullRequestDetail {
  pullRequest: PullRequestIdentity & { title: string };
  totals: PullRequestUsageTotals;
  contributors: PullRequestContributorRow[];
  modelBreakdown: ModelUsage[];
  sessions: PullRequestSessionFact[];
}

/** Whether the organization's connection covers a repository. */
export interface RepositoryCoverageLookup {
  coversRepository(params: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<boolean>;
}

/** The project's own sessions, for the personal page's starting set. */
export interface PersonalSessionLookup {
  listRecent(args: {
    projectId: string;
    fromMs: number;
    toMs: number;
    limit?: number;
  }): Promise<
    Array<{
      sessionId: string;
      startedAtMs: number;
      agent: string;
      repositoryHost: string;
      repositoryOwner: string;
      repositoryName: string;
      gitBranch: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      costUsd: number;
    }>
  >;
}

/** What each model consumed, per session, across the permitted projects. */
export interface SessionModelTotalsLookup {
  sumTokensByModelPerSession(params: {
    tenantIds: string[];
    sessionIds: string[];
    fromMs: number;
  }): Promise<SessionModelTotalsRow[]>;
}

export interface PullRequestUsageServiceDeps {
  pullRequests: GithubPullRequestsRepository;
  sessions: Pick<CodingAgentSessionRepository, "listByRepositoryBranch">;
  personalSessions: PersonalSessionLookup;
  sessionEvents: SessionModelTotalsLookup;
  installations: RepositoryCoverageLookup;
  resolveOrganizationId(projectId: string): Promise<string | undefined>;
  /**
   * Whether a tool's usage rides a bundled subscription rather than being
   * billed per token. Injected because the policy behind it is an enterprise
   * concern; the composition root supplies the real one and a preset without
   * it answers "billed", which is the conservative reading of a cost.
   */
  isSourceNonBillable(params: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean>;
  now?: () => number;
}

/** The caller's permission cut, resolved server-side, never from the request. */
export interface CallerScope {
  /** Projects the caller may read. Rows outside it never appear. */
  permittedProjectIds: string[];
  /** The subset of those the caller may also price. */
  costProjectIds: string[];
}

export interface PullRequestUsageQuery extends CallerScope {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
}

export interface PullRequestDetailQuery extends PullRequestUsageQuery {
  /** Display names of the permitted projects, keyed by project id. */
  projectNames: Record<string, string>;
}

export interface PersonalPullRequestUsageQuery extends CallerScope {
  projectId: string;
  /** Display names of the permitted projects, keyed by project id. */
  projectNames: Record<string, string>;
}

export class PullRequestUsageService {
  private readonly deps: PullRequestUsageServiceDeps;

  constructor(deps: PullRequestUsageServiceDeps) {
    this.deps = deps;
  }

  /**
   * What one pull request cost, across every project the caller may read.
   *
   * Throws {@link GithubPullRequestNotMappedError} when no mapping exists: the
   * honest answer is "we do not know this pull request", and a zeroed rollup
   * would read as "it cost nothing", which is a different and wrong claim.
   */
  async getPullRequestUsage(
    query: PullRequestUsageQuery,
  ): Promise<PullRequestUsage> {
    const gathered = await this.gatherPullRequest(query);
    return {
      pullRequest: toIdentity(gathered.target),
      rows: gathered.rows,
      totals: totalsOf(gathered.rows),
      modelBreakdown: gathered.modelBreakdown,
    };
  }

  /**
   * The same pull request, plus who worked on it and which sessions ran, for
   * the detail surface. Facts only: see {@link PullRequestSessionFact}.
   */
  async getPullRequestDetail(
    query: PullRequestDetailQuery,
  ): Promise<PullRequestDetail> {
    const gathered = await this.gatherPullRequest(query);
    const nameOf = (projectId: string) =>
      query.projectNames[projectId] ?? projectId;
    const costProjects = new Set(query.costProjectIds);

    return {
      pullRequest: {
        ...toIdentity(gathered.target),
        title: gathered.target.title,
      },
      totals: totalsOf(gathered.rows),
      contributors: gathered.rows.map((row) => ({
        ...row,
        projectName: nameOf(row.projectId),
      })),
      modelBreakdown: gathered.modelBreakdown,
      sessions: [...gathered.sessions]
        .sort((a, b) => b.startedAtMs - a.startedAtMs)
        .slice(0, DETAIL_SESSIONS_LIMIT)
        .map((session) => ({
          sessionId: session.sessionId,
          startedAtMs: session.startedAtMs,
          userLabel: session.userId,
          projectName: nameOf(session.tenantId),
          agent: session.agent,
          totalTokens: tokensOf(session),
          costUsd: costProjects.has(session.tenantId) ? session.costUsd : null,
        })),
    };
  }

  /**
   * The personal page's projection: the pull requests this project's own
   * sessions touched, priced across every project the caller may read, and the
   * branches of its sessions that have no pull request yet.
   */
  async getForPersonalProject({
    projectId,
    permittedProjectIds,
    costProjectIds,
    projectNames,
  }: PersonalPullRequestUsageQuery): Promise<PersonalPullRequestUsage> {
    const organizationId = await this.deps.resolveOrganizationId(projectId);
    if (!organizationId) return { rows: [], unlinked: [] };

    const toMs = nowMs(this.deps);
    const personalSessions = await this.deps.personalSessions.listRecent({
      projectId,
      fromMs: toMs - PERSONAL_SESSION_WINDOW_MS,
      toMs,
      limit: PERSONAL_SESSION_LIMIT,
    });

    const byRepository = groupSessionsByRepository(personalSessions);
    const rows: PersonalPullRequestRow[] = [];
    const unlinked: UnlinkedBranchRollup[] = [];
    const nonBillableAgents = await resolveNonBillableAgents({
      deps: this.deps,
      organizationId,
      agents: personalSessions.map((session) => session.agent),
    });

    for (const group of byRepository) {
      const pullRequests = await this.deps.pullRequests.findAllByBranches({
        organizationId,
        repositoryHost: group.repositoryHost,
        repositoryFullName: group.repositoryFullName,
        headBranches: [...new Set(group.sessions.map((s) => s.headBranch))],
      });
      const assignments = assignSessionsToPullRequests({
        sessions: group.sessions,
        pullRequests: toAssignable(pullRequests),
      });

      // Discovery is personal: only the pull requests this project's own work
      // touched become rows. Their NUMBERS then come from every project the
      // caller may read, which is what makes a row the pull request's price
      // rather than one person's share of it.
      const discovered = pullRequests.filter((pullRequest) =>
        group.sessions.some(
          (session) =>
            assignments.get(session.sessionId) === pullRequest.prNumber,
        ),
      );
      if (discovered.length > 0) {
        rows.push(
          ...(await this.organizationRowsFor({
            group,
            discovered,
            pullRequests,
            permittedProjectIds,
            costProjectIds,
            projectNames,
            organizationId,
            toMs,
          })),
        );
      }

      const unmapped = group.sessions.filter(
        (session) => !assignments.has(session.sessionId),
      );
      if (unmapped.length === 0) continue;
      const repoCovered = await this.deps.installations.coversRepository({
        organizationId,
        repositoryFullName: group.repositoryFullName,
      });
      unlinked.push(
        ...unlinkedRollupsFor({
          group,
          sessions: unmapped,
          repoCovered,
          nonBillableAgents,
        }),
      );
    }

    return { rows, unlinked };
  }

  /**
   * The organization-wide figures for the pull requests one repository group
   * discovered: one cross-project session read and one per-model read for the
   * whole group, rather than a pair per pull request.
   */
  private async organizationRowsFor({
    group,
    discovered,
    pullRequests,
    permittedProjectIds,
    costProjectIds,
    projectNames,
    organizationId,
    toMs,
  }: {
    group: PersonalRepositoryGroup;
    discovered: GithubPullRequestRow[];
    pullRequests: GithubPullRequestRow[];
    permittedProjectIds: string[];
    costProjectIds: string[];
    projectNames: Record<string, string>;
    organizationId: string;
    toMs: number;
  }): Promise<PersonalPullRequestRow[]> {
    if (permittedProjectIds.length === 0) return [];

    const [owner, name] = group.repositoryFullName.split("/");
    if (!owner || !name) return [];

    const sessions = await this.deps.sessions.listByRepositoryBranch({
      tenantIds: permittedProjectIds,
      repositoryHost: group.repositoryHost,
      repositoryOwner: owner,
      repositoryName: name,
      branches: [...new Set(discovered.map((row) => row.headBranch))],
      startedAtFromMs: toMs - USAGE_SESSION_WINDOW_MS,
    });
    const assignments = assignSessionsToPullRequests({
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        startedAtMs: session.startedAtMs,
        headBranch: session.gitBranch,
      })),
      pullRequests: toAssignable(pullRequests),
    });

    const nonBillableAgents = await resolveNonBillableAgents({
      deps: this.deps,
      organizationId,
      agents: sessions.map((session) => session.agent),
    });
    const modelTotals =
      await this.deps.sessionEvents.sumTokensByModelPerSession({
        tenantIds: permittedProjectIds,
        sessionIds: sessions.map((session) => session.sessionId),
        fromMs: toMs - USAGE_SESSION_WINDOW_MS,
      });
    const costProjects = new Set(costProjectIds);

    return discovered.map((pullRequest) => {
      const attached = sessions.filter(
        (session) =>
          assignments.get(session.sessionId) === pullRequest.prNumber,
      );
      const rows = groupRows({
        sessions: attached,
        costProjects,
        nonBillableAgents,
      });
      const totals = totalsOf(rows);
      return {
        ...toIdentity(pullRequest),
        title: pullRequest.title,
        sessionsCount: totals.sessionsCount,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheCreationTokens: totals.cacheCreationTokens,
        totalTokens: totals.totalTokens,
        costUsd: totals.costUsd,
        billedCostUsd: totals.billedCostUsd,
        nonBilledCostUsd: totals.nonBilledCostUsd,
        modelBreakdown: modelBreakdownFor({
          sessions: attached,
          modelTotals,
          costProjects,
        }),
        contributorsSummary: contributorsSummaryFor({
          sessions: attached,
          projectNames,
        }),
      };
    });
  }

  /** The shared body of the two organization-wide reads. */
  private async gatherPullRequest(query: PullRequestUsageQuery): Promise<{
    target: GithubPullRequestRow;
    sessions: CodingAgentBranchSessionRow[];
    rows: PullRequestUsageRow[];
    modelBreakdown: ModelUsage[];
  }> {
    const target = await this.deps.pullRequests.findByNumber({
      organizationId: query.organizationId,
      repositoryHost: query.repositoryHost,
      repositoryFullName: query.repositoryFullName,
      prNumber: query.prNumber,
    });
    if (!target) {
      throw new GithubPullRequestNotMappedError({
        repositoryFullName: query.repositoryFullName,
        prNumber: query.prNumber,
      });
    }

    const empty = { target, sessions: [], rows: [], modelBreakdown: [] };
    if (query.permittedProjectIds.length === 0) return empty;

    // Every pull request the branch ever hosted, because the tenure rule needs
    // the neighbours to know where this one's era ends.
    const siblings = await this.deps.pullRequests.findAllByBranches({
      organizationId: query.organizationId,
      repositoryHost: target.repositoryHost,
      repositoryFullName: target.repositoryFullName,
      headBranches: [target.headBranch],
    });

    const [owner, name] = target.repositoryFullName.split("/");
    if (!owner || !name) return empty;

    const toMs = nowMs(this.deps);
    const sessions = await this.deps.sessions.listByRepositoryBranch({
      tenantIds: query.permittedProjectIds,
      repositoryHost: target.repositoryHost,
      repositoryOwner: owner,
      repositoryName: name,
      branches: [target.headBranch],
      startedAtFromMs: toMs - USAGE_SESSION_WINDOW_MS,
    });

    const attached = attachedToPullRequest({
      sessions,
      pullRequests: siblings,
      prNumber: target.prNumber,
    });
    const costProjects = new Set(query.costProjectIds);
    const nonBillableAgents = await resolveNonBillableAgents({
      deps: this.deps,
      organizationId: query.organizationId,
      agents: attached.map((session) => session.agent),
    });
    const modelTotals =
      await this.deps.sessionEvents.sumTokensByModelPerSession({
        tenantIds: query.permittedProjectIds,
        sessionIds: attached.map((session) => session.sessionId),
        fromMs: toMs - USAGE_SESSION_WINDOW_MS,
      });

    return {
      target,
      sessions: attached,
      rows: groupRows({
        sessions: attached,
        costProjects,
        nonBillableAgents,
      }),
      modelBreakdown: modelBreakdownFor({
        sessions: attached,
        modelTotals,
        costProjects,
      }),
    };
  }
}

/**
 * The agents on this pull request whose usage a bundled plan already covers.
 *
 * Resolved once per distinct agent rather than per session: the policy is
 * cached per (organization, source type) behind the dep, and a pull request
 * worked on by one agent should ask about it once.
 */
async function resolveNonBillableAgents({
  deps,
  organizationId,
  agents,
}: {
  deps: Pick<PullRequestUsageServiceDeps, "isSourceNonBillable">;
  organizationId: string;
  agents: string[];
}): Promise<ReadonlySet<string>> {
  const distinct = [...new Set(agents.filter((agent) => agent !== ""))];
  const answers = await Promise.all(
    distinct.map(async (agent) => ({
      agent,
      nonBillable: await deps.isSourceNonBillable({
        organizationId,
        sourceType: ingestSourceTypeOfAgent(agent),
      }),
    })),
  );
  return new Set(
    answers.filter((answer) => answer.nonBillable).map((a) => a.agent),
  );
}

/** Keep only the sessions the tenure rule attaches to THIS pull request. */
function attachedToPullRequest({
  sessions,
  pullRequests,
  prNumber,
}: {
  sessions: CodingAgentBranchSessionRow[];
  pullRequests: GithubPullRequestRow[];
  prNumber: number;
}): CodingAgentBranchSessionRow[] {
  const assignments = assignSessionsToPullRequests({
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      startedAtMs: session.startedAtMs,
      headBranch: session.gitBranch,
    })),
    pullRequests: toAssignable(pullRequests),
  });
  return sessions.filter(
    (session) => assignments.get(session.sessionId) === prNumber,
  );
}

function toAssignable(pullRequests: GithubPullRequestRow[]) {
  return pullRequests.map((pullRequest) => ({
    prNumber: pullRequest.prNumber,
    headBranch: pullRequest.headBranch,
    prCreatedAtMs: pullRequest.prCreatedAt.getTime(),
    prClosedAtMs: pullRequest.prClosedAt?.getTime() ?? null,
    prMergedAtMs: pullRequest.prMergedAt?.getTime() ?? null,
  }));
}

function toIdentity(row: GithubPullRequestRow): PullRequestIdentity {
  return {
    repositoryHost: row.repositoryHost,
    repositoryFullName: row.repositoryFullName,
    prNumber: row.prNumber,
    headBranch: row.headBranch,
    htmlUrl: row.htmlUrl,
    state: row.state,
    isDraft: row.isDraft,
    authorLogin: row.authorLogin,
    prCreatedAtMs: row.prCreatedAt.getTime(),
    prClosedAtMs: row.prClosedAt?.getTime() ?? null,
    prMergedAtMs: row.prMergedAt?.getTime() ?? null,
  };
}

/** Group the attached sessions by (project, reported user, agent). */
function groupRows({
  sessions,
  costProjects,
  nonBillableAgents,
}: {
  sessions: CodingAgentBranchSessionRow[];
  costProjects: ReadonlySet<string>;
  nonBillableAgents: ReadonlySet<string>;
}): PullRequestUsageRow[] {
  const grouped = new Map<string, GroupedUsageRow>();

  for (const session of sessions) {
    const key = [session.tenantId, session.userId, session.agent].join("\0");
    // A project carrying no cost data contributes tokens but leaves cost null,
    // rather than reporting an unpriced session as one that cost nothing.
    const priced = costProjects.has(session.tenantId);
    const nonBilled = nonBillableAgents.has(session.agent);
    const existing = grouped.get(key);
    if (existing) {
      addSessionToGroup({ group: existing, session, priced, nonBilled });
    } else {
      grouped.set(key, startGroup({ session, priced, nonBilled }));
    }
  }

  return [...grouped.values()].map(({ modelSet, ...row }) => ({
    ...row,
    models: [...modelSet].sort(),
  }));
}

/**
 * A group while it is still accumulating. `modelSet` dedupes models as sessions
 * arrive and is folded into the sorted `models` array once the group is closed.
 */
type GroupedUsageRow = PullRequestUsageRow & { modelSet: Set<string> };

function startGroup({
  session,
  priced,
  nonBilled,
}: {
  session: CodingAgentBranchSessionRow;
  priced: boolean;
  nonBilled: boolean;
}): GroupedUsageRow {
  return {
    projectId: session.tenantId,
    userLabel: session.userId,
    agent: session.agent,
    models: [],
    modelSet: new Set(session.models),
    sessionsCount: 1,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cacheReadTokens: session.cacheReadTokens,
    cacheCreationTokens: session.cacheCreationTokens,
    totalTokens: tokensOf(session),
    ...(priced
      ? {
          costUsd: session.costUsd,
          billedCostUsd: nonBilled ? 0 : session.costUsd,
          nonBilledCostUsd: nonBilled ? session.costUsd : 0,
        }
      : { costUsd: null, billedCostUsd: null, nonBilledCostUsd: null }),
  };
}

function addSessionToGroup({
  group,
  session,
  priced,
  nonBilled,
}: {
  group: GroupedUsageRow;
  session: CodingAgentBranchSessionRow;
  priced: boolean;
  nonBilled: boolean;
}): void {
  group.sessionsCount += 1;
  group.inputTokens += session.inputTokens;
  group.outputTokens += session.outputTokens;
  group.cacheReadTokens += session.cacheReadTokens;
  group.cacheCreationTokens += session.cacheCreationTokens;
  group.totalTokens += tokensOf(session);
  if (priced) {
    group.costUsd = (group.costUsd ?? 0) + session.costUsd;
    group.billedCostUsd =
      (group.billedCostUsd ?? 0) + (nonBilled ? 0 : session.costUsd);
    group.nonBilledCostUsd =
      (group.nonBilledCostUsd ?? 0) + (nonBilled ? session.costUsd : 0);
  }
  for (const model of session.models) group.modelSet.add(model);
}

function totalsOf(rows: PullRequestUsageRow[]): PullRequestUsageTotals {
  return rows.reduce<PullRequestUsageTotals>(
    (acc, row) => ({
      sessionsCount: acc.sessionsCount + row.sessionsCount,
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + row.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + row.cacheCreationTokens,
      totalTokens: acc.totalTokens + row.totalTokens,
      costUsd: addNullable(acc.costUsd, row.costUsd),
      billedCostUsd: addNullable(acc.billedCostUsd, row.billedCostUsd),
      nonBilledCostUsd: addNullable(acc.nonBilledCostUsd, row.nonBilledCostUsd),
    }),
    emptyTotals(),
  );
}

/** Sum that keeps "nobody could price this" distinct from "this cost zero". */
function addNullable(acc: number | null, value: number | null): number | null {
  return value === null ? acc : (acc ?? 0) + value;
}

function emptyTotals(): PullRequestUsageTotals {
  return {
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
}

/**
 * Roll the per-call model totals up to the pull request, over the sessions the
 * tenure rule attached to it. Cost is summed only across the projects the
 * caller may price, and stays null when none of them is.
 */
function modelBreakdownFor({
  sessions,
  modelTotals,
  costProjects,
}: {
  sessions: CodingAgentBranchSessionRow[];
  modelTotals: SessionModelTotalsRow[];
  costProjects: ReadonlySet<string>;
}): ModelUsage[] {
  const attached = new Set(
    sessions.map((session) => `${session.tenantId}\0${session.sessionId}`),
  );
  const byModel = new Map<string, ModelUsage>();

  for (const row of modelTotals) {
    if (!attached.has(`${row.tenantId}\0${row.sessionId}`)) continue;
    if (row.model === "") continue;
    const priced = costProjects.has(row.tenantId);
    const usage = byModel.get(row.model) ?? {
      model: row.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: null,
    };
    usage.inputTokens += row.inputTokens;
    usage.outputTokens += row.outputTokens;
    usage.cacheReadTokens += row.cacheReadTokens;
    usage.cacheCreationTokens += row.cacheCreationTokens;
    usage.totalTokens += tokensOf(row);
    if (priced) usage.costUsd = (usage.costUsd ?? 0) + row.costUsd;
    byModel.set(row.model, usage);
  }

  return [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Who worked on a pull request, largest contribution first. */
function contributorsSummaryFor({
  sessions,
  projectNames,
}: {
  sessions: CodingAgentBranchSessionRow[];
  projectNames: Record<string, string>;
}): ContributorSummary[] {
  const grouped = new Map<string, ContributorSummary>();
  for (const session of sessions) {
    const key = `${session.tenantId}\0${session.userId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.sessionsCount += 1;
      continue;
    }
    grouped.set(key, {
      userLabel: session.userId,
      projectName: projectNames[session.tenantId] ?? session.tenantId,
      sessionsCount: 1,
    });
  }
  return [...grouped.values()].sort(
    (a, b) => b.sessionsCount - a.sessionsCount,
  );
}

function tokensOf(session: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return (
    session.inputTokens +
    session.outputTokens +
    session.cacheReadTokens +
    session.cacheCreationTokens
  );
}

/** A project's sessions, bucketed by the repository they ran against. */
interface PersonalRepositoryGroup {
  repositoryHost: string;
  repositoryFullName: string;
  sessions: Array<{
    sessionId: string;
    startedAtMs: number;
    agent: string;
    headBranch: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
  }>;
}

function groupSessionsByRepository(
  sessions: Awaited<ReturnType<PersonalSessionLookup["listRecent"]>>,
): PersonalRepositoryGroup[] {
  const groups = new Map<string, PersonalRepositoryGroup>();
  for (const session of sessions) {
    if (
      !session.repositoryOwner ||
      !session.repositoryName ||
      !session.gitBranch
    ) {
      continue;
    }
    // Both halves of the key are case-folded, because a session stores the
    // remote's own casing and hosts are case insensitive: fold one and not the
    // other and `GitHub.com` splits off into a group of its own, so the reader
    // sees one repository listed twice with its usage divided between the
    // rows, and the group whose host is not already lower case matches no
    // mapping row and reports every branch as unlinked.
    const repositoryHost = (
      session.repositoryHost === "" ? "github.com" : session.repositoryHost
    ).toLowerCase();
    const repositoryFullName =
      `${session.repositoryOwner}/${session.repositoryName}`.toLowerCase();
    const key = `${repositoryHost} ${repositoryFullName}`;
    const group = groups.get(key) ?? {
      repositoryHost,
      repositoryFullName,
      sessions: [],
    };
    group.sessions.push({
      sessionId: session.sessionId,
      startedAtMs: session.startedAtMs,
      agent: session.agent,
      headBranch: session.gitBranch,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      cacheReadTokens: session.cacheReadTokens,
      cacheCreationTokens: session.cacheCreationTokens,
      costUsd: session.costUsd,
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

function unlinkedRollupsFor({
  group,
  sessions,
  repoCovered,
  nonBillableAgents,
}: {
  group: PersonalRepositoryGroup;
  sessions: PersonalRepositoryGroup["sessions"];
  repoCovered: boolean;
  nonBillableAgents: ReadonlySet<string>;
}): UnlinkedBranchRollup[] {
  const byBranch = new Map<string, PersonalRepositoryGroup["sessions"]>();
  for (const session of sessions) {
    const list = byBranch.get(session.headBranch) ?? [];
    list.push(session);
    byBranch.set(session.headBranch, list);
  }
  return [...byBranch.entries()].map(([headBranch, branchSessions]) => ({
    repositoryHost: group.repositoryHost,
    repositoryFullName: group.repositoryFullName,
    headBranch,
    sessionsCount: branchSessions.length,
    totalTokens: branchSessions.reduce((sum, s) => sum + tokensOf(s), 0),
    costUsd: sumOf(branchSessions, "costUsd"),
    billedCostUsd: branchSessions
      .filter((session) => !nonBillableAgents.has(session.agent))
      .reduce((sum, session) => sum + session.costUsd, 0),
    nonBilledCostUsd: branchSessions
      .filter((session) => nonBillableAgents.has(session.agent))
      .reduce((sum, session) => sum + session.costUsd, 0),
    repoCovered,
  }));
}

function sumOf<K extends string>(
  rows: Array<Record<K, number>>,
  key: K,
): number {
  return rows.reduce((sum, row) => sum + row[key], 0);
}
