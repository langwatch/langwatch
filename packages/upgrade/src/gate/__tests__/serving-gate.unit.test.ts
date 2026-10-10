import { describe, expect, it } from "vitest";

import type { ServingRosterEntry } from "../../ledger.ts";
import type { ServingRosterLedger } from "../../serving-roster/index.ts";
import { createServingRoster } from "../../serving-roster/index.ts";
import { assertCurrent, createUpgradeGate, ledgerFloor, UPGRADE_COMMAND } from "../index.ts";

const PRISMA = "prisma:20261006180000_add_column";
const GOOSE = "clickhouse:00042";
const DATA = "trace:fill-cost";
const image = { release: "3.21.0", blockingSteps: [PRISMA, GOOSE] };
const BACKGROUND = "trace:backfill-cost";
const allDone = [
  { id: PRISMA, status: "done" as const },
  { id: GOOSE, status: "done" as const },
];
const registered = [...allDone, { id: BACKGROUND, status: "pending" as const }];

function memoryServingRosterLedger(): ServingRosterLedger & {
  rows: Map<string, ServingRosterEntry>;
} {
  const rows = new Map<string, ServingRosterEntry>();
  return {
    rows,
    writeRosterEntry: async (declaration) => {
      const at = new Date(0);
      const row = {
        ...declaration,
        steps: [...declaration.steps],
        credentialKeys: [...(declaration.credentialKeys ?? [])],
        startedAt: at,
        heartbeatAt: at,
      };
      rows.set(row.processId, row);
      return row;
    },
    findLiveRoster: async () => [...rows.values()],
    removeRosterEntry: async ({ processId }) => void rows.delete(processId),
  };
}

function gateOver({
  role = "worker",
  release = "3.21.0",
  steps = registered,
  runs = [],
  schemaIsEmpty = false,
  blockingSteps = [PRISMA, GOOSE],
}: {
  role?: "api" | "worker";
  release?: string | null;
  steps?: readonly { id: string; status: "done" | "not-needed" | "pending" | "failed" }[];
  runs?: readonly { floor: string | null }[];
  schemaIsEmpty?: boolean;
  blockingSteps?: readonly string[];
} = {}) {
  const ledger = memoryServingRosterLedger();
  const roster = createServingRoster({
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
      blockingSteps: [...blockingSteps],
      declaredSteps: [BACKGROUND],
    },
    ledger: {
      findSteps: async () =>
        steps.map((step) => ({
          ...step,
          kind: "data" as const,
          mode: "blocking" as const,
          release: null,
        })),
      findRuns: async () =>
        runs.map((run, index) => ({
          ...run,
          id: `run_${index}`,
          kind: "upgrade" as const,
          outcome: "succeeded" as const,
          finishedAt: null,
        })),
    },
    roster,
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
  /** @scenario "A first install is detected by the worker" */
  it("answers a first install to the worker on an empty ledger and an empty schema", async () => {
    const { gate } = gateOver({ role: "worker", steps: [], schemaIsEmpty: true });
    await expect(gate.admit()).resolves.toMatchObject({
      admitted: false,
      outcome: "first-install",
      command: UPGRADE_COMMAND,
    });
  });

  /** @scenario "An api on a first install is upgrading" */
  it("answers upgrading to the api on an empty ledger and an empty schema", async () => {
    const { gate } = gateOver({ role: "api", steps: [], schemaIsEmpty: true });
    await expect(gate.admit()).resolves.toMatchObject({ admitted: false, outcome: "upgrading" });
  });

  /** @scenario "An api whose image has a schema step of either store outstanding is upgrading" */
  it("answers upgrading to the api, naming the pending Postgres and ClickHouse schema steps", async () => {
    const steps = [
      { id: PRISMA, status: "pending" as const },
      { id: GOOSE, status: "pending" as const },
    ];
    const { gate } = gateOver({ role: "api", steps });
    await expect(gate.admit()).resolves.toMatchObject({
      admitted: false,
      outcome: "upgrading",
      outstanding: [PRISMA, GOOSE],
    });
  });

  /** @scenario "An api whose schema steps are done while a blocking step is outstanding is upgrading" */
  it("answers upgrading to the api once its schema steps are done", async () => {
    const steps = [...allDone, { id: DATA, status: "pending" as const }];
    const { gate, rows } = gateOver({
      role: "api",
      steps,
      blockingSteps: [PRISMA, GOOSE, DATA],
    });
    await expect(gate.admit()).resolves.toMatchObject({
      admitted: false,
      outcome: "upgrading",
      outstanding: [DATA],
    });
    expect(rows.size).toBe(0);
  });

  /** @scenario "A worker on an installation behind its image is told to run the upgrade" */
  it("answers behind to the worker, naming the step and the command", async () => {
    const steps = [
      { id: PRISMA, status: "done" as const },
      { id: GOOSE, status: "pending" as const },
      { id: BACKGROUND, status: "pending" as const },
    ];
    const { gate, rows } = gateOver({ role: "worker", steps });
    await expect(gate.admit()).resolves.toMatchObject({
      outcome: "behind",
      outstanding: [GOOSE],
      command: UPGRADE_COMMAND,
    });
    expect(rows.size).toBe(0);
  });

  /** @scenario "The roster entry is written on start and removed on graceful stop" */
  it("records its roster entry once admitted and removes it on release", async () => {
    const { gate, rows } = gateOver();
    await expect(gate.admit()).resolves.toMatchObject({ admitted: true });
    expect(rows.get("worker-1")).toMatchObject({
      role: "worker",
      image: "3.21.0",
      release: "3.21.0",
      steps: [BACKGROUND],
    });
    await gate.release();
    expect(rows.size).toBe(0);
  });

  describe("given every blocking step done and a declared background step the ledger lacks", () => {
    /** @scenario "A worker runs the upgrade for a background step the ledger has not registered" */
    it("answers behind to the worker, naming the unregistered step", async () => {
      const { gate, rows } = gateOver({ role: "worker", steps: allDone });
      await expect(gate.admit()).resolves.toMatchObject({
        outcome: "behind",
        outstanding: [BACKGROUND],
      });
      expect(rows.size).toBe(0);
    });

    /** @scenario "An api serves while a background step is unregistered" */
    it("admits the api", async () => {
      const { gate } = gateOver({ role: "api", steps: allDone });
      await expect(gate.admit()).resolves.toMatchObject({ admitted: true });
    });
  });

  /** @scenario "A refused process writes no roster entry" */
  it("writes no roster entry when it refuses", async () => {
    const { gate, rows } = gateOver({ steps: [{ id: GOOSE, status: "pending" }] });
    await expect(gate.admit()).resolves.toMatchObject({ admitted: false });
    expect(rows.size).toBe(0);
  });
});
