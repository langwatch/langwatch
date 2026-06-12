/**
 * @vitest-environment node
 *
 * The PR cap is the only thing standing between a runaway worker (bad
 * skill, prompt-injected pull) and a user's GitHub account getting flagged
 * for abuse. Pin the counter math here:
 *  - no Redis → fails open (dev box stays usable)
 *  - first bump sets a 2-day TTL (no counter leakage across day buckets)
 *  - the post-increment count drives `allowed` / `remaining`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const incr = vi.fn();
const expire = vi.fn();

const fakeRedis = {
  get: (...a: unknown[]) => get(...a),
  incr: (...a: unknown[]) => incr(...a),
  expire: (...a: unknown[]) => expire(...a),
};

vi.mock("../../redis", () => ({
  get connection() {
    return (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ ?? null;
  },
}));

async function load() {
  vi.resetModules();
  return await import("../rate-limit-langy-github-prs");
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = null;
});

describe("getLangyGithubPrUsage", () => {
  describe("when Redis is unavailable", () => {
    it("fails open — user is allowed and full quota remains", async () => {
      const { getLangyGithubPrUsage, LANGY_GITHUB_PRS_PER_DAY } = await load();
      const out = await getLangyGithubPrUsage({ userId: "u1" });
      expect(out.allowed).toBe(true);
      expect(out.remaining).toBe(LANGY_GITHUB_PRS_PER_DAY);
    });
  });

  describe("when the counter is below the cap", () => {
    it("reports remaining as cap minus count and allowed=true", async () => {
      (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = fakeRedis;
      get.mockResolvedValue("5");
      const { getLangyGithubPrUsage } = await load();
      const out = await getLangyGithubPrUsage({ userId: "u1", limit: 20 });
      expect(out).toMatchObject({ allowed: true, remaining: 15 });
    });
  });

  describe("when the counter is at the cap", () => {
    it("reports allowed=false and remaining=0", async () => {
      (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = fakeRedis;
      get.mockResolvedValue("20");
      const { getLangyGithubPrUsage } = await load();
      const out = await getLangyGithubPrUsage({ userId: "u1", limit: 20 });
      expect(out).toMatchObject({ allowed: false, remaining: 0 });
    });
  });
});

describe("recordLangyGithubPr", () => {
  describe("on first PR of the day", () => {
    it("increments and sets a 2-day TTL on the bucket key", async () => {
      (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = fakeRedis;
      incr.mockResolvedValue(1);
      expire.mockResolvedValue(1);
      const { recordLangyGithubPr } = await load();
      const out = await recordLangyGithubPr({ userId: "u1", limit: 20 });
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
      (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = fakeRedis;
      incr.mockResolvedValue(21);
      const { recordLangyGithubPr } = await load();
      const out = await recordLangyGithubPr({ userId: "u1", limit: 20 });
      expect(out.allowed).toBe(false);
      expect(out.remaining).toBe(0);
    });
  });

  describe("when Redis throws mid-increment", () => {
    it("fails open — chat must not break because the counter is sick", async () => {
      (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = fakeRedis;
      incr.mockRejectedValue(new Error("boom"));
      const { recordLangyGithubPr } = await load();
      const out = await recordLangyGithubPr({ userId: "u1", limit: 20 });
      expect(out).toMatchObject({ allowed: true, remaining: 20 });
    });
  });
});
