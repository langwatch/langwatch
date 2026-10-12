/** @see modules/experiment/specs/experiment-list-page.feature */
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import { rowViewOf } from "../experiment-list-row-view.ts";
import type { ExperimentListRow } from "../experiment-list-row.ts";

const NOW = 5_000_000;

const runOf = (n: number, passed: number): ExperimentRun => ({
  experimentId: "e",
  runId: `r${n}`,
  workflowVersion: null,
  timestamps: { createdAt: n * 1000, updatedAt: n * 1000, finishedAt: n * 1000 + 1 },
  summary: {
    datasetCost: 0.5,
    evaluations: { c: { name: "correct", averageScore: passed, averagePassed: passed } },
  },
});

const row = (overrides: Partial<ExperimentListRow> = {}): ExperimentListRow => ({
  id: "e",
  slug: "e",
  name: "E",
  type: "EVALUATIONS_V3",
  createdAt: 0,
  updatedAt: 0,
  workflowId: null,
  workbenchState: { targets: [{}, {}] },
  runsSummary: {
    count: 3,
    primaryMetric: { name: "correct", averageScore: 0.8, averagePassed: 0.8 },
    latestRun: { timestamps: { createdAt: 3000, finishedAt: 3001 } },
  },
  ...overrides,
});

const runs = [runOf(1, 0.6), runOf(2, 0.7), runOf(3, 0.8)];
const view = (overrides: Partial<Parameters<typeof rowViewOf>[0]> = {}) =>
  rowViewOf({
    experiment: row(),
    runs,
    chosenKey: undefined,
    loading: false,
    nowMs: NOW,
    ...overrides,
  });

describe("given a list row", () => {
  describe("when its runs have come and match the list", () => {
    it("completes the row: change, history, cost, targets and items", () => {
      const result = view();
      expect(result.headline?.value).toBe(80);
      expect(result.change).toMatchObject({ text: "10.0 pt better", against: 2 });
      expect(result.sparkline).toEqual([60, 70, 80]);
      expect(result.cost).toBe(0.5);
      expect(result.targets).toBe(2);
      expect(result.status).toBe("completed");
    });

    it("counts items from the run's cells over the targets, for a workbench row only", () => {
      const withCells = runs.map((entry) => ({ ...entry, total: 1600 }));
      expect(view({ runs: withCells }).items).toBe(800);
      expect(
        view({
          runs: withCells,
          experiment: row({ type: "BATCH_EVALUATION_V2", workbenchState: null }),
        }).items,
      ).toBeUndefined();
    });
  });

  describe("when its runs have not come, or are out of date", () => {
    it("draws from the list alone and waits for the runs", () => {
      const result = view({ runs: [], loading: true });
      expect(result.headline?.value).toBe(80);
      expect(result.change).toBeUndefined();
      expect(result.sparkline).toEqual([]);
      expect(result.metrics).toEqual([]);
      expect(result.state).toBe("loading");
    });

    it("ignores cached runs the list has moved past", () => {
      const result = view({ runs: runs.slice(0, 2) });
      expect(result.fresh).toBe(false);
      expect(result.change).toBeUndefined();
    });

    it("says no result when the runs failed and the list has none", () => {
      const result = view({
        runs: [],
        experiment: row({ runsSummary: { count: 3, primaryMetric: null } }),
      });
      expect(result.headline).toBeUndefined();
      expect(result.state).toBe("no-result");
    });
  });

  describe("when a run that was going has finished since the runs were cached", () => {
    const running = { ...runs[2]!, timestamps: { createdAt: 3000, updatedAt: 3500 } };
    const finishedInList = row({
      runsSummary: {
        count: 3,
        primaryMetric: { name: "correct", averageScore: 0.9, averagePassed: 0.9 },
        latestRun: { timestamps: { createdAt: 3000, updatedAt: 3600, finishedAt: 3600 } },
      },
    });

    /** @scenario A finished run replaces the partial numbers of a running one */
    it("takes the list's numbers, not the cached partial ones, and says Finished", () => {
      const result = view({ experiment: finishedInList, runs: [runs[0]!, runs[1]!, running] });
      expect(result.fresh).toBe(false);
      expect(result.status).toBe("completed");
      expect(result.headline?.value).toBe(90);
      expect(result.change).toBeUndefined();
    });

    /** @scenario A running run shows no change chip */
    it("shows no change chip while the latest run is still running", () => {
      const going = row({
        runsSummary: {
          count: 3,
          primaryMetric: { name: "correct", averageScore: 0.8, averagePassed: 0.8 },
          latestRun: { timestamps: { createdAt: 3000, updatedAt: NOW - 10 } },
        },
      });
      const live = { ...runs[2]!, timestamps: { createdAt: 3000, updatedAt: NOW - 10 } };
      const result = view({ experiment: going, runs: [runs[0]!, runs[1]!, live] });
      expect(result.fresh).toBe(true);
      expect(result.status).toBe("running");
      expect(result.change).toBeUndefined();
      expect(result.headline?.value).toBe(80);
    });
  });

  describe("when the row waits for its runs", () => {
    /** @scenario A row waiting for its runs shows a placeholder */
    it("is loading, not 'no result', before the first answer", () => {
      const bare = row({ runsSummary: { count: 3, primaryMetric: null } });
      expect(view({ experiment: bare, runs: [], loading: true }).state).toBe("loading");
    });
  });

  describe("when every evaluator reports categories only", () => {
    /** @scenario Categories-only evaluators say so */
    it("says there are no numeric results, not that there are no evaluators", () => {
      const categories = runs.map((entry) => ({
        ...entry,
        summary: { evaluations: { k: { name: "kind", averageScore: null } } },
      }));
      expect(view({ runs: categories }).state).toBe("no-numeric");
    });
  });

  describe("when the runs report no evaluator or the experiment never ran", () => {
    it("says so in its own words", () => {
      const bare = runs.map((entry) => ({ ...entry, summary: { evaluations: {} } }));
      const listOnly = row({
        runsSummary: { count: 3, latestRun: { timestamps: { createdAt: 3000 } } },
      });
      expect(view({ runs: bare, experiment: listOnly }).state).toBe("no-evaluators");
      expect(view({ runs: [], experiment: row({ runsSummary: { count: 0 } }) }).state).toBe(
        "no-runs",
      );
    });
  });

  describe("when the latest run is going", () => {
    it("carries the cells done of the cells in total", () => {
      const latest = {
        ...runs[2]!,
        timestamps: { createdAt: 3000, updatedAt: NOW - 10 },
        progress: 1024,
        total: 1600,
      };
      const going = row({
        runsSummary: {
          count: 3,
          primaryMetric: { name: "correct", averageScore: 0.8, averagePassed: 0.8 },
          latestRun: { timestamps: { createdAt: 3000, updatedAt: NOW - 10 } },
        },
      });
      const result = view({ experiment: going, runs: [runs[0]!, runs[1]!, latest] });
      expect(result.status).toBe("running");
      expect(result.progress).toEqual({ done: 1024, total: 1600 });
    });
  });
});
