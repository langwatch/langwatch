/**
 * The PR cap is the only thing standing between a runaway worker (bad skill, prompt-injected pull)
 * and a user's GitHub account getting flagged for abuse. It counts pull requests that opened.
 * @vitest-environment node
 */
import { nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LangyGithubPrCountMemoryRepository } from "../../../../repositories/memory/memory.langy-github-pr-count.repository.ts";
import {
  type LangyGithubPrCountRedis,
  LangyGithubPrCountRedisRepository,
} from "../../../../repositories/redis/redis.langy-github-pr-count.repository.ts";
import { LangyGithubPrQuotaService } from "../langy-github-pr-quota.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function memoryQuota() {
  return LangyGithubPrQuotaService.create({ counts: LangyGithubPrCountMemoryRepository.create() });
}

describe("LangyGithubPrQuotaService", () => {
  describe("given three pull requests opened today", () => {
    /** @scenario "The daily cap counts pull requests that opened, not turns" */
    it("leaves the rest of the day's cap", async () => {
      const quota = memoryQuota();
      const at = nowInstant().epochMilliseconds;

      await quota.recordOpened({ userId: "u1", pullRequests: ["acme/a#1", "acme/a#2"], at });
      await quota.recordOpened({ userId: "u1", pullRequests: ["acme/b#7"], at });

      expect(await quota.usage({ userId: "u1", limit: 20 })).toMatchObject({
        allowed: true,
        remaining: 17,
      });
    });
  });

  describe("when the same pull request is counted twice", () => {
    /** @scenario "Pushing to a pull request already opened does not count again" */
    it("counts it once", async () => {
      const quota = memoryQuota();
      const at = nowInstant().epochMilliseconds;

      await quota.recordOpened({ userId: "u1", pullRequests: ["acme/a#1"], at });
      await quota.recordOpened({ userId: "u1", pullRequests: ["acme/a#1"], at });

      expect((await quota.usage({ userId: "u1", limit: 20 })).remaining).toBe(19);
    });
  });

  describe("given the per-day maximum already opened", () => {
    it("refuses until the day rolls over", async () => {
      const quota = memoryQuota();
      const at = nowInstant().epochMilliseconds;
      const pullRequests = Array.from({ length: 20 }, (_, n) => `acme/a#${n + 1}`);

      await quota.recordOpened({ userId: "u1", pullRequests, at });

      const usage = await quota.usage({ userId: "u1", limit: 20 });
      expect(usage).toMatchObject({ allowed: false, remaining: 0 });
      expect(usage.resetAt).toBe((Math.floor(at / DAY_MS) + 1) * DAY_MS);
      expect((await quota.usage({ userId: "u2", limit: 20 })).allowed).toBe(true);
    });
  });

  describe("given pull requests opened yesterday", () => {
    it("does not count them against today", async () => {
      const quota = memoryQuota();
      const yesterday = nowInstant().epochMilliseconds - DAY_MS;
      const pullRequests = Array.from({ length: 20 }, (_, n) => `acme/a#${n + 1}`);

      await quota.recordOpened({ userId: "u1", pullRequests, at: yesterday });

      expect((await quota.usage({ userId: "u1", limit: 20 })).allowed).toBe(true);
    });
  });
});

describe("LangyGithubPrQuotaService on Redis", () => {
  const scard = vi.fn<(key: string) => Promise<number>>();
  const sadd = vi.fn<(key: string, ...members: string[]) => Promise<number>>();
  const expire = vi.fn<(key: string, seconds: number) => Promise<number>>();
  const redis: LangyGithubPrCountRedis = { scard, sadd, expire };
  const quota = LangyGithubPrQuotaService.create({
    counts: LangyGithubPrCountRedisRepository.create({ redis }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the API process composed a Redis connection", () => {
    /** @scenario "The API process meters the daily pull-request cap on its own Redis" */
    it("keeps each user's pull requests in their own day bucket, with a two-day lifetime", async () => {
      sadd.mockResolvedValue(1);
      expire.mockResolvedValue(1);
      const at = nowInstant().epochMilliseconds;

      await quota.recordOpened({ userId: "u1", pullRequests: ["acme/a#1"], at });
      await quota.recordOpened({ userId: "u2", pullRequests: ["acme/a#2"], at });

      const keys = sadd.mock.calls.map(([key]) => key);
      expect(keys[0]).toMatch(/^langy:gh:prs-opened:u1:\d+$/);
      expect(keys[1]).toMatch(/^langy:gh:prs-opened:u2:\d+$/);
      expect(sadd).toHaveBeenCalledWith(keys[0], "acme/a#1");
      expect(expire).toHaveBeenCalledWith(keys[0], 60 * 60 * 24 * 2);
    });
  });

  describe("when the counter cannot be reached at all", () => {
    /** @scenario "A deployment with no counter never denies a pull request" */
    it("allows the pull request", async () => {
      scard.mockRejectedValue(new Error("no redis connection"));

      const usage = await quota.usage({ userId: "u1", limit: 20 });

      expect(usage).toMatchObject({ allowed: true, remaining: 20 });
    });
  });
});
