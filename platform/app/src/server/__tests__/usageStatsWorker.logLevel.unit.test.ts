/**
 * @vitest-environment node
 *
 * A usage-stats tick that fails is retried on the next interval, so the tick
 * itself has not decided anything final — it logs at warning and leaves the
 * verdict to the loop. The paired half matters just as much: the loop has to
 * actually schedule that next tick, because a warning promising a retry that
 * never comes is worse than an error, not better.
 *
 * Spec: specs/observability/retryable-failure-log-level.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

const findMany = vi.hoisted(() => vi.fn());
vi.mock("~/server/db", () => ({
  prisma: { organization: { findMany } },
}));

vi.mock("~/env.mjs", () => ({
  env: { DISABLE_USAGE_STATS: false, IS_SAAS: false },
}));

vi.mock("~/server/collectUsageStats", () => ({
  collectUsageStats: vi.fn(async () => ({})),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: (error: unknown) => error,
  withScope: vi.fn(async (fn: (scope: unknown) => unknown) =>
    fn({ setTag: () => undefined, setExtra: () => undefined }),
  ),
}));

const { startUsageStatsWorker } = await import("../usageStatsWorker");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Runs the first scheduled tick and lets its async body settle. */
async function runFirstTick() {
  await vi.advanceTimersByTimeAsync(DAY_MS);
}

describe("the usage stats worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00Z"));
    logger.warn.mockClear();
    logger.error.mockClear();
    findMany.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a tick whose work throws", () => {
    describe("when the loop catches it", () => {
      /** @scenario "A layer that rethrows logs below error" */
      it("logs at warning level, because the next interval will retry", async () => {
        findMany.mockRejectedValue(new Error("database unavailable"));

        const handle = startUsageStatsWorker();
        await runFirstTick();
        handle?.stop();

        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0]?.[1]).toContain("will retry");
      });

      /** @scenario "A layer that rethrows logs below error" */
      it("passes the Error instance so the stack survives", async () => {
        const failure = new Error("database unavailable");
        findMany.mockRejectedValue(failure);

        const handle = startUsageStatsWorker();
        await runFirstTick();
        handle?.stop();

        expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
          error: failure,
        });
      });

      /**
       * The warning claims a retry is coming. If the failure also killed the
       * timer the claim would be false, and a run that stopped sending usage
       * stats entirely would leave nothing above warning to say so.
       */
      /** @scenario "A retried attempt that later succeeds leaves no error record" */
      it("schedules the next tick, so the promised retry actually happens", async () => {
        findMany.mockRejectedValueOnce(new Error("database unavailable"));
        findMany.mockResolvedValue([]);

        const handle = startUsageStatsWorker();
        await runFirstTick();
        expect(findMany).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(DAY_MS);
        handle?.stop();

        expect(findMany).toHaveBeenCalledTimes(2);
        expect(logger.error).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the worker has been stopped", () => {
    describe("when the next interval comes around", () => {
      it("runs no further ticks", async () => {
        findMany.mockResolvedValue([]);

        const handle = startUsageStatsWorker();
        await runFirstTick();
        const ticksBeforeStop = findMany.mock.calls.length;

        handle?.stop();
        await vi.advanceTimersByTimeAsync(DAY_MS * 3);

        expect(findMany).toHaveBeenCalledTimes(ticksBeforeStop);
      });
    });
  });
});
