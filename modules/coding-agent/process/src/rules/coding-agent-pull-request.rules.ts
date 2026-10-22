import type { GithubPullRequest } from "@langwatch/github-contract";

/** A pull request as the branch-assignment pass reads it: numbers and epoch milliseconds. */
export function assignablePullRequests(pullRequests: readonly GithubPullRequest[]): {
  prNumber: number;
  headBranch: string;
  prCreatedAtMs: number;
  prClosedAtMs: number | null;
  prMergedAtMs: number | null;
}[] {
  return pullRequests.map((pullRequest) => ({
    prNumber: pullRequest.prNumber,
    headBranch: pullRequest.headBranch,
    prCreatedAtMs: pullRequest.prCreatedAt.getTime(),
    prClosedAtMs: pullRequest.prClosedAt?.getTime() ?? null,
    prMergedAtMs: pullRequest.prMergedAt?.getTime() ?? null,
  }));
}

/** The fields every pull-request row identifies itself by, whatever the read behind it. */
export function pullRequestIdentity(pullRequest: GithubPullRequest): {
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
  headBranch: string;
  htmlUrl: string;
  state: GithubPullRequest["state"];
  isDraft: boolean;
  authorLogin: GithubPullRequest["authorLogin"];
  prCreatedAtMs: number;
  prClosedAtMs: number | null;
  prMergedAtMs: number | null;
} {
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

/**
 * A cost made only of usage no price list covers is unknown, never a confident zero. No usage
 * at all says nothing about the price, so the recorded cost stands.
 */
export function isCostUnknown(usage: readonly { priced: boolean }[]): boolean {
  return usage.length > 0 && usage.every((each) => !each.priced);
}

type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

const tokenSum = (counts: TokenCounts): number =>
  counts.inputTokens + counts.outputTokens + counts.cacheReadTokens + counts.cacheCreationTokens;

/**
 * Whether a session's per-model record accounts for every token it counted. Only then may it
 * stand for the session's models: a row folded partly before the record existed misses calls.
 */
export function isModelRecordComplete(
  session: TokenCounts & { usageByModel: readonly TokenCounts[] },
): boolean {
  if (session.usageByModel.length === 0) return false;
  const recorded = session.usageByModel.reduce((sum, usage) => sum + tokenSum(usage), 0);
  return recorded === tokenSum(session);
}
