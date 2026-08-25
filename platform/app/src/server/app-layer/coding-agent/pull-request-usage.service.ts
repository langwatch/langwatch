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
 * A contributor is a project, not a person, and rows group by (project, agent).
 * Per-person attribution WITHIN a shared project is deliberately not offered:
 * the only per-person key a session carries is an opaque id the agent reported
 * about itself, which resolves to no LangWatch account and to no human being,
 * so splitting a shared project by it would invent a distinction the data
 * cannot support. A PERSONAL workspace holds one person by construction, so
 * there the project resolves to that person's name, and that is the only place
 * a name is claimed.
 *
 * Numbers and names only. The rows carry counts, token buckets, an agent name,
 * a model list and the contributor's resolved name, no session title, no
 * prompt, no file list. That is enforced by the ClickHouse read selecting only
 * those columns, and pinned by a test over the response's own keys.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import {
  GithubPullRequestNotMappedError,
  type GithubPullRequest,
  type GithubService,
} from "@langwatch/github-contract";
import { GithubCompositionAdapter } from "@langwatch/github-server";
import { env } from "~/env.mjs";
const normalizeGithubHost = (host: string) =>
  GithubCompositionAdapter.normalizeGithubHost(host, {
    host: env.GITHUB_LANGY_HOST,
  });
type GithubPullRequestRow = GithubPullRequest;
import { ingestSourceTypeOfAgent } from "./coding-agent-source-type";
import {
  assignDrivingSessionsToPullRequests,
  branchesOf,
} from "./pull-request-assignment";
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

/**
 * When one session last did anything.
 *
 * A session that ran for hours started once and kept working, so its start
 * time is the wrong answer to "when was this last touched". The last event's
 * timestamp is the right one, but it is 0 for a session whose fold never
 * recorded one, and a 0 would drag a row to the bottom of a recency sort, so
 * the start time is the floor.
 */
function sessionActivityAtMs({
  startedAtMs,
  lastEventOccurredAtMs,
}: {
  startedAtMs: number;
  lastEventOccurredAtMs: number;
}): number {
  return Math.max(startedAtMs, lastEventOccurredAtMs || 0);
}

/** The latest activity across a set of sessions, 0 when there are none. */
function latestActivityAtMs(
  sessions: ReadonlyArray<{
    startedAtMs: number;
    lastEventOccurredAtMs: number;
  }>,
): number {
  return sessions.reduce(
    (latest, session) => Math.max(latest, sessionActivityAtMs(session)),
    0,
  );
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

/**
 * What one model consumed and cost, within one pull request.
 *
 * `tokensKnown` is false when all we know is that the model ran. The totals are
 * then zero and mean nothing, so a reader must not print them. See
 * {@link modelsFor} for when that happens.
 */
export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  /** Null when no project contributing this model may be priced. */
  costUsd: number | null;
  /** Whether the totals on this entry are real. */
  tokensKnown: boolean;
}

/** How one project is named when it appears as a contributor. */
export interface ContributorProject {
  /** The project's slug, which addresses its pages. */
  slug: string;
  /** A person's name for a personal workspace, the project's name otherwise. */
  contributorLabel: string;
  /** Whether the label names a project a reader can open, or a person. */
  isLinkable: boolean;
}

/** What one contributor is called, and whether the name opens anything. */
interface ContributorIdentity {
  projectId: string;
  projectSlug: string;
  contributorLabel: string;
  /** True when the label is a project's name, false when it is a person's. */
  contributorIsProject: boolean;
}

