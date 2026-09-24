import type { GithubInstallNonceRepository } from "./github-install-nonce.repository.ts";
import type { GithubInstallationsRepository } from "./github-installations.repository.ts";
import type { GithubPullRequestStatusCacheRepository } from "./github-pull-request-status-cache.repository.ts";
import type { GithubPullRequestsRepository } from "./github-pull-requests.repository.ts";
import type { GithubTokenCacheRepository } from "./github-token-cache.repository.ts";

/** The durable rows and the short-lived rows the GitHub connection owns, chosen once at boot. */
export interface GithubRepositories {
  readonly installations: GithubInstallationsRepository;
  readonly pullRequests: GithubPullRequestsRepository;
  readonly installNonces: GithubInstallNonceRepository;
  readonly pullRequestStatusCache: GithubPullRequestStatusCacheRepository;
  readonly tokenCache: GithubTokenCacheRepository;
}
