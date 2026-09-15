import type { GithubPullRequest } from "@langwatch/github-contract";

/** A pull request as the branch-assignment pass reads it: numbers and epoch milliseconds. */
export function assignablePullRequests(pullRequests: readonly GithubPullRequest[]): Array<{
  prNumber: number;
  headBranch: string;
  prCreatedAtMs: number;
  prClosedAtMs: number | null;
  prMergedAtMs: number | null;
}> {
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
