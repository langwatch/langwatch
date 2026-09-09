import type { GithubRepositories } from "../github.repositories.ts";
import { MemoryGithubDatabase } from "./memory.github.database.ts";
import { MemoryGithubInstallationsRepository } from "./memory.github-installations.repository.ts";
import { MemoryGithubPullRequestsRepository } from "./memory.github-pull-requests.repository.ts";

export class MemoryGithubRepositories {
  static readonly requires = [] as const;

  static create(): GithubRepositories {
    const memory = MemoryGithubDatabase.create();

    return {
      installations: MemoryGithubInstallationsRepository.create({ memory }),
      pullRequests: MemoryGithubPullRequestsRepository.create({ memory }),
    };
  }
}
