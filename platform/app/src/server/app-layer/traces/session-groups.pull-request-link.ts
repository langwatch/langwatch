/**
 * Attaching a session to the pull request its branch's history says it
 * belongs to.
 *
 * Its own module because it is a join across a different bounded context: the
 * lens read knows about conversations and rollups, this knows about remotes,
 * branches and pull-request tenure. It reaches the lens only through the two
 * structural shapes below, so the read model can change without the join
 * noticing, and the join can be exercised without a page of rollups.
 */
import { assignSessionsToPullRequests } from "../coding-agent/pull-request-assignment";
import { GithubCompositionAdapter } from "@langwatch/github-server";
import { env } from "~/env.mjs";

const normalizeGithubHost = (host: string) =>
  GithubCompositionAdapter.normalizeGithubHost(host, {
    host: env.GITHUB_LANGY_HOST,
  });

/** Identity only: the number, where it lives, and what it is called. */
export interface SessionGroupPullRequestDto {
  number: number;
  htmlUrl: string;
  title: string;
}

/**
 * The narrow slice of the pull-request mapping this read needs: every pull
 * request the page's branches have ever hosted, in one call. The neighbours
 * matter as much as the matches: the tenure rule cannot tell where one pull
 * request's era ends without the one that succeeded it.
 */
export interface GithubPullRequestLookup {
  findForBranches(args: {
    organizationId: string;
    keys: ReadonlyArray<PullRequestBranchKey>;
  }): Promise<
    ReadonlyArray<{
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
      prNumber: number;
      htmlUrl: string;
      title: string;
      prCreatedAt: Date;
      prClosedAt: Date | null;
      prMergedAt: Date | null;
    }>
  >;
}

/** Never links a session to a pull request. The default, and the test preset. */
export class NullGithubPullRequestLookup implements GithubPullRequestLookup {
  async findForBranches(): Promise<
    Awaited<ReturnType<GithubPullRequestLookup["findForBranches"]>>
  > {
    return [];
  }
}

export interface PullRequestBranchKey {
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
}

type PullRequestCandidate = Awaited<
  ReturnType<GithubPullRequestLookup["findForBranches"]>
>[number];

/**
 * Where a session ran, and the slot the winning pull request lands in. The
 * link is written back onto this object, so the caller reads the result off
 * the same enrichment it handed in.
 */
export interface LinkableCodingAgent {
  repositoryHost: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  gitBranch: string | null;
  pullRequest: SessionGroupPullRequestDto | null;
}

/** The part of a page row the tenure rule reads: which session, and when. */
export interface LinkableRow {
  conversationId: string;
  startedAtMs: number;
}

/** A page row paired with the coding-agent enrichment that can be linked. */
export interface LinkableSession {
  row: LinkableRow;
  coding: LinkableCodingAgent;
}

/**
 * The rows carrying enough git identity to stand a chance of matching: owner,
 * repository and branch. Anything short of all three can never be linked.
 */
export function linkableSessions({
  rows,
  enrichments,
}: {
  rows: LinkableRow[];
  enrichments: (LinkableCodingAgent | null)[];
}): LinkableSession[] {
  const linkable: LinkableSession[] = [];
  rows.forEach((row, index) => {
    const coding = enrichments[index] ?? null;
    if (!coding?.repositoryOwner) return;
    if (!coding.repositoryName || !coding.gitBranch) return;
    linkable.push({ row, coding });
  });
  return linkable;
}

/** The distinct (host, repository, branch) keys the page's sessions ran on. */
export function branchKeysOf(linkable: LinkableSession[]): PullRequestBranchKey[] {
  const keys = new Map<string, PullRequestBranchKey>();
  for (const { coding } of linkable) {
    const key = branchKeyOf(coding);
    const id = keyOf(key);
    if (!keys.has(id)) keys.set(id, key);
  }
  return [...keys.values()];
}

/**
 * Run the tenure rule over the page and stamp the winners.
 *
 * Per (host, repository) bucket rather than over the page as a whole: the
 * tenure rule is per-branch, and two repositories can share a branch name.
 */
export function linkPullRequestsToSessions({
  linkable,
  pullRequests,
}: {
  linkable: LinkableSession[];
  pullRequests: PullRequestCandidate[];
}): void {
  for (const [bucket, sessions] of bucketByRepository(linkable)) {
    const candidates = pullRequests.filter((pull) => repositoryBucketOf(pull) === bucket);
    if (candidates.length === 0) continue;
    linkOneRepository({ sessions, candidates });
  }
}

/** Group the linkable sessions by the (host, repository) they ran against. */
function bucketByRepository(linkable: LinkableSession[]): Map<string, LinkableSession[]> {
  const byRepository = new Map<string, LinkableSession[]>();
  for (const entry of linkable) {
    const bucket = repositoryBucketOf(branchKeyOf(entry.coding));
    const existing = byRepository.get(bucket);
    if (existing) existing.push(entry);
    else byRepository.set(bucket, [entry]);
  }
  return byRepository;
}

/** Run the tenure rule over one repository's sessions and stamp the winners. */
function linkOneRepository({
  sessions,
  candidates,
}: {
  sessions: LinkableSession[];
  candidates: PullRequestCandidate[];
}): void {
  const assignments = assignSessionsToPullRequests({
    sessions: sessions.map(({ row, coding }) => ({
      sessionId: row.conversationId,
      startedAtMs: row.startedAtMs,
      headBranch: coding.gitBranch!,
    })),
    pullRequests: candidates.map((pull) => ({
      prNumber: pull.prNumber,
      headBranch: pull.headBranch,
      prCreatedAtMs: pull.prCreatedAt.getTime(),
      prClosedAtMs: pull.prClosedAt?.getTime() ?? null,
      prMergedAtMs: pull.prMergedAt?.getTime() ?? null,
    })),
  });
  for (const { row, coding } of sessions) {
    const prNumber = assignments.get(row.conversationId);
    const match = candidates.find((pull) => pull.prNumber === prNumber);
    if (!match) continue;
    coding.pullRequest = {
      number: match.prNumber,
      htmlUrl: match.htmlUrl,
      title: match.title,
    };
  }
}

const keyOf = (key: PullRequestBranchKey): string =>
  `${repositoryBucketOf(key)} ${key.headBranch}`;

/**
 * The (host, repository) half of the key, case-folded.
 *
 * Applied to both sides of the join, the way the session read folds
 * `lower(RepositoryHost)` on both sides of its own: a session stores the
 * remote's own casing, hosts are case insensitive, and folding one side only
 * means a session whose remote reads `GitHub.com` buckets away from the
 * mapping row that describes it and links to no pull request at all. The
 * branch name is never folded, because `feat/X` and `feat/x` really are two
 * branches.
 */
const repositoryBucketOf = (key: {
  repositoryHost: string;
  repositoryFullName: string;
}): string =>
  `${key.repositoryHost.toLowerCase()} ${key.repositoryFullName.toLowerCase()}`;

/** The session's git identity as the mapping stores it: default host, lowercased repository. */
function branchKeyOf(coding: LinkableCodingAgent): PullRequestBranchKey {
  return {
    repositoryHost: normalizeGithubHost(coding.repositoryHost ?? ""),
    repositoryFullName:
      `${coding.repositoryOwner}/${coding.repositoryName}`.toLowerCase(),
    headBranch: coding.gitBranch!,
  };
}
