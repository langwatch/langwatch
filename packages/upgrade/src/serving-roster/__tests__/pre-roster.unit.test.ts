import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type PreRosterHistory,
  type ServingRosterDeclaration,
  createServingRoster,
  preRosterWriters,
} from "../index.ts";
import { MemoryPreRosterLedger } from "./memory-serving-roster-ledger.ts";

const STALE_AFTER_MS = 60_000;
const REFRESH_EVERY_MS = 15_000;
const GRACE_MS = 30 * 60_000;
const STEP = "trace:backfill-cost";
const START = new Date("2026-10-08T12:00:00Z");

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

const at = (offsetMs: number) => new Date(START.getTime() + offsetMs);

function rosterOver(ledger: MemoryPreRosterLedger) {
  return createServingRoster({
    ledger,
    staleAfterMs: STALE_AFTER_MS,
    refreshEveryMs: REFRESH_EVERY_MS,
    preRosterGraceMs: GRACE_MS,
  });
}

describe("createServingRoster() with writers before the roster", () => {
  let ledger: MemoryPreRosterLedger;

  beforeEach(() => {
    vi.useFakeTimers({ now: START });
    ledger = new MemoryPreRosterLedger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The seed opens at START; its upgrade run finishes a second later. */
  const seededAndUpgraded = () => {
    ledger.seededFromExistingAt = at(0);
    ledger.upgradesFinishedAt.push(at(1_000));
  };

  describe("when the ledger was seeded from an existing installation", () => {
    /** @scenario "An installation upgraded from an image before the roster holds the step until old writers are asserted gone" */
    it("holds the step until old writers are asserted gone", async () => {
      seededAndUpgraded();
      vi.setSystemTime(at(60_000));
      const worker = rosterOver(ledger);
      await worker.record(newWorker);

      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(false);
      ledger.assertionsAt.push(new Date());
      vi.setSystemTime(at(61_000));
      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(true);
      await worker.stop();
    });

    /** @scenario "With no assertion, the grace after the upgrade run releases the step" */
    it("releases the step once the grace has passed after the upgrade run", async () => {
      seededAndUpgraded();
      const worker = rosterOver(ledger);
      await worker.record(newWorker);

      vi.setSystemTime(at(1_000 + GRACE_MS - 1));
      await worker.refresh();
      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(false);
      vi.setSystemTime(at(1_000 + GRACE_MS));
      await worker.refresh();
      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(true);
      await worker.stop();
    });

    /** @scenario "The assertion does not release a step a live process on the old image still lacks" */
    it("still waits for a live process on the old image", async () => {
      seededAndUpgraded();
      vi.setSystemTime(at(5_000));
      ledger.assertionsAt.push(new Date());
      const api = rosterOver(ledger);
      const worker = rosterOver(ledger);
      await api.record(oldApi);
      await worker.record(newWorker);

      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(false);
      await api.stop();
      await worker.stop();
    });
  });

  /** @scenario "A fresh installation never waits for writers before the roster" */
  it("does not hold a fresh installation", async () => {
    ledger.upgradesFinishedAt.push(at(1_000));
    const worker = rosterOver(ledger);
    await worker.record(newWorker);

    expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(true);
    await worker.stop();
  });

  /** @scenario "A recorded rollback to an image before the roster holds the step again until the next grace" */
  it("holds the step again after a recorded rollback, until the next run's grace", async () => {
    seededAndUpgraded();
    ledger.assertionsAt.push(at(60_000));
    vi.setSystemTime(at(120_000));
    const worker = rosterOver(ledger);
    await worker.record(newWorker);
    expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(true);

    ledger.rollbacksAt.push(at(120_000));
    vi.setSystemTime(at(121_000));
    await worker.refresh();
    expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(false);

    ledger.upgradesFinishedAt.push(at(3_600_000));
    vi.setSystemTime(at(3_600_000 + GRACE_MS - 1));
    await worker.refresh();
    expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(false);
    vi.setSystemTime(at(3_600_000 + GRACE_MS));
    await worker.refresh();
    expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(true);
    await worker.stop();
  });

  /** @scenario "A roster that reads the history of writers before the roster without a grace is refused" */
  it("refuses a roster that reads the history with no grace", () => {
    expect(() =>
      createServingRoster({
        ledger,
        staleAfterMs: STALE_AFTER_MS,
        refreshEveryMs: REFRESH_EVERY_MS,
      }),
    ).toThrow(RangeError);
  });
});

describe("preRosterWriters()", () => {
  const history = (overrides: Partial<PreRosterHistory>): PreRosterHistory => ({
    now: at(0),
    seededFromExistingAt: null,
    rollbacksAt: [],
    assertionsAt: [],
    upgradesFinishedAt: [],
    ...overrides,
  });

  it("counts the grace from the opening when no upgrade run finished after it", () => {
    const opened = history({ rollbacksAt: [at(0)], now: at(GRACE_MS - 1) });
    expect(preRosterWriters({ history: opened, graceMs: GRACE_MS })).toEqual({
      present: true,
      graceEndsAtMs: at(GRACE_MS).getTime(),
    });
    expect(
      preRosterWriters({ history: { ...opened, now: at(GRACE_MS) }, graceMs: GRACE_MS }),
    ).toEqual({ present: false, reason: "grace" });
  });

  it("ignores an assertion made before the latest opening", () => {
    const verdict = preRosterWriters({
      history: history({
        seededFromExistingAt: at(0),
        assertionsAt: [at(10)],
        rollbacksAt: [at(20)],
        now: at(30),
      }),
      graceMs: GRACE_MS,
    });
    expect(verdict.present).toBe(true);
  });

  it("answers never when nothing opened", () => {
    expect(preRosterWriters({ history: history({}), graceMs: 0 })).toEqual({
      present: false,
      reason: "never",
    });
  });
});
