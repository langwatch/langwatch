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
import { assignSessionsToPullRequests } from "./pull-request-assignment";
import type {
  CodingAgentBranchSessionRow,
  CodingAgentSessionRepository,
} from "./repositories/coding-agent-session.repository";

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

/** One (project, user, agent) group's contribution to a pull request. */
export interface PullRequestUsageRow {
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
  /** Null for a project the caller may read but not price. */
  costUsd: number | null;
}

export interface PullRequestUsageTotals {
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  /** Null when no included row carried a cost the caller may see. */
  costUsd: number | null;
}

export interface PullRequestUsage {
  pullRequest: PullRequestIdentity;
  rows: PullRequestUsageRow[];
  totals: PullRequestUsageTotals;
}

/** One mapped pull request as the personal page lists it. */
export interface PersonalPullRequestRow extends PullRequestIdentity {
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

/** A branch whose sessions attach to no pull request. */
export interface UnlinkedBranchRollup {
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  sessionsCount: number;
  totalTokens: number;
  costUsd: number | null;
  /** Whether the organization's connection reaches this repository at all. */
  repoCovered: boolean;
}

export interface PersonalPullRequestUsage {
  rows: PersonalPullRequestRow[];
  unlinked: UnlinkedBranchRollup[];
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

export interface PullRequestUsageServiceDeps {
  pullRequests: GithubPullRequestsRepository;
  sessions: Pick<CodingAgentSessionRepository, "listByRepositoryBranch">;
  personalSessions: PersonalSessionLookup;
  installations: RepositoryCoverageLookup;
  resolveOrganizationId(projectId: string): Promise<string | undefined>;
  now?: () => number;
}

export interface PullRequestUsageQuery {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
  /** Projects the caller may read. Rows outside it never appear. */
  permittedProjectIds: string[];
  /** The subset of those the caller may also price. */
  costProjectIds: string[];
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

    const identity = toIdentity(target);
    if (query.permittedProjectIds.length === 0) {
      return { pullRequest: identity, rows: [], totals: emptyTotals() };
    }

    // Every pull request the branch ever hosted, because the tenure rule needs
    // the neighbours to know where this one's era ends.
    const siblings = await this.deps.pullRequests.findAllByBranches({
      organizationId: query.organizationId,
      repositoryHost: target.repositoryHost,
      repositoryFullName: target.repositoryFullName,
      headBranches: [target.headBranch],
    });

    const [owner, name] = target.repositoryFullName.split("/");
    if (!owner || !name) {
      return { pullRequest: identity, rows: [], totals: emptyTotals() };
    }

    const sessions = await this.deps.sessions.listByRepositoryBranch({
      tenantIds: query.permittedProjectIds,
      repositoryHost: target.repositoryHost,
      repositoryOwner: owner,
      repositoryName: name,
      branches: [target.headBranch],
      startedAtFromMs: nowMs(this.deps) - USAGE_SESSION_WINDOW_MS,
    });

    const attached = attachedToPullRequest({
      sessions,
      pullRequests: siblings,
      prNumber: target.prNumber,
    });
    const costProjects = new Set(query.costProjectIds);
    const rows = groupRows({ sessions: attached, costProjects });

    return { pullRequest: identity, rows, totals: totalsOf(rows) };
  }

  /**
   * The personal page's projection: this project's own pull requests, and the
   * branches of its sessions that have no pull request yet.
   */
  async getForPersonalProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<PersonalPullRequestUsage> {
    const organizationId = await this.deps.resolveOrganizationId(projectId);
    if (!organizationId) return { rows: [], unlinked: [] };

    const toMs = nowMs(this.deps);
    const sessions = await this.deps.personalSessions.listRecent({
      projectId,
      fromMs: toMs - PERSONAL_SESSION_WINDOW_MS,
      toMs,
      limit: PERSONAL_SESSION_LIMIT,
    });

    const byRepository = groupSessionsByRepository(sessions);
    const rows: PersonalPullRequestRow[] = [];
    const unlinked: UnlinkedBranchRollup[] = [];

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

      rows.push(...personalRowsFor({ group, pullRequests, assignments }));
      const unmapped = group.sessions.filter(
        (session) => !assignments.has(session.sessionId),
      );
      if (unmapped.length === 0) continue;
      const repoCovered = await this.deps.installations.coversRepository({
        organizationId,
        repositoryFullName: group.repositoryFullName,
      });
      unlinked.push(
        ...unlinkedRollupsFor({ group, sessions: unmapped, repoCovered }),
      );
    }

