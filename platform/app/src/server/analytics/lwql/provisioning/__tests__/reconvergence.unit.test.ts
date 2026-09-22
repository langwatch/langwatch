/**
 * The server-side reconvergence watch closes the chart-upgrade window: it polls
 * the ClickHouse config store on a backoff and re-provisions the app-owned
 * LangWatchQL model the moment the old pod's rendered model is gone.
 *
 * Fake timers and injected `probe`/`converge` fakes — no real I/O — cover the
 * four behaviours that matter:
 *  - a first probe of 0 means there was no upgrade window, so it stops silently
 *    without re-provisioning;
 *  - a probe that reports owned entities and later reports 0 re-provisions
 *    exactly once;
 *  - a probe that throws (ClickHouse mid-roll) is treated as "still waiting" and
 *    retried, and — because the failure marks that ClickHouse was rolling — a
 *    clean 0 that follows re-provisions once (the pod rolled to a new config
 *    store that owns nothing), closing the window even though no probe ever read
 *    ownership directly;
 *  - a config store that never releases the model gives up at the budget with a
 *    single warning and never re-provisions.
 *
 * @see ../reconvergence.ts
 * @see specs/lwql/api.feature
 */

import { createLogger } from "@langwatch/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetLwqlReconvergenceWatchForTests,
  startLwqlReconvergenceWatch,
} from "../reconvergence";

// The module's own logger instance — createLogger memoises by name, so this is
// the object reconvergence.ts logs through. Spying on it lets the give-up case
// assert the warning without mocking the module.
const logger = createLogger("langwatch:analytics:lwql:reconvergence");

describe("startLwqlReconvergenceWatch", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetLwqlReconvergenceWatchForTests();
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(logger, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when the first probe finds the config store owns nothing", () => {
    /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
    it("stops without re-provisioning — there was no upgrade window", async () => {
      const probe = vi.fn<() => Promise<number>>().mockResolvedValue(0);
      const converge = vi.fn<() => Promise<void>>().mockResolvedValue();

      startLwqlReconvergenceWatch({
        probe,
        converge,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        budgetMs: 600_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(converge).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("when the config store owns the model and later releases it", () => {
    /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
    it("re-provisions exactly once when a probe returns zero", async () => {
      // Owns 3 entities on the first poll, released by the second.
      const probe = vi
        .fn<() => Promise<number>>()
        .mockResolvedValueOnce(3)
        .mockResolvedValue(0);
      const converge = vi.fn<() => Promise<void>>().mockResolvedValue();

      startLwqlReconvergenceWatch({
        probe,
        converge,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        budgetMs: 600_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(probe).toHaveBeenCalledTimes(1); // still owned → keep polling
      expect(converge).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(probe).toHaveBeenCalledTimes(2); // released → converge, stop
      expect(converge).toHaveBeenCalledTimes(1);

      // The watch stopped: further time re-provisions nothing.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(converge).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a probe throws because ClickHouse is mid-roll", () => {
    /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
    it("re-provisions once when a clean zero follows a probe failure", async () => {
      // First poll fails (old pod rolling); the retry reads the new pod's config
      // store, which owns nothing. The failure marks the window, so the clean 0
      // is "the pod rolled" — not "no window" — and the app re-provisions once.
      const probe = vi
        .fn<() => Promise<number>>()
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
        .mockResolvedValue(0);
      const converge = vi.fn<() => Promise<void>>().mockResolvedValue();

      startLwqlReconvergenceWatch({
        probe,
        converge,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        budgetMs: 600_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(probe).toHaveBeenCalledTimes(1); // threw → retried, not converged
      expect(converge).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(probe).toHaveBeenCalledTimes(2);
      // The earlier failure means ClickHouse was rolling: the first clean read
      // of 0 closes the window and re-provisions exactly once.
      expect(converge).toHaveBeenCalledTimes(1);

      // The watch stopped: further time re-provisions nothing.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(converge).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the config store never releases the model", () => {
    /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
    it("gives up at the budget with one warning and never re-provisions", async () => {
      const probe = vi.fn<() => Promise<number>>().mockResolvedValue(5);
      const converge = vi.fn<() => Promise<void>>().mockResolvedValue();

      startLwqlReconvergenceWatch({
        probe,
        converge,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        budgetMs: 1_500,
      });

      // First poll fits the budget; the doubled second delay (1s + 2s = 3s)
      // would exceed it, so the watch gives up rather than re-arming.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(converge).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});
