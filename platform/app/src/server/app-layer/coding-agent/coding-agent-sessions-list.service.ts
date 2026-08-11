import { createLogger } from "@langwatch/observability";

import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import type {
  GithubPullRequestLookup,
  PullRequestBranchKey,
} from "../traces/session-groups.pull-request-link";
import { assignSessionsToPullRequests } from "./pull-request-assignment";

/**
 * The Sessions screen's read: one row per coding-agent session, named by the
 * title the agent generated, priced, and joined to the pull requests it drove.
 *
 * Its own service rather than another method on `CodingAgentSessionService`,
 * which is the point read over the session aggregate and knows nothing of
 * remotes: this one joins a second bounded context (the organization's GitHub
 * mapping) onto that read, and it is the only place that join happens for a
 * whole page at once.
 *
 * Content: the row carries the generated title, which is written BY the model
 * FROM the conversation. Whether a reader gets to see it is decided at the read
 * boundary against that project's protections, never here.
 *
 * Spec: specs/coding-agent/sessions-screen.feature.
 */

const logger = createLogger(
  "langwatch:app-layer:coding-agent:sessions-list-service",
);

/** How far back the screen looks. */
export const SESSIONS_LIST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Ceiling on one answer. The screen is a list of a person's own recent work
 * rather than a ledger, so it is bounded here instead of paged: a personal
 * quarter rarely reaches this, and the read behind it scans ClickHouse.
 */
export const SESSIONS_LIST_LIMIT = 200;

/** One pull request as a session row names it. */
export interface SessionListPullRequest {
  number: number;
  url: string;
  title: string;
}

/**
 * One session as the screen lists it.
 *
 * Counters, bounded sets, ids and the one-line title: no prompt, no reply, no
 * tool output. The context economics (`peakContextTokens`, `compactions`,
 * `cacheRebuildCount`, `activeTimeCliSec` against `blockedOnUserMs`) are the
 * columns that say whether a session was cheap or ruinous, which is the
 * question the screen exists to answer.
 */
export interface CodingAgentSessionListRow {
  sessionId: string;
  /** The generated conversation title; null when there is none to show. */
  title: string | null;
  agent: string;
  agentVersion: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  /** The branch the session ended on. */
  gitBranch: string;
  /** Every branch it drove, oldest first, never empty when it drove any. */
  gitBranches: string[];
  startedAtMs: number;
  /** When it last produced an event; 0 when it never did. */
  lastEventOccurredAtMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Null when this reader may not price the project. */
  costUsd: number | null;
  peakContextTokens: number;
  compactions: number;
  compactionTokensBefore: number;
  compactionTokensAfter: number;
  cacheRebuildCount: number;
  largestCacheRebuildTokens: number;
  /** Seconds the agent was working, as the CLI measured it. */
  activeTimeCliSec: number;
  /** Milliseconds the agent spent waiting on its human. */
  blockedOnUserMs: number;
  models: string[];
  /** Every pull request the session drove, by number ascending. */
  pullRequests: SessionListPullRequest[];
}

/** The session read this list is built on. */
export interface SessionListLookup {
  listRecent(args: {
    projectId: string;
    fromMs: number;
    toMs: number;
    limit?: number;
  }): Promise<CodingAgentSessionRow[]>;
}

export interface CodingAgentSessionsListServiceDeps {
  sessions: SessionListLookup;
  /** The organization's branch-to-pull-request mapping, read in one call. */
  pullRequests: GithubPullRequestLookup;
  resolveOrganizationId(projectId: string): Promise<string | undefined>;
  now?: () => number;
}

export class CodingAgentSessionsListService {
  private readonly deps: CodingAgentSessionsListServiceDeps;

  constructor(deps: CodingAgentSessionsListServiceDeps) {
    this.deps = deps;
  }

  /**
   * The project's recent sessions, newest first, each with the pull requests
   * it drove.
   */
  async listForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<CodingAgentSessionListRow[]> {
    const toMs = this.deps.now?.() ?? Date.now();
    const rows = await this.deps.sessions.listRecent({
      projectId,
      fromMs: toMs - SESSIONS_LIST_WINDOW_MS,
      toMs,
      limit: SESSIONS_LIST_LIMIT,
    });
    const pullRequests = await this.pullRequestsFor({ projectId, rows });
    return rows.map((row) => toListRow(row, pullRequests.get(row.sessionId)));
  }

