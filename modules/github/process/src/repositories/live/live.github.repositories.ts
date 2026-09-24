import type { ProcessMembers } from "@langwatch/process-stores/members";

import type { GithubRepositories } from "../github.repositories.ts";
import { PostgresGithubRepositories } from "../prisma/prisma.github.repositories.ts";
import { GithubInstallNonceRedisRepository } from "../redis/redis.github-install-nonce.repository.ts";
import { GithubPullRequestStatusCacheRedisRepository } from "../redis/redis.github-pull-request-status-cache.repository.ts";
import { GithubTokenCacheRedisRepository } from "../redis/redis.github-token-cache.repository.ts";

/** GitHub's live stores: durable rows in Prisma, nonces and caches in Redis. */
export class LiveGithubRepositories {
  static readonly requires = ["prisma", "redis"] as const;

  static create({
    prisma,
    redis,
  }: {
    prisma: ProcessMembers["prisma"];
    redis: ProcessMembers["redis"];
  }): GithubRepositories {
    return {
      ...PostgresGithubRepositories.create({ prisma }),
      installNonces: GithubInstallNonceRedisRepository.create(redis),
      pullRequestStatusCache: GithubPullRequestStatusCacheRedisRepository.create(redis),
      tokenCache: GithubTokenCacheRedisRepository.create(redis),
    };
  }
}
