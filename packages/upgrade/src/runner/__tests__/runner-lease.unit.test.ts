/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-logging.feature
 * @see specs/upgrade/upgrade-stuck-states-locks.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { holdUpgradeLease, DEFAULT_LEASE_TIMING } from "../runner-lease.ts";

const lease = {
  name: "upgrade",
  owner: "me",
  image: "x",
  host: "h",
  heartbeatAt: new Date(0),
  expiresAt: new Date(60_000),
};

function hold({ renewed, released = [] }: { renewed: boolean; released?: string[] }) {
  return holdUpgradeLease({
    ledger: {
      acquireLease: async () => lease,
      renewLease: async () => (renewed ? lease : null),
      releaseLease: async ({ owner }) => {
        released.push(owner);
        return true;
      },
    },
    runner: { findLease: async () => null },
    identity: { owner: "me", image: "x", host: "h" },
    timing: DEFAULT_LEASE_TIMING,
    log: { info: () => {}, warn: () => {} },
    signal: new AbortController().signal,
    work: async () => "ok",
  });
}

describe("holdUpgradeLease", () => {
  describe("when another runner took the lease before the last check", () => {
    /** @scenario "A run that finished reports its result even when its last lease check is refused" */
    it("reports the finished run's result, not a lost lease, and releases nothing", async () => {
      const released: string[] = [];

      expect(await hold({ renewed: false, released })).toEqual({
        acquired: true,
        lost: false,
        result: "ok",
      });
      expect(released).toEqual([]);
    });
  });

  describe("when this runner still holds the lease at the end", () => {
    it("reports it held and releases it", async () => {
      const released: string[] = [];

      expect(await hold({ renewed: true, released })).toMatchObject({
        acquired: true,
        lost: false,
      });
      expect(released).toEqual(["me"]);
    });
  });

  describe("when a renewal never answers", () => {
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"],
      });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** @scenario "A runner whose lease renewal never answers stops before the lease expires" */
    it("aborts the work once the time to live less one heartbeat passes", async () => {
      const timing = { ttlMs: 60_000, heartbeatMs: 15_000, waitMs: 0, pollMs: 1_000 };
      let abortedAt: number | null = null;
      const outcome = holdUpgradeLease({
        ledger: {
          acquireLease: async () => lease,
          renewLease: () => new Promise(() => undefined),
          releaseLease: async () => true,
        },
        runner: { findLease: async () => null },
        identity: { owner: "me", image: "x", host: "h" },
        timing,
        log: { info: () => {}, warn: () => {} },
        signal: new AbortController().signal,
        work: ({ signal }) =>
          new Promise<string>((resolve) =>
            signal.addEventListener("abort", () => {
              abortedAt = performance.now();
              resolve(String(signal.reason));
            }),
          ),
      });
      const startedAt = performance.now();
      await vi.advanceTimersByTimeAsync(timing.ttlMs);

      expect(await outcome).toMatchObject({ acquired: true, lost: true });
      expect(abortedAt).not.toBeNull();
      expect((abortedAt ?? 0) - startedAt).toBe(timing.ttlMs - timing.heartbeatMs);
    });
  });
});