  /**
   * Every session's pull requests, keyed by session id, in ONE lookup for the
   * whole page.
   *
   * Best-effort: an organization that never connected GitHub, a repository no
   * installation reaches and a failed read all leave the rows unlinked. A
   * session list that fails because a join failed would be a worse answer than
   * a session list with no pull requests on it.
   */
  private async pullRequestsFor({
    projectId,
    rows,
  }: {
    projectId: string;
    rows: CodingAgentSessionRow[];
  }): Promise<Map<string, SessionListPullRequest[]>> {
    const drives = branchDrivesOf(rows);
    if (drives.length === 0) return new Map();

    try {
      const organizationId = await this.deps.resolveOrganizationId(projectId);
      if (!organizationId) return new Map();

      const candidates = await this.deps.pullRequests.findForBranches({
        organizationId,
        keys: branchKeysOf(drives),
      });
      if (candidates.length === 0) return new Map();

      return linkDrives({ drives, candidates });
    } catch (error) {
      // Best-effort is not the same as silent: a lookup that keeps failing
      // renders every row unlinked, which looks exactly like an organization
      // that never opened a pull request unless the failure is said somewhere.
      logger.warn(
        { error, projectId },
        "pull request lookup failed, listing sessions unlinked",
      );
      return new Map();
    }
  }
}

/** A candidate as the mapping lookup returns it. */
type PullRequestCandidate = Awaited<
  ReturnType<GithubPullRequestLookup["findForBranches"]>
>[number];

/**
 * One (session, branch) pair: a session drove this branch, from this start
 * time, on this repository.
 *
 * The pair rather than the session is the unit of the join, because the tenure
 * rule is per branch: a session that drove two branches asks the rule twice
 * and can come back with two pull requests.
 */
interface BranchDrive {
  sessionId: string;
  startedAtMs: number;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
}

/**
 * The branches each session drove, as join keys.
 *
 * `gitBranches` (migration 00077) is the whole history. A row folded before
 * that column existed carries only `gitBranch`, so it falls back to that one:
 * the session did drive it, and answering nothing would silently unlink every
 * session in the dormant population.
 *
 * Host and repository are case-folded here, the way the mapping stores them
 * and the way the sessions lens folds its own join key: a session records
 * whatever casing its git remote carries, hosts are case insensitive, and
 * folding one side only means a remote spelled `GitHub.com` matches no mapping
 * row at all. Branch names are never folded, because `feat/X` and `feat/x`
 * really are two branches.
 */
function branchDrivesOf(rows: CodingAgentSessionRow[]): BranchDrive[] {
  const drives: BranchDrive[] = [];
  for (const row of rows) {
    if (!row.repositoryOwner || !row.repositoryName) continue;
    const repositoryHost = (row.repositoryHost || "github.com").toLowerCase();
    const repositoryFullName =
      `${row.repositoryOwner}/${row.repositoryName}`.toLowerCase();
    for (const headBranch of branchesOf(row)) {
      drives.push({
        sessionId: row.sessionId,
        startedAtMs: row.startedAtMs,
        repositoryHost,
        repositoryFullName,
        headBranch,
      });
    }
  }
  return drives;
}

/** Every branch a session drove, oldest first, with the fallback applied. */
export function branchesOf(
  row: Pick<CodingAgentSessionRow, "gitBranch" | "gitBranches">,
): string[] {
  if (row.gitBranches.length > 0) return row.gitBranches;
  return row.gitBranch ? [row.gitBranch] : [];
}

/** The distinct (host, repository, branch) keys the page's sessions ran on. */
function branchKeysOf(drives: BranchDrive[]): PullRequestBranchKey[] {
  const keys = new Map<string, PullRequestBranchKey>();
  for (const drive of drives) {
    const id = keyOf(drive);
    if (keys.has(id)) continue;
    keys.set(id, {
      repositoryHost: drive.repositoryHost,
      repositoryFullName: drive.repositoryFullName,
      headBranch: drive.headBranch,
    });
  }
  return [...keys.values()];
}

