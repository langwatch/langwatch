import type { GithubInstallationsRepository } from "./github-installations.repository.ts";
import type { GithubPullRequestsRepository } from "./github-pull-requests.repository.ts";

/** The two row sets the GitHub connection owns, chosen once at boot. */
export interface GithubRepositories {
  readonly installations: GithubInstallationsRepository;
  readonly pullRequests: GithubPullRequestsRepository;
}
