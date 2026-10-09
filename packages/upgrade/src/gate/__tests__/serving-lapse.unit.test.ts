import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpgradeStepStatus } from "../../ledger.ts";
import { MemoryServingRosterLedger } from "../../serving-roster/__tests__/memory-serving-roster-ledger.ts";
import { createServingRoster } from "../../serving-roster/index.ts";
import { createUpgradeGate, SERVING_ROSTER_TIMING } from "../index.ts";

const PRISMA = "prisma:20261006180000_add_column";
const GOOSE = "clickhouse:00042";
const ledgerStep = (id: string, status: UpgradeStepStatus) =>
  ({ id, status, mode: "blocking", release: "3.21.0" }) as const;

function workerGate({ goose = "done" }: { goose?: UpgradeStepStatus } = {}) {
  const rosterLedger = new MemoryServingRosterLedger();
  const changes: boolean[] = [];
  const roster = createServingRoster({
    ledger: rosterLedger,
    ...SERVING_ROSTER_TIMING,
    onRefreshError: () => undefined,
    onLapseChange: (lapsed) => changes.push(lapsed),
  });
  const gate = createUpgradeGate({
    role: "worker",
    processId: "worker-1",
    image: { name: "3.21.0", release: "3.21.0", blockingSteps: [PRISMA, GOOSE], declaredSteps: [] },
    ledger: {
      findSteps: async () => [ledgerStep(PRISMA, "done"), ledgerStep(GOOSE, goose)],
      findRuns: async () => [],
    },
    roster,
    schemaIsEmpty: async () => false,
  });
  return { gate, rosterLedger, changes };
}

describe("the serving gate's lapsed roster entry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-06T22:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "A process whose roster writes keep failing stops serving past the stale bound" */
  it("stops serving once the last good write is older than 60 s, and says so once", async () => {
    const { gate, rosterLedger, changes } = workerGate();
    await gate.admit();
    for (let refused = 0; refused < 5; refused++) rosterLedger.refuseNextWrite();

    await vi.advanceTimersByTimeAsync(SERVING_ROSTER_TIMING.staleAfterMs);
    expect(gate.serving()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(gate.serving()).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(changes).toEqual([true]);
    await gate.release();
  });

  /** @scenario "A process that stopped serving on a lapsed roster entry serves again after a good write" */
  it("serves again after the next good write, and says so once", async () => {
    const { gate, rosterLedger, changes } = workerGate();
    await gate.admit();
    for (let refused = 0; refused < 4; refused++) rosterLedger.refuseNextWrite();
    await vi.advanceTimersByTimeAsync(SERVING_ROSTER_TIMING.staleAfterMs + 1);
    expect(gate.serving()).toBe(false);

    await vi.advanceTimersByTimeAsync(SERVING_ROSTER_TIMING.refreshEveryMs);

    expect(gate.serving()).toBe(true);
    expect(changes).toEqual([true, false]);
    await gate.release();
  });

  /** @scenario "A healthy process never stops serving" */
  it("keeps serving for ten minutes of good writes", async () => {
    const { gate, changes } = workerGate();
    await gate.admit();
    for (let second = 0; second < 600; second += 5) {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(gate.serving()).toBe(true);
    }
    expect(changes).toEqual([]);
    await gate.release();
  });

  /** @scenario "A process that is not admitted is not serving" */
  it("is not serving when refused, nor after a graceful stop", async () => {
    const refused = workerGate({ goose: "pending" });
    expect(await refused.gate.admit()).toMatchObject({ admitted: false });
    expect(refused.gate.serving()).toBe(false);

    const admitted = workerGate();
    await admitted.gate.admit();
    await admitted.gate.release();
    expect(admitted.gate.serving()).toBe(false);
  });
});
