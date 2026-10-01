import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";

import type { GithubRepositories } from "../../repositories/github.repositories.ts";
import { GithubInstallNonceRedisRepository } from "../../repositories/redis/redis.github-install-nonce.repository.ts";
import { GithubPullRequestStatusCacheRedisRepository } from "../../repositories/redis/redis.github-pull-request-status-cache.repository.ts";
import { GithubTokenCacheRedisRepository } from "../../repositories/redis/redis.github-token-cache.repository.ts";

/** The live short-lived rows over a Redis that answers nothing: reads miss, no lock is taken. */
export function unansweredRedisRepositories(): Pick<
  GithubRepositories,
  "installNonces" | "pullRequestStatusCache" | "tokenCache"
> {
  const redis = redisDouble();
  return {
    installNonces: GithubInstallNonceRedisRepository.create(redis),
    pullRequestStatusCache: GithubPullRequestStatusCacheRedisRepository.create(redis),
    tokenCache: GithubTokenCacheRedisRepository.create(redis),
  };
}
