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
const decr = vi.fn();
const expire = vi.fn();

const fakeRedis = {
  get: (...a: unknown[]) => get(...a),
  incr: (...a: unknown[]) => incr(...a),
  decr: (...a: unknown[]) => decr(...a),
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

describe("reserveLangyGithubPrPermit", () => {
  describe("when the reservation lands within the cap", () => {
    it("INCRs once and returns allowed=true with no DECR", async () => {
      (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = fakeRedis;
      incr.mockResolvedValue(5);
      const { reserveLangyGithubPrPermit } = await load();
      const out = await reserveLangyGithubPrPermit({
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
      (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = fakeRedis;
      incr.mockResolvedValue(21);
      decr.mockResolvedValue(20);
      const { reserveLangyGithubPrPermit } = await load();
      const out = await reserveLangyGithubPrPermit({
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

  describe("when Redis is unavailable", () => {
    it("fails open — does not strip GitHub from every connected user", async () => {
      const { reserveLangyGithubPrPermit, LANGY_GITHUB_PRS_PER_DAY } =
        await load();
      const out = await reserveLangyGithubPrPermit({ userId: "u1" });
      expect(out).toMatchObject({
        allowed: true,
        remaining: LANGY_GITHUB_PRS_PER_DAY,
      });
    });
  });

  describe("when two requests race the same bucket", () => {
    it("only one is granted; the loser sees DECR and allowed=false", async () => {
      (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = fakeRedis;
      // Simulated atomic INCR across two callers at count=20 (one slot left):
      // winner sees post-count=20 (granted), loser sees post-count=21 (denied
      // → rolls back to 20). This is what makes the cap an enforced boundary
      // instead of a TOCTOU advisory.
      incr.mockResolvedValueOnce(20).mockResolvedValueOnce(21);
      decr.mockResolvedValue(20);
      const { reserveLangyGithubPrPermit } = await load();
      const [winner, loser] = await Promise.all([
        reserveLangyGithubPrPermit({ userId: "u1", limit: 20 }),
        reserveLangyGithubPrPermit({ userId: "u1", limit: 20 }),
      ]);
      expect(winner.allowed).toBe(true);
      expect(loser.allowed).toBe(false);
      expect(decr).toHaveBeenCalledTimes(1);
    });
  });
});

describe("releaseLangyGithubPrPermit", () => {
  describe("when called for a turn that opened no PR", () => {
    it("DECRs to return the slot to the daily pool", async () => {
      (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = fakeRedis;
      decr.mockResolvedValue(4);
      const { releaseLangyGithubPrPermit } = await load();
      await releaseLangyGithubPrPermit({ userId: "u1" });
      expect(decr).toHaveBeenCalledTimes(1);
    });
  });

  describe("when Redis is unavailable", () => {
    it("is a no-op (best-effort fairness, not a correctness boundary)", async () => {
      const { releaseLangyGithubPrPermit } = await load();
      await expect(
        releaseLangyGithubPrPermit({ userId: "u1" }),
      ).resolves.toBeUndefined();
    });
  });
});
