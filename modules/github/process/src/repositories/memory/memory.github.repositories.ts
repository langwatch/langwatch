import type { GithubRepositories } from "../github.repositories.ts";
import { MemoryGithubInstallNonceRepository } from "./memory.github-install-nonce.repository.ts";
import { MemoryGithubInstallationsRepository } from "./memory.github-installations.repository.ts";
import { MemoryGithubPullRequestStatusCacheRepository } from "./memory.github-pull-request-status-cache.repository.ts";
import { MemoryGithubPullRequestsRepository } from "./memory.github-pull-requests.repository.ts";
import { MemoryGithubTokenCacheRepository } from "./memory.github-token-cache.repository.ts";
import { MemoryGithubDatabase } from "./memory.github.database.ts";

export class MemoryGithubRepositories {
  static readonly requires = [] as const;

  static create(): GithubRepositories {
    const memory = MemoryGithubDatabase.create();

    return {
      installations: MemoryGithubInstallationsRepository.create({ memory }),
      pullRequests: MemoryGithubPullRequestsRepository.create({ memory }),
      installNonces: MemoryGithubInstallNonceRepository.create({ memory }),
      pullRequestStatusCache: MemoryGithubPullRequestStatusCacheRepository.create({ memory }),
      tokenCache: MemoryGithubTokenCacheRepository.create({ memory }),
    };
  }
}
