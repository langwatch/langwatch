import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ServingRosterDeclaration, createServingRoster } from "../index.ts";
import { MemoryServingRosterLedger } from "./memory-serving-roster-ledger.ts";

const STALE_AFTER_MS = 60_000;
const REFRESH_EVERY_MS = 15_000;
const STEP = "trace:backfill-cost";

const newWorker: ServingRosterDeclaration = {
  processId: "worker-new-1",
  role: "worker",
  image: "git-abc1234",
  release: null,
  steps: [STEP],
};
const oldApi: ServingRosterDeclaration = {
  processId: "api-old-1",
  role: "api",
  image: "git-0ld0000",
  release: null,
  steps: [],
};

function rosterOver(ledger: MemoryServingRosterLedger, errors: unknown[] = []) {
  return createServingRoster({
    ledger,
    staleAfterMs: STALE_AFTER_MS,
    refreshEveryMs: REFRESH_EVERY_MS,
    onRefreshError: (error) => errors.push(error),
  });
}

describe("createServingRoster()", () => {
  let ledger: MemoryServingRosterLedger;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-06T22:00:00Z") });
    ledger = new MemoryServingRosterLedger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when a worker records its roster entry", () => {
    /** @scenario "A new process is live" */
    it("lists the worker with its role, image and declared steps", async () => {
      const roster = rosterOver(ledger);
      await roster.record(newWorker);

      expect(await roster.live()).toEqual([
        {
          ...newWorker,
          startedAt: new Date("2026-10-06T22:00:00Z"),
          heartbeatAt: new Date("2026-10-06T22:00:00Z"),
        },
      ]);
      await roster.stop();
    });
  });

  describe("when a row is not refreshed", () => {
    /** @scenario "A process not refreshed within the stale bound is not live" */
    it("is live up to the stale bound and dead past it", async () => {
      await ledger.writeRosterEntry(newWorker);
      const reader = rosterOver(ledger);

      await vi.advanceTimersByTimeAsync(STALE_AFTER_MS);
      expect(await reader.live()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await reader.live()).toEqual([]);
    });
  });

  describe("when the roster entry refreshes on its interval", () => {
    /** @scenario "A process that keeps refreshing stays live past the stale bound" */
    it("keeps the worker live after five minutes", async () => {
      const roster = rosterOver(ledger);
      await roster.record(newWorker);

      await vi.advanceTimersByTimeAsync(5 * 60_000);

      const live = await roster.live();
      expect(live.map((row) => row.processId)).toEqual([newWorker.processId]);
      expect(live[0]?.startedAt).toEqual(new Date("2026-10-06T22:00:00Z"));
      expect(live[0]?.heartbeatAt).toEqual(new Date("2026-10-06T22:05:00Z"));
      await roster.stop();
    });
  });

  describe("when old and new builds serve side by side", () => {
    /** @scenario "Old writers are gone only when every live process declares the step" */
    it("answers gone only once the old api has stopped", async () => {
      const api = rosterOver(ledger);
      const worker = rosterOver(ledger);
      await api.record(oldApi);
      await worker.record(newWorker);

      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(false);
      await api.stop();
      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(true);
      await worker.stop();
    });

    /** @scenario "A crashed old process stops holding a step back once its row is stale" */
    it("answers gone once the crashed api's row is stale", async () => {
      await ledger.writeRosterEntry(oldApi);
      const worker = rosterOver(ledger);
      await worker.record(newWorker);
      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(false);

      await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + 1);

      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(true);
      await worker.stop();
    });
  });

  describe("when no process is live", () => {
    /** @scenario "Old writers are gone when no process is live" */
    it("answers gone", async () => {
      expect(await rosterOver(ledger).oldWritersGoneFor({ stepId: STEP })).toBe(true);
    });
  });

  describe("when the deploy rolls back to an image without the step", () => {
    /** @scenario "A rollback to an image without the step makes old writers present again" */
    it("answers not gone again", async () => {
      const worker = rosterOver(ledger);
      await worker.record(newWorker);
      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(true);

      const rolledBack = rosterOver(ledger);
      await rolledBack.record({ ...newWorker, processId: "worker-rolled-back-1", steps: [] });

      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(false);
      await worker.stop();
      await rolledBack.stop();
    });
  });

  describe("when the process stops", () => {
    /** @scenario "A gracefully stopped process is no longer live" */
    it("removes its row", async () => {
      const roster = rosterOver(ledger);
      await roster.record(newWorker);

      await roster.stop();

      expect(await roster.live()).toEqual([]);
      expect(ledger.rows.size).toBe(0);
    });

    /** @scenario "A stop whose delete fails still stops, and the row lapses at the stale bound" */
    it("resolves without an error and the row lapses", async () => {
      const roster = rosterOver(ledger);
      await roster.record(newWorker);
      ledger.refuseRemoves();

      await expect(roster.stop()).resolves.toBeUndefined();
      expect(ledger.rows.size).toBe(1);
      await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + 1);

      expect(await roster.live()).toEqual([]);
    });

    /** @scenario "A refresh in flight when the process stops does not bring it back" */
    it("waits for the refresh before removing the row", async () => {
      const roster = rosterOver(ledger);
      await roster.record(newWorker);
      const release = ledger.holdWrites();
      const refreshing = roster.refresh();

      const stopping = roster.stop();
      release();
      await Promise.all([refreshing, stopping]);

      expect(ledger.rows.size).toBe(0);
      await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 2);
      expect(ledger.rows.size).toBe(0);
    });
  });

  describe("when a refresh fails", () => {
    /** @scenario "A failed refresh is reported and the next interval refreshes again" */
    it("reports it once and the next interval writes a later heartbeat", async () => {
      const errors: unknown[] = [];
      const roster = rosterOver(ledger, errors);
      await roster.record(newWorker);
      ledger.refuseNextWrite();

      await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 2);

      expect(errors).toHaveLength(1);
      const live = await roster.live();
      expect(live[0]?.heartbeatAt).toEqual(new Date("2026-10-06T22:00:30Z"));
      await roster.stop();
    });
  });

  describe("when the refresh interval is not below the stale bound", () => {
    /** @scenario "A refresh interval not below the stale bound is refused" */
    it("refuses to create the roster entry", () => {
      expect(() =>
        createServingRoster({ ledger, staleAfterMs: 60_000, refreshEveryMs: 60_000 }),
      ).toThrow(RangeError);
    });
  });

  describe("when the declaration has no process id", () => {
    /** @scenario "A roster entry without a process id is refused" */
    it("refuses and writes nothing", async () => {
      const roster = rosterOver(ledger);

      await expect(roster.record({ ...newWorker, processId: "" })).rejects.toMatchObject({
        name: "ZodError",
      });
      expect(ledger.rows.size).toBe(0);
    });
  });

  describe("when the first roster write fails", () => {
    /** @scenario "A process whose first roster write fails is told so" */
    it("rejects with the ledger's error and schedules no refresh", async () => {
      const roster = rosterOver(ledger);
      ledger.refuseNextWrite();

      await expect(roster.record(newWorker)).rejects.toThrow("roster write refused");
      await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 2);

      expect(ledger.rows.size).toBe(0);
    });
  });
});
