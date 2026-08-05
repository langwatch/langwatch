import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkReportRateLimit,
  REPORTS_WITH_ANALYSIS_PER_MINUTE,
} from "../report-rate-limit";

/**
 * The only control this feature has on model spend.
 *
 * Exercised against an in-memory Redis rather than mocked away, because the
 * behaviour worth pinning is the arithmetic between the counter and the clock:
 * which bucket a request lands in, that only the first write sets the expiry,
 * and what the caller is told to wait. A mock of the limiter itself proves
 * none of that, which is how it came to have no executed coverage at all.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const warn = vi.hoisted(() => vi.fn());
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const redisState = vi.hoisted(() => ({
  counters: new Map<string, number>(),
  expiries: new Map<string, number>(),
  failNext: false,
  connection: undefined as unknown,
}));

vi.mock("~/server/redis", () => ({
  get connection() {
    return redisState.connection;
  },
}));

function fakeRedis() {
  return {
    incr: async (key: string) => {
      if (redisState.failNext) throw new Error("redis is down");
      const next = (redisState.counters.get(key) ?? 0) + 1;
      redisState.counters.set(key, next);
      return next;
    },
    expire: async (key: string, seconds: number) => {
      redisState.expiries.set(key, (redisState.expiries.get(key) ?? 0) + 1);
      redisState.counters.set(`${key}:ttl`, seconds);
      return 1;
    },
  };
}

const CALLER = { userId: "user_1", projectId: "project_1" };

/** A wall-clock reading 20 seconds into a known minute. */
const INSIDE_A_MINUTE =
  1_700_000_000_000 - (1_700_000_000_000 % 60_000) + 20_000;

describe("checkReportRateLimit()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisState.counters.clear();
    redisState.expiries.clear();
    redisState.failNext = false;
    redisState.connection = fakeRedis();
  });

  describe("given requests inside one minute", () => {
    /** @scenario Starting too many analysed reports in a minute is refused */
    it("allows up to the limit and refuses the next one", async () => {
      const results = [];
      for (let attempt = 0; attempt < 4; attempt++) {
        results.push(
          await checkReportRateLimit({
            ...CALLER,
            limit: 3,
            now: INSIDE_A_MINUTE,
          }),
        );
      }

      expect(results.map((result) => result.isAllowed)).toEqual([
        true,
        true,
        true,
        false,
      ]);
    });

    it("tells the caller how long is left of the minute it is in", async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await checkReportRateLimit({
          ...CALLER,
          limit: 3,
          now: INSIDE_A_MINUTE,
        });
      }

      const refused = await checkReportRateLimit({
        ...CALLER,
        limit: 3,
        now: INSIDE_A_MINUTE,
      });

      // 20 seconds into the minute, so 40 remain.
      expect(refused.retryAfterSeconds).toBe(40);
    });

    it("never tells the caller to wait zero seconds at the boundary", async () => {
      const lastMillisecond = INSIDE_A_MINUTE - 20_000 + 59_999;
      for (let attempt = 0; attempt < 3; attempt++) {
        await checkReportRateLimit({
          ...CALLER,
          limit: 3,
          now: lastMillisecond,
        });
      }

      const refused = await checkReportRateLimit({
        ...CALLER,
        limit: 3,
        now: lastMillisecond,
      });

      expect(refused.retryAfterSeconds).toBe(1);
    });

    it("sets the expiry only on the first write of the bucket", async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await checkReportRateLimit({
          ...CALLER,
          limit: 3,
          now: INSIDE_A_MINUTE,
        });
      }

      expect([...redisState.expiries.values()]).toEqual([1]);
    });
  });

  describe("given the window has slid into the next minute", () => {
    /** @scenario The allowance returns with the next minute */
    it("allows the caller again", async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        await checkReportRateLimit({
          ...CALLER,
          limit: 3,
          now: INSIDE_A_MINUTE,
        });
      }

      const afterTheMinute = await checkReportRateLimit({
        ...CALLER,
        limit: 3,
        now: INSIDE_A_MINUTE + 60_000,
      });

      expect(afterTheMinute.isAllowed).toBe(true);
    });
  });

  describe("given two callers", () => {
    it("counts each user and project separately", async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        await checkReportRateLimit({
          ...CALLER,
          limit: 3,
          now: INSIDE_A_MINUTE,
        });
      }

      const otherUser = await checkReportRateLimit({
        userId: "user_2",
        projectId: CALLER.projectId,
        limit: 3,
        now: INSIDE_A_MINUTE,
      });
      const otherProject = await checkReportRateLimit({
        userId: CALLER.userId,
        projectId: "project_2",
        limit: 3,
        now: INSIDE_A_MINUTE,
      });

      expect(otherUser.isAllowed).toBe(true);
      expect(otherProject.isAllowed).toBe(true);
    });
  });

  describe("given Redis is unavailable", () => {
    it("allows the request when there is no connection at all", async () => {
      redisState.connection = undefined;

      const result = await checkReportRateLimit({ ...CALLER, limit: 3 });

      expect(result).toEqual({ isAllowed: true, retryAfterSeconds: 0 });
    });

    /** @scenario The limit steps aside when it cannot be counted */
    it("fails open and warns when the command errors", async () => {
      redisState.failNext = true;

      const result = await checkReportRateLimit({ ...CALLER, limit: 3 });

      expect(result).toEqual({ isAllowed: true, retryAfterSeconds: 0 });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_1" }),
        expect.stringContaining("failing open"),
      );
    });
  });

  describe("given no limit is passed", () => {
    it("uses the shipped ceiling", async () => {
      for (
        let attempt = 0;
        attempt < REPORTS_WITH_ANALYSIS_PER_MINUTE;
        attempt++
      ) {
        const allowed = await checkReportRateLimit({
          ...CALLER,
          now: INSIDE_A_MINUTE,
        });
        expect(allowed.isAllowed).toBe(true);
      }

      const refused = await checkReportRateLimit({
        ...CALLER,
        now: INSIDE_A_MINUTE,
      });

      expect(refused.isAllowed).toBe(false);
    });
  });
});