/**
 * Run the tenure rule over every (session, branch) pair and collect what each
 * session drove.
 *
 * The rule is asked per repository, because two repositories can host the same
 * branch name, and per pair, because a session's era on one branch says
 * nothing about its era on another. A recycled branch is exactly why the rule
 * is here at all: listing every pull request the branch ever hosted would
 * charge a session to a merged pull request from an era it never touched.
 */
function linkDrives({
  drives,
  candidates,
}: {
  drives: BranchDrive[];
  candidates: PullRequestCandidate[];
}): Map<string, SessionListPullRequest[]> {
  const found = new Map<string, Map<number, SessionListPullRequest>>();
  for (const [bucket, bucketDrives] of bucketByRepository(drives)) {
    const bucketCandidates = candidates.filter(
      (candidate) => repositoryBucketOf(candidate) === bucket,
    );
    if (bucketCandidates.length === 0) continue;
    for (const link of linkOneRepository({
      drives: bucketDrives,
      candidates: bucketCandidates,
    })) {
      const forSession = found.get(link.sessionId) ?? new Map();
      forSession.set(link.pullRequest.number, link.pullRequest);
      found.set(link.sessionId, forSession);
    }
  }

  return new Map(
    [...found].map(([sessionId, numbered]) => [
      sessionId,
      [...numbered.values()].sort((a, b) => a.number - b.number),
    ]),
  );
}

/** The page's (session, branch) pairs, grouped by the repository they ran on. */
function bucketByRepository(drives: BranchDrive[]): Map<string, BranchDrive[]> {
  const byRepository = new Map<string, BranchDrive[]>();
  for (const drive of drives) {
    const bucket = repositoryBucketOf(drive);
    const existing = byRepository.get(bucket);
    if (existing) existing.push(drive);
    else byRepository.set(bucket, [drive]);
  }
  return byRepository;
}

/**
 * One repository's share of the join: the tenure rule, then the winners.
 *
 * The rule answers one pull request per session id, so each (session, branch)
 * pair enters under a key of its own and the answers are collected back onto
 * the session by the caller.
 */
function linkOneRepository({
  drives,
  candidates,
}: {
  drives: BranchDrive[];
  candidates: PullRequestCandidate[];
}): Array<{ sessionId: string; pullRequest: SessionListPullRequest }> {
  const assignments = assignSessionsToPullRequests({
    sessions: drives.map((drive) => ({
      sessionId: driveKeyOf(drive),
      startedAtMs: drive.startedAtMs,
      headBranch: drive.headBranch,
    })),
    pullRequests: candidates.map((candidate) => ({
      prNumber: candidate.prNumber,
      headBranch: candidate.headBranch,
      prCreatedAtMs: candidate.prCreatedAt.getTime(),
      prClosedAtMs: candidate.prClosedAt?.getTime() ?? null,
      prMergedAtMs: candidate.prMergedAt?.getTime() ?? null,
    })),
  });

  const links: Array<{
    sessionId: string;
    pullRequest: SessionListPullRequest;
  }> = [];
  for (const drive of drives) {
    const prNumber = assignments.get(driveKeyOf(drive));
    const match = candidates.find(
      (candidate) => candidate.prNumber === prNumber,
    );
    if (!match) continue;
    links.push({
      sessionId: drive.sessionId,
      pullRequest: {
        number: match.prNumber,
        url: match.htmlUrl,
        title: match.title,
      },
    });
  }
  return links;
}

/** The (host, repository) half of the key, case-folded on both sides. */
const repositoryBucketOf = (key: {
  repositoryHost: string;
  repositoryFullName: string;
}): string =>
  `${key.repositoryHost.toLowerCase()} ${key.repositoryFullName.toLowerCase()}`;

const keyOf = (drive: BranchDrive): string =>
  `${repositoryBucketOf(drive)} ${drive.headBranch}`;

/** A (session, branch) pair's own id, for the one-answer-per-id rule. */
const driveKeyOf = (drive: BranchDrive): string =>
  `${drive.sessionId}\u0000${drive.headBranch}`;

/**
 * The stored row as the screen reads it. Empty strings stay empty strings for
 * the operational columns (the reader renders absence), while the title, which
 * is either something to show or nothing, becomes null.
 */
function toListRow(
  row: CodingAgentSessionRow,
  pullRequests: SessionListPullRequest[] | undefined,
): CodingAgentSessionListRow {
  return {
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
    pullRequests: pullRequests ?? [],
  };
}
