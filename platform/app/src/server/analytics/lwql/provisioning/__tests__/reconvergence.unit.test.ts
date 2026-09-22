/**
 * The server-side reconvergence watch closes the chart-upgrade window: it polls
 * a stateless ownership probe on a backoff and re-provisions the app-owned
 * LangWatchQL model the moment a probe reports the model is owned by neither the
 * ClickHouse config store nor the SQL store.
 *
 * The decision is taken from each probe's snapshot alone, never inferred from
 * history, so fake timers and injected `probe`/`converge` fakes — no real I/O —
 * cover the behaviours that matter:
 *  - a first probe of "sql_store" means the app-owned model is already live, so
 *    it stops without re-provisioning;
 *  - "config_store" (old pod still rendering the model) followed by "none"
 *    re-provisions exactly once;
 *  - a probe that throws (ClickHouse mid-roll) is treated as "still waiting" and
 *    NEVER re-provisions on the failure alone — a subsequent "sql_store" stops
 *    it cleanly (the regression guard for a transient error re-provisioning
 *    against a healthy install);
 *  - a first probe of "none" (a pod that rolled before the first poll)
 *    re-provisions once;
 *  - a config store that never releases the model gives up at the budget with a
 *    single warning and never re-provisions.
 *
 * @see ../reconvergence.ts
 * @see ../selfProvisionEntry.ts — lwqlAccessModelOwner
 * @see specs/lwql/api.feature
 */

import { createLogger } from "@langwatch/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LwqlAccessModelOwner } from "../accessModelOwner";
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

  describe("when the first probe finds the app-owned model already live", () => {
    /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
    it("stops without re-provisioning — the SQL store owns the model", async () => {
      const probe = vi
        .fn<() => Promise<LwqlAccessModelOwner>>()
        .mockResolvedValue("sql_store");
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
    it("re-provisions exactly once when a probe returns none", async () => {
      // The old pod still renders the model on the first two polls, gone by the
      // third.
      const probe = vi
        .fn<() => Promise<LwqlAccessModelOwner>>()
        .mockResolvedValueOnce("config_store")
        .mockResolvedValueOnce("config_store")
        .mockResolvedValue("none");
      const converge = vi.fn<() => Promise<void>>().mockResolvedValue();

      startLwqlReconvergenceWatch({
        probe,
        converge,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        budgetMs: 600_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(probe).toHaveBeenCalledTimes(1); // still config-owned → keep polling
      expect(converge).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(probe).toHaveBeenCalledTimes(2); // still config-owned
      expect(converge).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(4_000);
      expect(probe).toHaveBeenCalledTimes(3); // released → converge, stop
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
    it("never re-provisions on the failure alone, then stops on sql_store", async () => {
      // The regression guard: a transient probe error must not trigger a
      // re-provision against a healthy install. The first poll throws; the retry
      // reads a live app-owned model, so the watch stops without converging.
      const probe = vi
        .fn<() => Promise<LwqlAccessModelOwner>>()
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
        .mockResolvedValue("sql_store");
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
      // The snapshot says the SQL store owns the model: nothing to reconverge,
      // and the earlier failure never fabricated a re-provision.
      expect(converge).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("when the first probe finds neither store owns the model", () => {
    /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
    it("re-provisions once — the pod rolled before the first probe", async () => {
      // A pod that rolled to an empty config store before the watch's first poll
      // still reads correctly from the snapshot: "none" → provision once.
      const probe = vi
        .fn<() => Promise<LwqlAccessModelOwner>>()
        .mockResolvedValue("none");
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
      expect(converge).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(converge).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the config store never releases the model", () => {
    /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
    it("gives up at the budget with one warning and never re-provisions", async () => {
      const probe = vi
        .fn<() => Promise<LwqlAccessModelOwner>>()
        .mockResolvedValue("config_store");
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

  describe("when a probe resolves none after stop() was called mid-flight", () => {
    /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
    it("discards the in-flight snapshot and never re-provisions during shutdown", async () => {
      // A deferred probe: it stays pending until this test resolves it, so
      // shutdown can begin while the poll is in flight — the exact race where a
      // late "none" must NOT re-provision during graceful shutdown.
      let resolveProbe: (owner: LwqlAccessModelOwner) => void = () => undefined;
      const probe = vi
        .fn<() => Promise<LwqlAccessModelOwner>>()
        .mockImplementation(
          () =>
            new Promise<LwqlAccessModelOwner>((resolve) => {
              resolveProbe = resolve;
            }),
        );
      const converge = vi.fn<() => Promise<void>>().mockResolvedValue();

      const watch = startLwqlReconvergenceWatch({
        probe,
        converge,
        initialDelayMs: 1_000,
        maxDelayMs: 8_000,
        budgetMs: 600_000,
      });

      // Fire the first poll: the probe is now in flight, its promise pending.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(converge).not.toHaveBeenCalled();

      // Shutdown begins mid-flight, then the probe resolves "none": the snapshot
      // must be discarded before any decision, not acted on.
      watch.stop();
      resolveProbe("none");
      await vi.advanceTimersByTimeAsync(60_000);

      expect(converge).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
