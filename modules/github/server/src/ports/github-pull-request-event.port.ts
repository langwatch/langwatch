import type { GithubPullRequestEvent } from "@langwatch/github-contract";

export abstract class GithubPullRequestEventPort {
  abstract tryParse(payload: unknown): GithubPullRequestEvent | null;
}
