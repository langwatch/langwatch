import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUpgradeGate, SERVING_ROSTER_TIMING } from "../../gate/index.ts";
import type { UpgradeStepStatus } from "../../ledger.ts";
import { createServingRoster, detectRollbacks, type ServingRosterDeclaration } from "../index.ts";
import { MemoryServingRosterLedger } from "./memory-serving-roster-ledger.ts";

const STEP = "trace:backfill-cost";
const RUN_FINISHED = new Date("2026-10-06T21:00:00Z");
const lastRun = {
  id: "run_1",
  kind: "upgrade",
  outcome: "succeeded",
  finishedAt: RUN_FINISHED,
  floor: null,
} as const;

function installation({ runs = [lastRun] }: { runs?: readonly (typeof lastRun)[] } = {}) {
  const status = new Map<string, UpgradeStepStatus>([[STEP, "done"]]);
  const rosterLedger = new MemoryServingRosterLedger();
  const reopened: { ids: readonly string[]; reason: string }[] = [];
  const errors: unknown[] = [];
  let refuseReopen = false;
  const ledger = {
    findSteps: async () =>
      [...status].map(
        ([id, each]) => ({ id, status: each, mode: "background", release: null }) as const,
      ),
    findRuns: async () => runs,
  };
  const admit = async (
    declaration: Pick<ServingRosterDeclaration, "processId" | "image" | "steps">,
  ) => {
    const roster = createServingRoster({ ledger: rosterLedger, ...SERVING_ROSTER_TIMING });
    const gate = createUpgradeGate({
      role: "worker",
      processId: declaration.processId,
      image: {
        name: declaration.image,
        release: null,
        blockingSteps: [],
        declaredSteps: declaration.steps,
      },
      ledger,
      roster,
      schemaIsEmpty: async () => false,
      rollback: {
        reopen: async ({ ids }) => {
          if (refuseReopen) throw new Error("ledger refused the reopen");
          const done = ids.filter((id) => status.get(id) === "done");
          for (const id of done) status.set(id, "pending");
          return done;
        },
        onReopened: (input) => reopened.push(input),
        onError: (error) => errors.push(error),
      },
    });
    const verdict = await gate.admit();
    await roster.stop().catch(() => undefined);
    return verdict;
  };
  return { status, reopened, errors, admit, refuse: () => void (refuseReopen = true) };
}

describe("rollback detection from the serving roster", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-06T22:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "An older image serving after the last run reopens the background steps it does not declare" */
  it("reopens the done step the older image does not declare, naming the image", async () => {
    const { status, reopened, admit } = installation();
    // roster.stop removes the row, so the sighting is made inside admit, while the row is live.
    await admit({ processId: "worker-old-1", image: "git-0ld0000", steps: [] });
    expect(status.get(STEP)).toBe("pending");
    expect(reopened).toEqual([
      {
        ids: [STEP],
        reason: "reopened: image git-0ld0000 (worker-old-1) served after upgrade run run_1",
      },
    ]);
  });

  /** @scenario "A rollback seen twice reopens the steps once" */
  it("reopens nothing when a second process of the older image is admitted", async () => {
    const { reopened, admit } = installation();
    await admit({ processId: "worker-old-1", image: "git-0ld0000", steps: [] });
    await admit({ processId: "worker-old-2", image: "git-0ld0000", steps: [] });
    expect(reopened).toHaveLength(1);
  });

  /** @scenario "A process that declares every done background step reopens nothing" */
  it("reopens nothing for a process that declares the step", async () => {
    const { status, reopened, admit } = installation();
    await admit({ processId: "worker-new-1", image: "git-abc1234", steps: [STEP] });
    expect(status.get(STEP)).toBe("done");
    expect(reopened).toEqual([]);
  });

  /** @scenario "A ledger with no finished upgrade run reopens nothing" */
  it("reopens nothing before any upgrade run finished", async () => {
    const { status, admit } = installation({ runs: [] });
    await admit({ processId: "worker-old-1", image: "git-0ld0000", steps: [] });
    expect(status.get(STEP)).toBe("done");
  });

  /** @scenario "A reopen that fails does not refuse the start" */
  it("admits the process and reports the failed reopen", async () => {
    const { errors, admit, refuse } = installation();
    refuse();
    expect(
      await admit({ processId: "worker-old-1", image: "git-0ld0000", steps: [] }),
    ).toMatchObject({
      admitted: true,
    });
    expect(errors).toHaveLength(1);
  });

  it("ignores a row that started before the last run, and a step retired below the image", () => {
    const row = {
      processId: "p",
      image: "3.21.0",
      release: "3.21.0",
      steps: [],
      startedAt: RUN_FINISHED,
    };
    const steps = [
      { id: STEP, status: "done", mode: "background", release: null },
      { id: "old:retired", status: "done", mode: "background", release: "3.19.0" },
    ] as const;
    expect(detectRollbacks({ runs: [lastRun], steps, live: [row] })).toEqual([]);
    const later = { ...row, startedAt: new Date(RUN_FINISHED.getTime() + 1) };
    expect(detectRollbacks({ runs: [lastRun], steps, live: [later] })).toEqual([
      { row: later, runId: "run_1", stepIds: [STEP] },
    ]);
  });
});