/** One (project, agent) group's contribution to a pull request. */
export interface PullRequestUsageRow extends CostSplit, ContributorIdentity {
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

/**
 * Who worked on a pull request, as a row's compact summary line. One line per
 * contributor rather than per agent, because the line names contributors: an
 * agent breakdown is what the detail's own contributor table is for.
 */
export interface ContributorSummary extends ContributorIdentity {
  sessionsCount: number;
}

/** One mapped pull request as the personal page lists it. */
export interface PersonalPullRequestRow extends PullRequestIdentity, CostSplit {
  /** The pull request's own GitHub title, from the stored snapshot. */
  title: string;
  /** When this row's counted work last ran, epoch ms, from our own sessions rather than GitHub. */
  lastActivityAtMs: number;
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
  /** When this row's counted work last ran, epoch ms, from our own sessions rather than GitHub. */
  lastActivityAtMs: number;
  sessionsCount: number;
  totalTokens: number;
  /**
   * Which models ran. A branch row carries names only: the per-call totals are
   * read for the mapped pull requests, and asking for them again per unlinked
   * branch would be a second query for an answer this page never shows.
   */
  modelBreakdown: ModelUsage[];
  /** Whether the organization's connection reaches this repository at all. */
  repoCovered: boolean;
}

export interface PersonalPullRequestUsage {
  rows: PersonalPullRequestRow[];
  unlinked: UnlinkedBranchRollup[];
}

/**
 * One session as the detail lists it: facts, plus the one-line title the agent
 * generated for the session.
 *
 * The title is the only conversation-derived value on this payload, and it is
 * here because a list of anonymous rows makes a reader open each one to find
 * out which is which. It rides ungated to the read boundary, which blanks it
 * for every session whose PROJECT this reader may not read the captured
 * content of: the detail spans an organization, and content visibility is a
 * project's own. A test pins this row's key set, so nothing else joins it
 * without somebody deciding to disclose it.
 */
export interface PullRequestSessionFact extends ContributorIdentity {
  sessionId: string;
  startedAtMs: number;
  agent: string;
  totalTokens: number;
  costUsd: number | null;
  /** Null when the session never generated one. */
  title: string | null;
}

export interface PullRequestDetail {
  pullRequest: PullRequestIdentity & { title: string };
  totals: PullRequestUsageTotals;
  contributors: PullRequestUsageRow[];
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
      /** When the session last produced an event, epoch ms, 0 when it never did. */
      lastEventOccurredAt: number;
      agent: string;
      repositoryHost: string;
      repositoryOwner: string;
      repositoryName: string;
      gitBranch: string;
      /** Every branch the session drove; empty for a row folded before it. */
      gitBranches: string[];
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      costUsd: number;
      /** The models the session's own rollup recorded. */
      models: string[];
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
  pullRequests: Pick<GithubService, "findAllByBranches" | "tryFindByNumber">;
  sessions: Pick<CodingAgentSessionRepository, "listByRepositoryBranch">;
  personalSessions: PersonalSessionLookup;
  sessionEvents: SessionModelTotalsLookup;
  installations: Pick<GithubService, "coversRepository">;
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
  /** How each permitted project is named as a contributor, keyed by id. */
  projects: Record<string, ContributorProject>;
}

export interface PullRequestUsageQuery extends CallerScope {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
}

export interface PersonalPullRequestUsageQuery extends CallerScope {
  projectId: string;
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
  async getPullRequestUsage(query: PullRequestUsageQuery): Promise<PullRequestUsage> {
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
   * the detail surface. See {@link PullRequestSessionFact} for what a session
   * carries, and where its title is decided.
   */
  async getPullRequestDetail(query: PullRequestUsageQuery): Promise<PullRequestDetail> {
    const gathered = await this.gatherPullRequest(query);
    const costProjects = new Set(query.costProjectIds);

    return {
      pullRequest: {
        ...toIdentity(gathered.target),
        title: gathered.target.title,
      },
      totals: totalsOf(gathered.rows),
      contributors: gathered.rows,
      modelBreakdown: gathered.modelBreakdown,
      sessions: [...gathered.sessions]
        .sort((a, b) => b.startedAtMs - a.startedAtMs)
        .slice(0, DETAIL_SESSIONS_LIMIT)
        .map((session) => ({
          sessionId: session.sessionId,
          startedAtMs: session.startedAtMs,
          ...contributorOf({
            projectId: session.tenantId,
            projects: query.projects,
          }),
          agent: session.agent,
          totalTokens: tokensOf(session),
          costUsd: costProjects.has(session.tenantId) ? session.costUsd : null,
          title: session.title === "" ? null : session.title,
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
    projects,
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
        headBranches: [...new Set(group.sessions.flatMap((s) => s.headBranches))],
      });
      const assignments = assignDrivingSessionsToPullRequests({
        sessions: group.sessions,
        pullRequests: toAssignable(pullRequests),
      });

      // Discovery is personal: only the pull requests this project's own work
      // touched become rows. Their NUMBERS then come from every project the
      // caller may read, which is what makes a row the pull request's price
      // rather than one person's share of it.
      const discovered = pullRequests.filter((pullRequest) =>
        group.sessions.some(
          (session) => assignments.get(session.sessionId) === pullRequest.prNumber,
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
            projects,
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
    projects,
    organizationId,
    toMs,
  }: {
    group: PersonalRepositoryGroup;
    discovered: GithubPullRequestRow[];
    pullRequests: GithubPullRequestRow[];
    permittedProjectIds: string[];
    costProjectIds: string[];
    projects: Record<string, ContributorProject>;
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
    const assignments = assignDrivingSessionsToPullRequests({
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        startedAtMs: session.startedAtMs,
        headBranches: branchesOf(session),
      })),
      pullRequests: toAssignable(pullRequests),
    });

    const nonBillableAgents = await resolveNonBillableAgents({
      deps: this.deps,
      organizationId,
      agents: sessions.map((session) => session.agent),
    });
    const modelTotals = await this.deps.sessionEvents.sumTokensByModelPerSession({
      tenantIds: permittedProjectIds,
      sessionIds: sessions.map((session) => session.sessionId),
      fromMs: toMs - USAGE_SESSION_WINDOW_MS,
    });
    const costProjects = new Set(costProjectIds);

    return discovered.map((pullRequest) => {
      const attached = sessions.filter(
        (session) => assignments.get(session.sessionId) === pullRequest.prNumber,
      );
      const rows = groupRows({
        sessions: attached,
        costProjects,
        nonBillableAgents,
        projects,
      });
      const totals = totalsOf(rows);
      return {
        ...toIdentity(pullRequest),
        title: pullRequest.title,
        lastActivityAtMs: latestActivityAtMs(attached),
        sessionsCount: totals.sessionsCount,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheCreationTokens: totals.cacheCreationTokens,
        totalTokens: totals.totalTokens,
        costUsd: totals.costUsd,
        billedCostUsd: totals.billedCostUsd,
        nonBilledCostUsd: totals.nonBilledCostUsd,
        modelBreakdown: modelsFor({
          sessions: attached,
          modelTotals,
          costProjects,
        }),
        contributorsSummary: contributorsSummaryFor({
          sessions: attached,
          projects,
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
    const target = await this.deps.pullRequests.tryFindByNumber({
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
    const modelTotals = await this.deps.sessionEvents.sumTokensByModelPerSession({
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
        projects: query.projects,
      }),
      modelBreakdown: modelsFor({
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
  return new Set(answers.filter((answer) => answer.nonBillable).map((a) => a.agent));
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
  const assignments = assignDrivingSessionsToPullRequests({
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      startedAtMs: session.startedAtMs,
      headBranches: branchesOf(session),
    })),
    pullRequests: toAssignable(pullRequests),
  });
  return sessions.filter((session) => assignments.get(session.sessionId) === prNumber);
}

function toAssignable(pullRequests: ReadonlyArray<GithubPullRequestRow>) {
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

/**
 * Group the attached sessions by (project, agent), which is exactly what a
 * reader sees: a contributor and the assistant it ran. The agent-reported user
 * id is not part of the key, because it names nobody, and keying on it split
 * one person's work into two near-identical rows whenever their agent changed
 * the id it reported about itself.
 */
function groupRows({
  sessions,
  costProjects,
  nonBillableAgents,
  projects,
}: {
  sessions: CodingAgentBranchSessionRow[];
  costProjects: ReadonlySet<string>;
  nonBillableAgents: ReadonlySet<string>;
  projects: Record<string, ContributorProject>;
}): PullRequestUsageRow[] {
  const grouped = new Map<string, GroupedUsageRow>();

  for (const session of sessions) {
    const key = [session.tenantId, session.agent].join("\0");
    // A project carrying no cost data contributes tokens but leaves cost null,
    // rather than reporting an unpriced session as one that cost nothing.
    const priced = costProjects.has(session.tenantId);
    const nonBilled = nonBillableAgents.has(session.agent);
    const existing = grouped.get(key);
    if (existing) {
      addSessionToGroup({ group: existing, session, priced, nonBilled });
    } else {
      grouped.set(key, startGroup({ session, priced, nonBilled, projects }));
    }
  }

  return [...grouped.values()].map(({ modelSet, ...row }) => ({
    ...row,
    models: [...modelSet].sort(),
  }));
}

/**
 * How one project is named on a row. Falls back to the project id when the
 * caller handed over no entry for it, which only happens for a project outside
 * the permission cut, whose sessions the read never returns in the first place.
 */
function contributorOf({
  projectId,
  projects,
}: {
  projectId: string;
  projects: Record<string, ContributorProject>;
}): ContributorIdentity {
  const project = projects[projectId];
  return {
    projectId,
    projectSlug: project?.slug ?? "",
    contributorLabel: project?.contributorLabel ?? projectId,
    contributorIsProject: project?.isLinkable ?? false,
  };
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
  projects,
}: {
  session: CodingAgentBranchSessionRow;
  priced: boolean;
  nonBilled: boolean;
  projects: Record<string, ContributorProject>;
}): GroupedUsageRow {
  return {
    ...contributorOf({ projectId: session.tenantId, projects }),
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
    group.billedCostUsd = (group.billedCostUsd ?? 0) + (nonBilled ? 0 : session.costUsd);
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
 * Which models ran, and what each consumed where we know it.
 *
 * THE one answer to that question: every caller uses this, and nothing
 * downstream picks between sources. Two of them exist and they are not
 * interchangeable.
 *
 * The per-call fact table has the tokens, so it wins whenever it answers. It
 * is written from the `api_request` LOG alone, deliberately, because that is
 * the one carrier holding tokens, cost and duration together and consuming
 * only it makes double-counting against `llm_request` spans impossible. An
 * agent reporting usage on spans or metrics instead therefore contributes no
 * rows to it at all.
 *
 * The session's own row is the fallback, because the fold behind it consumes
 * all three carriers and records which models ran regardless. It holds a SET
 * of names with no per-model split, so those entries carry `tokensKnown:
 * false` and totals that mean nothing. That is strictly better than the
 * alternative, which is a row reporting millions of tokens and no model.
 *
 * Both come from reads the caller already made, so the fallback costs no
 * query. When neither answers, the list is empty and the reader says so.
 */
function modelsFor({
  sessions,
  modelTotals,
  costProjects,
}: {
  sessions: Array<{ tenantId?: string; sessionId?: string; models: string[] }>;
  modelTotals: SessionModelTotalsRow[];
  costProjects: ReadonlySet<string>;
}): ModelUsage[] {
  const perCall = perCallModelsFor({ sessions, modelTotals, costProjects });
  return perCall.length > 0 ? perCall : namedModelsFor(sessions);
}

/** The per-call totals, over the sessions the tenure rule attached. */
function perCallModelsFor({
  sessions,
  modelTotals,
  costProjects,
}: {
  sessions: Array<{ tenantId?: string; sessionId?: string; models: string[] }>;
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
      tokensKnown: true,
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

/** The names alone, from the sessions' own rows. Alphabetical: nothing ranks them. */
function namedModelsFor(sessions: Array<{ models: string[] }>): ModelUsage[] {
  const names = new Set<string>();
  for (const session of sessions) {
    for (const model of session.models) {
      if (model !== "") names.add(model);
    }
  }
  return [...names].sort().map((model) => ({
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costUsd: null,
    tokensKnown: false,
  }));
}

/** Who worked on a pull request, largest contribution first. */
function contributorsSummaryFor({
  sessions,
  projects,
}: {
  sessions: CodingAgentBranchSessionRow[];
  projects: Record<string, ContributorProject>;
}): ContributorSummary[] {
  const grouped = new Map<string, ContributorSummary>();
  for (const session of sessions) {
    const existing = grouped.get(session.tenantId);
    if (existing) {
      existing.sessionsCount += 1;
      continue;
    }
    grouped.set(session.tenantId, {
      ...contributorOf({ projectId: session.tenantId, projects }),
      sessionsCount: 1,
    });
  }
  return [...grouped.values()].sort((a, b) => b.sessionsCount - a.sessionsCount);
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
    lastEventOccurredAtMs: number;
    agent: string;
    /**
     * The branch the session sits on now. The unlinked rollups group on it, so
     * a session whose work maps to no pull request is reported once, where the
     * work currently is, rather than once per branch it ever touched.
     */
    headBranch: string;
    /** Every branch it drove, which is what discovery and attribution read. */
    headBranches: string[];
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
    models: string[];
  }>;
}

function groupSessionsByRepository(
  sessions: Awaited<ReturnType<PersonalSessionLookup["listRecent"]>>,
): PersonalRepositoryGroup[] {
  const groups = new Map<string, PersonalRepositoryGroup>();
  for (const session of sessions) {
    if (!session.repositoryOwner || !session.repositoryName || !session.gitBranch) {
      continue;
    }
    // Both halves of the key are case-folded, because a session stores the
    // remote's own casing and hosts are case insensitive: fold one and not the
    // other and `GitHub.com` splits off into a group of its own, so the reader
    // sees one repository listed twice with its usage divided between the
    // rows, and the group whose host is not already lower case matches no
    // mapping row and reports every branch as unlinked.
    const repositoryHost = normalizeGithubHost(session.repositoryHost);
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
    // The branch rollup stays personal, so its recency is too: only the
    // viewer's own sessions on this branch can move it.
    lastActivityAtMs: latestActivityAtMs(branchSessions),
    sessionsCount: branchSessions.length,
    totalTokens: branchSessions.reduce((sum, s) => sum + tokensOf(s), 0),
    modelBreakdown: namedModelsFor(branchSessions),
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

function sumOf<K extends string>(rows: Array<Record<K, number>>, key: K): number {
  return rows.reduce((sum, row) => sum + row[key], 0);
}
