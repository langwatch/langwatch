/** @see modules/experiment/specs/experiment-list-page.feature */
import { describe, expect, it } from "vitest";

import {
  filterExperiments,
  groupByKind,
  isNarrowed,
  kindOptions,
  NO_FILTERS,
  pageOf,
} from "../experiment-list-filter.ts";
import type { ExperimentListRow } from "../experiment-list-row.ts";

const NOW = 10_000_000;

const row = (id: string, overrides: Partial<ExperimentListRow> = {}): ExperimentListRow => ({
  id,
  slug: id,
  name: `Experiment ${id}`,
  type: "BATCH_EVALUATION_V2",
  createdAt: 0,
  updatedAt: 0,
  workflowId: null,
  runsSummary: { count: 1, latestRun: { timestamps: { finishedAt: NOW - 1 } } },
  ...overrides,
});

const rows = [
  row("sdk-done"),
  row("bench-running", {
    type: "EVALUATIONS_V3",
    dataset: { id: "d1", name: "tickets-v2" },
    runsSummary: { count: 2, latestRun: { timestamps: { updatedAt: NOW - 1000 } } },
  }),
  row("bench-stopped", {
    type: "EVALUATIONS_V3",
    runsSummary: { count: 1, latestRun: { timestamps: { stoppedAt: NOW - 5 } } },
  }),
  row("never", { runsSummary: { count: 0 } }),
];

const ids = (found: ExperimentListRow[]) => found.map((entry) => entry.id);

describe("given the experiments of a project", () => {
  describe("when nothing is typed or picked", () => {
    it("is not narrowed and keeps every row in its order", () => {
      expect(isNarrowed(NO_FILTERS)).toBe(false);
      expect(ids(filterExperiments({ rows, filters: NO_FILTERS, nowMs: NOW }))).toEqual(ids(rows));
    });
  });

  describe("when searching", () => {
    it("matches the name, the dataset and the kind, ignoring case", () => {
      const search = (query: string) =>
        ids(filterExperiments({ rows, filters: { ...NO_FILTERS, query }, nowMs: NOW }));
      expect(search("SDK-DONE")).toEqual(["sdk-done"]);
      expect(search("tickets")).toEqual(["bench-running"]);
      expect(search("workbench")).toEqual(["bench-running", "bench-stopped"]);
      expect(search("nothing like this")).toEqual([]);
    });
  });

  describe("when filtering by how it ran and by state", () => {
    /** @scenario Filters read the experiment's kind and its latest run's state */
    it("keeps the kind asked for", () => {
      const found = filterExperiments({
        rows,
        filters: { ...NO_FILTERS, kinds: ["Workbench"] },
        nowMs: NOW,
      });
      expect(ids(found)).toEqual(["bench-running", "bench-stopped"]);
    });

    /** @scenario Filters read the experiment's kind and its latest run's state */
    it("reads the state from the latest run's timestamps, with no runs call", () => {
      const state = (statuses: ("running" | "completed" | "stopped")[]) =>
        ids(filterExperiments({ rows, filters: { ...NO_FILTERS, statuses }, nowMs: NOW }));
      expect(state(["running"])).toEqual(["bench-running"]);
      expect(state(["completed"])).toEqual(["sdk-done"]);
      expect(state(["stopped", "running"])).toEqual(["bench-running", "bench-stopped"]);
    });

    it("combines both, and never lists a row that never ran under a state", () => {
      const found = filterExperiments({
        rows,
        filters: { query: "", kinds: ["SDK"], statuses: ["completed"] },
        nowMs: NOW,
      });
      expect(ids(found)).toEqual(["sdk-done"]);
    });
  });
});

describe("given experiments of several kinds", () => {
  it("offers the four kinds, then any other label the rows carry", () => {
    const legacy = row("scan", {
      type: "BATCH_EVALUATION",
      workbenchState: { task: "scan" },
    });
    expect(kindOptions([legacy])).toEqual([
      "SDK",
      "Batch experiment",
      "DSPy optimization",
      "Workbench",
      "Vulnerability scan",
    ]);
  });

  it("groups by kind with the biggest group first", () => {
    const groups = groupByKind(rows);
    expect(groups.map((group) => [group.key, group.rows.length])).toEqual([
      ["SDK", 2],
      ["Workbench", 2],
    ]);
  });
});

describe("given a filtered list", () => {
  it("pages it here", () => {
    const list = [1, 2, 3, 4, 5];
    expect(pageOf({ rows: list, page: 2, pageSize: 2 })).toEqual([3, 4]);
    expect(pageOf({ rows: list, page: 3, pageSize: 2 })).toEqual([5]);
  });
});
