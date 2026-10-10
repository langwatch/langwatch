import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { GithubPullRequestStatusCacheRedisRepository } from "../redis.github-pull-request-status-cache.repository.ts";
import { GithubTokenCacheRedisRepository } from "../redis.github-token-cache.repository.ts";

const INSTALLATION = { host: "github.com", installationId: "99" };

describe("GithubTokenCacheRedisRepository", () => {
  describe("when a caller asks to keep a token longer than a minute", () => {
    it("stores it for a minute at most, in the same command", async () => {
      const redis = memoryRedisDouble();
      const cache = GithubTokenCacheRedisRepository.create(redis);

      await cache.storeToken({ ...INSTALLATION, scopeKey: "all", token: "ghs_1", ttlSec: 3_000 });

      expect(await redis.ttl("langy:gh:insttoken:99:all")).toBe(60);
    });
  });

  describe("when a caller asks for less than a minute", () => {
    it("keeps the shorter lifetime", async () => {
      const redis = memoryRedisDouble();
      const cache = GithubTokenCacheRedisRepository.create(redis);

      await cache.markLiveness({ ...INSTALLATION, value: "backoff", ttlSec: 30 });

      expect(await redis.ttl("langy:gh:insttoken:99:liveness")).toBe(30);
    });
  });
});

describe("GithubPullRequestStatusCacheRedisRepository", () => {
  it("stores a status with its one-minute expiry in the same command", async () => {
    const redis = memoryRedisDouble();
    const cache = GithubPullRequestStatusCacheRedisRepository.create(redis);

    await cache.storeStatus({
      organizationId: "org-1",
      ref: { repositoryHost: "github.com", repositoryFullName: "acme/app", prNumber: 7 },
      status: "open",
    });

    expect(await redis.ttl("gh:prstatus:org-1:github.com:acme/app:7")).toBe(60);
  });
});
