/**
 * @see specs/clickhouse/concurrent-boot-migrations.feature
 * @see specs/setup/boot-sequence.feature
 * @see specs/upgrade/upgrade-stuck-states-locks.feature
 */
import { DEFAULT_LEASE_TIMING, holdUpgradeLease } from "@langwatch/upgrade/runner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { holdTasksLease, LEGACY_TASKS_IMAGE } from "../migration-lock.ts";

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: logs.info, warn: logs.warn }),
}));

const FAST = { ...DEFAULT_LEASE_TIMING, waitMs: 200, pollMs: 10 };

/** The one lease row, as the ledger keeps it: one holder at a time, released by its owner. */
function leaseTable() {
  let holder: { owner: string; image: string; host: string } | null = null;
  const row = () =>
    holder && {
      name: "upgrade",
      ...holder,
      heartbeatAt: new Date(0),
      expiresAt: new Date(60_000),
    };
  return {
    held: () => holder,
    take: (taker: { owner: string; image: string; host: string }) => {
      holder = taker;
    },
    free: () => {
      holder = null;
    },
    ledger: {
      acquireLease: async (taker: { owner: string; image: string; host: string }) => {
        if (holder) return null;
        holder = { owner: taker.owner, image: taker.image, host: taker.host };
        return row();
      },
      renewLease: async ({ owner }: { owner: string }) => (holder?.owner === owner ? row() : null),
      releaseLease: async ({ owner }: { owner: string }) => {
        if (holder?.owner !== owner) return false;
        holder = null;
        return true;
      },
    },
    runner: { findLease: async () => row() },
  };
}

beforeEach(() => {
  logs.info.mockReset();
  logs.warn.mockReset();
});

describe("holdTasksLease", () => {
  describe("when the lease is free", () => {
    /** @scenario "The migration lock is released when the run ends" */
    /** @scenario Waiting is announced once, and only when there was a wait */
    it("runs the tasks under the lease, says nothing about waiting, and releases it", async () => {
      const table = leaseTable();
      const run = vi.fn(async () => {
        expect(table.held()?.image).toBe(LEGACY_TASKS_IMAGE);
      });
      await holdTasksLease({ ...table, run, timing: FAST });
      expect(run).toHaveBeenCalledOnce();
      expect(table.held()).toBeNull();
      expect(logs.info).not.toHaveBeenCalled();
    });
  });

  describe("when another task runner holds it and then finishes", () => {
    /** @scenario "Two migration runs started together never overlap" */
    /** @scenario A second runner waits for the first rather than migrating alongside it */
    /** @scenario A runner that has to wait says so */
    it("waits, says once that it is waiting, and runs after", async () => {
      const table = leaseTable();
      table.take({ owner: "first", image: LEGACY_TASKS_IMAGE, host: "pod-1" });
      setTimeout(table.free, 50);
      const run = vi.fn(async () => {});
      await holdTasksLease({ ...table, run, timing: FAST });
      expect(run).toHaveBeenCalledOnce();
      expect(logs.info).toHaveBeenCalledTimes(1);
      expect(logs.info).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("waiting for the upgrade lease"),
      );
    });
  });

  describe("when an upgrade holds it past the wait", () => {
    /** @scenario "Legacy tasks refuse while an upgrade holds the lease" */
    it("refuses naming the upgrade and runs nothing", async () => {
      const table = leaseTable();
      table.take({ owner: "upgrade-run", image: "3.21.0", host: "pod-2" });
      const run = vi.fn(async () => {});
      await expect(holdTasksLease({ ...table, run, timing: FAST })).rejects.toThrow(
        /refusing to run the tasks: the upgrade lease is held by upgrade-run on pod-2 \(3\.21\.0\)/,
      );
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("when legacy tasks hold it", () => {
    /** @scenario "An upgrade refuses while legacy tasks hold the lease" */
    it("an upgrade cannot take it and is told the legacy tasks hold it", async () => {
      const table = leaseTable();
      let upgrade: Awaited<ReturnType<typeof holdUpgradeLease>> | null = null;
      await holdTasksLease({
        ...table,
        timing: FAST,
        run: async () => {
          upgrade = await holdUpgradeLease({
            ...table,
            identity: { owner: "upgrade-run", image: "3.21.0", host: "pod-2" },
            timing: { ...FAST, waitMs: 0 },
            log: { info: () => {}, warn: () => {} },
            signal: new AbortController().signal,
            work: async () => "ran",
          });
        },
      });
      expect(upgrade).toMatchObject({
        acquired: false,
        holder: { image: LEGACY_TASKS_IMAGE },
      });
    });
  });

  describe("when a task fails", () => {
    /** @scenario "A failed migration run releases the lock" */
    /** @scenario The lock is released even when a task fails */
    it("releases the lease before propagating the failure", async () => {
      const table = leaseTable();
      const failure = new Error("task failed");
      await expect(
        holdTasksLease({
          ...table,
          timing: FAST,
          run: async () => {
            throw failure;
          },
        }),
      ).rejects.toBe(failure);
      expect(table.held()).toBeNull();
    });
  });
});