    return { rows, unlinked };
  }
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
}: {
  sessions: CodingAgentBranchSessionRow[];
  costProjects: ReadonlySet<string>;
}): PullRequestUsageRow[] {
  const grouped = new Map<string, GroupedUsageRow>();

  for (const session of sessions) {
    const key = [session.tenantId, session.userId, session.agent].join("\0");
    // A project carrying no cost data contributes tokens but leaves cost null,
    // rather than reporting an unpriced session as one that cost nothing.
    const priced = costProjects.has(session.tenantId);
    const existing = grouped.get(key);
    if (existing) addSessionToGroup({ group: existing, session, priced });
    else grouped.set(key, startGroup({ session, priced }));
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
}: {
  session: CodingAgentBranchSessionRow;
  priced: boolean;
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
    costUsd: priced ? session.costUsd : null,
  };
}

function addSessionToGroup({
  group,
  session,
  priced,
}: {
  group: GroupedUsageRow;
  session: CodingAgentBranchSessionRow;
  priced: boolean;
}): void {
  group.sessionsCount += 1;
  group.inputTokens += session.inputTokens;
  group.outputTokens += session.outputTokens;
  group.cacheReadTokens += session.cacheReadTokens;
  group.cacheCreationTokens += session.cacheCreationTokens;
  group.totalTokens += tokensOf(session);
  if (priced) group.costUsd = (group.costUsd ?? 0) + session.costUsd;
  for (const model of session.models) group.modelSet.add(model);
}

function totalsOf(rows: PullRequestUsageRow[]): PullRequestUsageTotals {
  const totals = rows.reduce<PullRequestUsageTotals>(
    (acc, row) => ({
      sessionsCount: acc.sessionsCount + row.sessionsCount,
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + row.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + row.cacheCreationTokens,
      totalTokens: acc.totalTokens + row.totalTokens,
      costUsd:
        row.costUsd === null ? acc.costUsd : (acc.costUsd ?? 0) + row.costUsd,
    }),
    emptyTotals(),
  );
  return totals;
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
  };
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

function personalRowsFor({
  group,
  pullRequests,
  assignments,
}: {
  group: PersonalRepositoryGroup;
  pullRequests: GithubPullRequestRow[];
  assignments: Map<string, number>;
}): PersonalPullRequestRow[] {
  const rows: PersonalPullRequestRow[] = [];
  for (const pullRequest of pullRequests) {
    const attached = group.sessions.filter(
      (session) => assignments.get(session.sessionId) === pullRequest.prNumber,
    );
    if (attached.length === 0) continue;
    rows.push({
      ...toIdentity(pullRequest),
      sessionsCount: attached.length,
      inputTokens: sumOf(attached, "inputTokens"),
      outputTokens: sumOf(attached, "outputTokens"),
      cacheReadTokens: sumOf(attached, "cacheReadTokens"),
      cacheCreationTokens: sumOf(attached, "cacheCreationTokens"),
      totalTokens: attached.reduce((sum, s) => sum + tokensOf(s), 0),
      costUsd: sumOf(attached, "costUsd"),
    });
  }
  return rows;
}

function unlinkedRollupsFor({
  group,
  sessions,
  repoCovered,
}: {
  group: PersonalRepositoryGroup;
  sessions: PersonalRepositoryGroup["sessions"];
  repoCovered: boolean;
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
    repoCovered,
  }));
}

function sumOf<K extends string>(
  rows: Array<Record<K, number>>,
  key: K,
): number {
  return rows.reduce((sum, row) => sum + row[key], 0);
}
