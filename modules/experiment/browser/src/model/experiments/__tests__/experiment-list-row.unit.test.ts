/** @see modules/experiment/specs/experiment-list-page.feature */
import { describe, expect, it } from "vitest";

import {
  datasetOfRow,
  experimentPathOf,
  lastRunStartedOf,
  runStatusOf,
  targetCountOfRow,
  RUN_STATUS_LABELS,
  shortDay,
  type ExperimentListRow,
} from "../experiment-list-row.ts";

const row = (overrides: Partial<ExperimentListRow> = {}): ExperimentListRow => ({
  id: "e1",
  slug: "my-exp",
  name: "My exp",
  type: "BATCH_EVALUATION_V2",
  createdAt: 0,
  updatedAt: 0,
  workflowId: null,
  runsSummary: { count: 1 },
  ...overrides,
});

describe("given an experiment row", () => {
  describe("when its name is linked", () => {
    it("leads an SDK experiment to the results page", () => {
      expect(experimentPathOf("proj", row())).toBe("/proj/experiments/my-exp");
    });

    it("leads a workbench experiment to the workbench", () => {
      expect(experimentPathOf("proj", row({ type: "EVALUATIONS_V3" }))).toBe(
        "/proj/experiments/workbench/my-exp",
      );
    });
  });

  describe("when the dataset is looked up", () => {
    it("reads the workbench's active dataset and counts the others", () => {
      const dataset = datasetOfRow(
        row({
          type: "EVALUATIONS_V3",
          workbenchState: {
            activeDatasetId: "d2",
            datasets: [
              { id: "d1", name: "first", type: "inline" },
              { id: "d2", name: "second", type: "saved", datasetId: "ds_9" },
            ],
          } as ExperimentListRow["workbenchState"],
        }),
      );
      expect(dataset).toEqual({ name: "second", extra: 1, datasetId: "ds_9" });
    });

    it("reads the workflow's dataset when there is no workbench setup", () => {
      expect(datasetOfRow(row({ dataset: { id: "ds_1", name: "tickets" } }))).toEqual({
        name: "tickets",
        extra: 0,
        datasetId: "ds_1",
      });
    });

    it("prefers the workflow's dataset over the workbench setup", () => {
      const dataset = datasetOfRow(
        row({
          dataset: { id: "ds_1", name: "tickets" },
          workbenchState: {
            datasets: [{ id: "d1", name: "inline-one", type: "inline" }],
          } as ExperimentListRow["workbenchState"],
        }),
      );
      expect(dataset).toEqual({ name: "tickets", extra: 0, datasetId: "ds_1" });
    });

    it("says nothing for an SDK run that recorded none", () => {
      expect(datasetOfRow(row())).toBeUndefined();
    });
  });

  describe("when the latest run's timestamps are read", () => {
    const now = 1_000_000_000;
    const status = (timestamps: object | null, count = 1) =>
      runStatusOf({ runsSummary: { count, latestRun: { timestamps } }, nowMs: now });

    it("is completed once finished, stopped once stopped", () => {
      expect(status({ finishedAt: now - 1 })).toBe("completed");
      expect(status({ stoppedAt: now - 1 })).toBe("stopped");
    });

    it("is running while recently touched and unfinished", () => {
      expect(status({ updatedAt: now - 1000 })).toBe("running");
    });

    /** @scenario An unfinished run left alone reads Stopped */
    it("is stopped, not finished, when unfinished and untouched for over five minutes", () => {
      expect(status({ updatedAt: now - 3_600_000 })).toBe("stopped");
      expect(status({ updatedAt: now - 5 * 60 * 1000 - 1 })).toBe("stopped");
    });

    it("is none with no runs, and finished when the list gives no times at all", () => {
      expect(status(null, 0)).toBe("none");
      expect(status(null)).toBe("completed");
    });

    it("starts the last run at the run's start, else at the experiment's update", () => {
      const withRun = row({
        updatedAt: 9_000,
        runsSummary: { count: 1, latestRun: { timestamps: { createdAt: 4_000 } } },
      });
      expect(lastRunStartedOf(withRun)).toBe(4_000);
      expect(lastRunStartedOf(row({ updatedAt: 9_000 }))).toBe(9_000);
    });
  });
});

describe("given the targets a workbench experiment is set up with", () => {
  it("counts them, and has no count for anything else", () => {
    const setup = (state: unknown) =>
      row({ workbenchState: state as ExperimentListRow["workbenchState"] });
    expect(targetCountOfRow(setup({ targets: [{}, {}, {}] }))).toBe(3);
    expect(targetCountOfRow(setup({ targets: [] }))).toBeUndefined();
    expect(targetCountOfRow(setup(null))).toBeUndefined();
    expect(targetCountOfRow(row())).toBeUndefined();
  });

  it("says Finished, not Completed, for a run that ended", () => {
    expect(RUN_STATUS_LABELS.completed).toBe("Finished");
  });
});

describe("given the day a run started", () => {
  /** @scenario A row shows its last run's day in short form */
  it("reads month and day, with the year only when it is not this one", () => {
    const sep25 = Date.UTC(2026, 8, 25, 12);
    const now = Date.UTC(2026, 9, 12, 12);
    expect(shortDay({ epochMs: sep25, nowMs: now })).toBe("Sep 25");
    expect(shortDay({ epochMs: sep25, nowMs: Date.UTC(2027, 0, 5, 12) })).toBe("Sep 25, 2026");
  });
});
