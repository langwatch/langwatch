import { afterEach, describe, expect, it, vi } from "vitest";

import { LEASE_TTL_MS, type LeaseDeps, type LeaseStore, withLease } from "../lease-lock.ts";

/** A lease store whose acquire answers from a list, recording every call. */
function storeAnswering(answers: boolean[]) {
  const calls: string[] = [];
  let tries = 0;
  const store: LeaseStore = {
    acquire: async ({ holder }) => {
      calls.push(`acquire:${holder}`);
      return answers[tries++] ?? false;
    },
    renew: async ({ holder }) => {
      calls.push(`renew:${holder}`);
    },
    release: async ({ holder }) => {
      calls.push(`release:${holder}`);
    },
  };
  return { store, calls };
}

function clock(): LeaseDeps & { waits: number[] } {
  let now = 0;
  const waits: number[] = [];
  return {
    waits,
    now: () => now,
    random: () => 0.5,
    newHolder: () => "h1",
    wait: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  };
}

describe("withLease", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when someone else holds the lease at first", () => {
    it("waits, runs the work once it holds the lease, then drops its own lease", async () => {
      const { store, calls } = storeAnswering([false, false, true]);
      const deps = clock();
      let runs = 0;

      const value = await withLease({ store, work: async () => ++runs, deps });

      expect(value).toBe(1);
      expect(runs).toBe(1);
      expect(deps.waits).toHaveLength(2);
      expect(calls).toEqual(["acquire:h1", "acquire:h1", "acquire:h1", "release:h1"]);
    });
  });

  describe("when the work fails", () => {
    it("still drops the lease and rethrows", async () => {
      const { store, calls } = storeAnswering([true]);
      const failure = new Error("write refused");

      await expect(
        withLease({ store, work: async () => Promise.reject(failure), deps: clock() }),
      ).rejects.toBe(failure);
      expect(calls).toEqual(["acquire:h1", "release:h1"]);
    });
  });

  describe("when the work outlasts the lease's expiry", () => {
    it("renews the lease while the work runs, so nobody takes it early", async () => {
      vi.useFakeTimers();
      const { store, calls } = storeAnswering([true]);
      let finish: () => void = () => {};
      const work = new Promise<void>((resolve) => {
        finish = resolve;
      });

      const held = withLease({ store, work: () => work, deps: clock() });
      await vi.advanceTimersByTimeAsync(LEASE_TTL_MS * 2);
      finish();
      await held;

      const renewals = calls.filter((call) => call.startsWith("renew:"));
      expect(renewals.length).toBeGreaterThanOrEqual(4);
      expect(calls.at(-1)).toBe("release:h1");
    });
  });

  describe("when the lease stays held past the wait", () => {
    it("throws the error the owner names, without running the work", async () => {
      const { store } = storeAnswering([]);
      const busy = Object.assign(new Error("busy"), { code: "seat_change_busy" });
      let runs = 0;

      await expect(
        withLease({
          store,
          work: async () => ++runs,
          waitMs: 500,
          deps: clock(),
          onBusy: () => busy,
        }),
      ).rejects.toBe(busy);
      expect(runs).toBe(0);
    });

    it("throws LeaseBusyError when the owner names none", async () => {
      const { store } = storeAnswering([]);

      await expect(
        withLease({ store, work: async () => 1, waitMs: 500, deps: clock() }),
      ).rejects.toMatchObject({ name: "LeaseBusyError" });
    });
  });
});
