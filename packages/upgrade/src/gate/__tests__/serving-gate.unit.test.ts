import { describe, expect, it } from "vitest";

import type { UpgradePresence } from "../../ledger.ts";
import type { PresenceLedger } from "../../presence/index.ts";
import { createPresence } from "../../presence/index.ts";
import { assertCurrent, createUpgradeGate, ledgerFloor, UPGRADE_COMMAND } from "../index.ts";

const PRISMA = "prisma:20261006180000_upgrade_ledger_widen";
const GOOSE = "clickhouse:00042";
const image = { release: "3.21.0", blockingSteps: [PRISMA, GOOSE] };
const allDone = [
  { id: PRISMA, status: "done" as const },
  { id: GOOSE, status: "done" as const },
];

function memoryPresenceLedger(): PresenceLedger & { rows: Map<string, UpgradePresence> } {
  const rows = new Map<string, UpgradePresence>();
  return {
    rows,
    writePresence: async (declaration) => {
      const at = new Date(0);
      const row = { ...declaration, steps: [...declaration.steps], startedAt: at, heartbeatAt: at };
      rows.set(row.processId, row);
      return row;
    },
    findLivePresence: async () => [...rows.values()],
    removePresence: async ({ processId }) => void rows.delete(processId),
  };
}

function gateOver({
  role = "worker",
  release = "3.21.0",
  steps = allDone,
  runs = [],
  schemaIsEmpty = false,
}: {
  role?: "api" | "worker";
  release?: string | null;
  steps?: readonly { id: string; status: "done" | "not-needed" | "pending" | "failed" }[];
  runs?: readonly { floor: string | null }[];
  schemaIsEmpty?: boolean;
} = {}) {
  const ledger = memoryPresenceLedger();
  const presence = createPresence({
    ledger,
    staleAfterMs: 60_000,
    refreshEveryMs: 15_000,
  });
  const gate = createUpgradeGate({
    role,
    processId: "worker-1",
    image: {
      name: release ?? "git-abc1234",
      release,
      blockingSteps: [PRISMA, GOOSE],
      declaredSteps: ["trace:backfill-cost"],
    },
    ledger: {
      findSteps: async () =>
        steps.map((step) => ({ ...step, mode: "blocking" as const, release: null })),
      findRuns: async () =>
        runs.map((run, index) => ({
          ...run,
          id: `run_${index}`,
          kind: "upgrade" as const,
          outcome: "succeeded" as const,
          finishedAt: null,
        })),
    },
    presence,
    schemaIsEmpty: async () => schemaIsEmpty,
  });
  return { gate, rows: ledger.rows };
}

describe("assertCurrent", () => {
  /** @scenario "A process whose blocking steps are all done serves" */
  it("admits when every blocking step is done or not-needed", () => {
    const verdict = assertCurrent({
      ledger: {
        steps: [
          { id: PRISMA, status: "done" },
          { id: GOOSE, status: "not-needed" },
        ],
      },
      image,
      floor: null,
    });
    expect(verdict.admitted).toBe(true);
  });

  /** @scenario "A process behind the ledger refuses, naming the outstanding steps and the command" */
  it("refuses naming the outstanding step and the command", () => {
    const verdict = assertCurrent({
      ledger: {
        steps: [
          { id: PRISMA, status: "done" },
          { id: GOOSE, status: "failed" },
        ],
      },
      image,
      floor: null,
    });
    expect(verdict).toMatchObject({ admitted: false, outcome: "behind", outstanding: [GOOSE] });
    expect(verdict.admitted ? "" : verdict.refusal).toContain(GOOSE);
    expect(verdict.admitted ? "" : verdict.refusal).toContain(UPGRADE_COMMAND);
  });

  /** @scenario "A blocking step the ledger has never recorded is outstanding" */
  it("counts an unrecorded blocking step as outstanding", () => {
    const verdict = assertCurrent({
      ledger: { steps: [{ id: PRISMA, status: "done" }] },
      image,
      floor: null,
    });
    expect(verdict).toMatchObject({ outcome: "behind", outstanding: [GOOSE] });
  });

  /** @scenario "An image below the ledger's floor refuses, naming the floor" */
  it("refuses a release below the floor, naming both", () => {
    const verdict = assertCurrent({ ledger: { steps: allDone }, image, floor: "3.22.0" });
    expect(verdict).toMatchObject({ outcome: "below-floor", release: "3.21.0", floor: "3.22.0" });
    expect(verdict.admitted ? "" : verdict.refusal).toContain("3.22.0");
  });

  /** @scenario "A rolled-back image at or above the floor serves" */
  it("admits a release at the highest recorded floor", () => {
    const floor = ledgerFloor({
      runs: [{ floor: "3.20.1" }, { floor: "3.21.0" }, { floor: null }],
    });
    expect(floor).toBe("3.21.0");
    expect(assertCurrent({ ledger: { steps: allDone }, image, floor }).admitted).toBe(true);
  });

  /** @scenario "An unreleased cloud image is never below the floor" */
  it("admits an image with no release whatever the floor", () => {
    const verdict = assertCurrent({
      ledger: { steps: allDone },
      image: { ...image, release: null },
      floor: "3.22.0",
    });
    expect(verdict.admitted).toBe(true);
  });

  /** @scenario "An image with a malformed release is refused before it reads the ledger" */
  it("refuses to make a gate for a release that is not major.minor.patch", () => {
    expect(() => gateOver({ release: "3.21" })).toThrow(/release/);
  });
});

describe("createUpgradeGate", () => {
  /** @scenario "A Helm first install is detected by the api" */
  it("answers a first install to the api on an empty ledger and an empty schema", async () => {
    const { gate } = gateOver({ role: "api", steps: [], schemaIsEmpty: true });
    await expect(gate.admit()).resolves.toMatchObject({
      admitted: false,
      outcome: "first-install",
      command: UPGRADE_COMMAND,
    });
  });

  /** @scenario "A worker on a first install refuses as behind" */
  it("refuses the worker as behind on a first install", async () => {
    const { gate } = gateOver({ role: "worker", steps: [], schemaIsEmpty: true });
    await expect(gate.admit()).resolves.toMatchObject({
      outcome: "behind",
      outstanding: [PRISMA, GOOSE],
    });
  });

  /** @scenario "Presence is written on start and removed on graceful stop" */
  it("records presence once admitted and removes it on release", async () => {
    const { gate, rows } = gateOver();
    await expect(gate.admit()).resolves.toMatchObject({ admitted: true });
    expect(rows.get("worker-1")).toMatchObject({
      role: "worker",
      image: "3.21.0",
      release: "3.21.0",
      steps: ["trace:backfill-cost"],
    });
    await gate.release();
    expect(rows.size).toBe(0);
  });

  /** @scenario "A refused process writes no presence" */
  it("writes no presence when it refuses", async () => {
    const { gate, rows } = gateOver({ steps: [{ id: GOOSE, status: "pending" }] });
    await expect(gate.admit()).resolves.toMatchObject({ admitted: false });
    expect(rows.size).toBe(0);
  });
});
