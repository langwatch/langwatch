import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpgradeStepStatus } from "../../ledger.ts";
import { MemoryServingRosterLedger } from "../../serving-roster/__tests__/memory-serving-roster-ledger.ts";
import { createServingRoster } from "../../serving-roster/index.ts";
import { createUpgradeGate, SERVING_ROSTER_TIMING } from "../index.ts";

const PRISMA = "prisma:20261006180000_add_column";
const GOOSE = "clickhouse:00042";
const ledgerStep = (id: string, status: UpgradeStepStatus) =>
  ({ id, kind: "data", status, mode: "blocking", release: "3.21.0" }) as const;

function workerGate({ goose = "done" }: { goose?: UpgradeStepStatus } = {}) {
  const rosterLedger = new MemoryServingRosterLedger();
  const roster = createServingRoster({
    ledger: rosterLedger,
    ...SERVING_ROSTER_TIMING,
    onRefreshError: () => undefined,
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
  return { gate, rosterLedger };
}

describe("the serving gate through a roster outage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-06T22:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "A process whose roster writes keep failing keeps serving" */
  it("keeps serving for thirty minutes of refused writes, and after they recover", async () => {
    const { gate, rosterLedger } = workerGate();
    await gate.admit();
    for (let refused = 0; refused < 200; refused++) rosterLedger.refuseNextWrite();

    for (let second = 0; second < 1_800; second += 15) {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(gate.serving()).toBe(true);
    }
    await gate.release();
  });

  it("holds the stale bound well above a database blip", () => {
    expect(SERVING_ROSTER_TIMING.staleAfterMs).toBeGreaterThanOrEqual(10 * 60_000);
  });

  /** @scenario "A healthy process never stops serving" */
  it("keeps serving for ten minutes of good writes", async () => {
    const { gate } = workerGate();
    await gate.admit();
    for (let second = 0; second < 600; second += 5) {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(gate.serving()).toBe(true);
    }
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
