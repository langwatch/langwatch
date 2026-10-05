/**
 * The PR cap is the only thing standing between a runaway worker (bad skill, prompt-injected pull)
 * and a user's GitHub account getting flagged for abuse.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type LangyGithubPrCountRedis,
  LangyGithubPrCountRedisRepository,
} from "../../repositories/redis/redis.langy-github-pr-count.repository.ts";
import { LangyGithubPrQuotaService } from "../langy-github-pr-quota.service.ts";

const get = vi.fn<(key: string) => Promise<string | null>>();
const incr = vi.fn<(key: string, amount: number) => Promise<number>>();
const decr = vi.fn<(key: string) => Promise<number>>();
const expire = vi.fn<(key: string, seconds: number) => Promise<number>>();
const floored = vi.fn<(script: string, numKeys: number, ...args: string[]) => Promise<unknown>>();

/** The deployment's Redis, as the count repository drives it. */
const redis: LangyGithubPrCountRedis = { get, incrby: incr, decr, expire, eval: floored };

const counts = LangyGithubPrCountRedisRepository.create({ redis });
const quota = LangyGithubPrQuotaService.create({ counts });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LangyGithubPrQuotaService.usage", () => {
  describe("when the counter is below the cap", () => {
    it("reports remaining as cap minus count and allowed=true", async () => {
      get.mockResolvedValue("5");
      const out = await quota.usage({ userId: "u1", limit: 20 });
      expect(out).toMatchObject({ allowed: true, remaining: 15 });
    });
  });

  describe("when the counter is at the cap", () => {
    it("reports allowed=false and remaining=0", async () => {
      get.mockResolvedValue("20");
      const out = await quota.usage({ userId: "u1", limit: 20 });
      expect(out).toMatchObject({ allowed: false, remaining: 0 });
    });
  });
});

describe("LangyGithubPrQuotaService.record", () => {
  describe("given the first PR of the day", () => {
    it("increments and sets a 2-day TTL on the bucket key", async () => {
      incr.mockResolvedValue(1);
      expire.mockResolvedValue(1);
      const out = await quota.record({ userId: "u1", limit: 20 });
      expect(incr).toHaveBeenCalledTimes(1);
      expect(expire).toHaveBeenCalledWith(
        expect.stringContaining("langy:gh:prs:u1:"),
        60 * 60 * 24 * 2,
      );
      expect(out).toMatchObject({ allowed: true, remaining: 19 });
    });
  });

  describe("when this increment crosses the cap", () => {
    it("returns allowed=false on the post-increment count", async () => {
      incr.mockResolvedValue(21);
      const out = await quota.record({ userId: "u1", limit: 20 });
      expect(out.allowed).toBe(false);
      expect(out.remaining).toBe(0);
    });
  });

  describe("when Redis throws mid-increment", () => {
    it("fails open — chat must not break because the counter is sick", async () => {
      incr.mockRejectedValue(new Error("boom"));
      const out = await quota.record({ userId: "u1", limit: 20 });
      expect(out).toMatchObject({ allowed: true, remaining: 20 });
    });
  });
});

describe("LangyGithubPrQuotaService.reservePermit", () => {
  describe("when the reservation lands within the cap", () => {
    it("INCRs once and returns allowed=true with no DECR", async () => {
      incr.mockResolvedValue(5);
      const out = await quota.reservePermit({
        userId: "u1",
        limit: 20,
      });
      expect(incr).toHaveBeenCalledTimes(1);
      expect(decr).not.toHaveBeenCalled();
      expect(out).toMatchObject({ allowed: true, remaining: 15 });
    });
  });

  describe("when the reservation would push past the cap", () => {
    it("rolls back via DECR and returns allowed=false", async () => {
      incr.mockResolvedValue(21);
      decr.mockResolvedValue(20);
      const out = await quota.reservePermit({
        userId: "u1",
        limit: 20,
      });
      expect(incr).toHaveBeenCalledTimes(1);
      // DECR must run, otherwise N concurrent over-cap reservers each leave
      // the counter inflated by 1 and the user is silently locked out beyond
      // the legitimate cap until the bucket rolls.
      expect(decr).toHaveBeenCalledTimes(1);
      expect(out).toMatchObject({ allowed: false, remaining: 0 });
    });
  });

  describe("when two requests race the same bucket", () => {
    it("only one is granted; the loser sees DECR and allowed=false", async () => {
      // Simulated atomic INCR across two callers at count=20 (one slot left):
      // winner sees post-count=20 (granted), loser sees post-count=21 (denied
      // → rolls back to 20). This is what makes the cap an enforced boundary
      // instead of a TOCTOU advisory.
      incr.mockResolvedValueOnce(20).mockResolvedValueOnce(21);
      decr.mockResolvedValue(20);
      const [winner, loser] = await Promise.all([
        quota.reservePermit({ userId: "u1", limit: 20 }),
        quota.reservePermit({ userId: "u1", limit: 20 }),
      ]);
      expect(winner.allowed).toBe(true);
      expect(loser.allowed).toBe(false);
      expect(decr).toHaveBeenCalledTimes(1);
    });
  });
});

describe("LangyGithubPrQuotaService.releasePermit", () => {
  describe("when called for a turn that opened no PR", () => {
    /** @scenario "Permit must be released on every non-PR exit" */
    it("gives the slot back through the floored decrement, never below zero", async () => {
      floored.mockResolvedValue(4);
      await quota.releasePermit({ userId: "u1" });
      expect(floored).toHaveBeenCalledTimes(1);
      expect(floored.mock.calls[0]?.[2]).toMatch(/^langy:gh:prs:u1:/);
    });
  });
});
