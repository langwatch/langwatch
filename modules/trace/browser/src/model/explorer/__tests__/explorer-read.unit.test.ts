/**
 * The read projection `explorer.getState` answers from an open page.
 * Spec: specs/traces-v2/explorer-actions.feature.
 */
import type { ExplorerState } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { activeFacetsOf, readLiveExplorer } from "../explorer-read.ts";

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

/** A settled Explorer on the default lens, with nothing searched. */
function explorerState(overrides: Partial<ExplorerState> = {}): ExplorerState {
  return {
    queryText: "",
    timeRange: {
      from: NOW - 30 * 24 * 3_600_000,
      to: NOW,
      label: "Last 30 days",
      presetId: "30d",
    },
    activeLensId: "all-traces",
    sort: { columnId: "time", direction: "desc" },
    grouping: "flat",
    columnOrder: ["time", "trace", "duration"],
    page: 1,
    pageSize: 50,
    selection: { mode: "explicit", traceIds: new Set<string>() },
    expandedRows: new Set<string>(),
    evalRuns: {},
    ...overrides,
  };
}

describe("readLiveExplorer", () => {
  describe("given the last read counted 412 traces", () => {
    /** @scenario "The live read carries the count the header shows" */
    it("says source live, the count and the ids on the page", () => {
      const read = readLiveExplorer({
        state: explorerState({ queryText: "status:error", page: 2 }),
        results: {
          totalHits: 412,
          itemNoun: "traces",
          pageTraceIds: ["trace-a", "trace-b"],
          isSettled: true,
        },
        lensName: "All",
      });

      expect(read).toMatchObject({
        source: "live",
        query: "status:error",
        lens: { id: "all-traces", name: "All" },
        page: 2,
        pageSize: 50,
        totalHits: 412,
        itemNoun: "traces",
        pageTraceIds: ["trace-a", "trace-b"],
      });
      expect(read.timeRange.presetId).toBe("30d");
    });
  });

  describe("given a query with an included and an excluded value", () => {
    /** @scenario "The live read lists the facets active in the query" */
    it("lists each value with its state", () => {
      expect(activeFacetsOf("status:error AND NOT model:gpt-5-mini")).toEqual([
        { field: "status", value: "error", state: "include" },
        { field: "model", value: "gpt-5-mini", state: "exclude" },
      ]);
    });

    it("lists nothing for a query that does not parse", () => {
      expect(activeFacetsOf("status:(")).toEqual([]);
    });
  });

  describe("given an Instant Eval run still judging behind the query", () => {
    /** @scenario "The live read names a running Instant Eval's progress" */
    it("carries the run's judged, total and matched counts", () => {
      const read = readLiveExplorer({
        state: explorerState(),
        results: { totalHits: 412, itemNoun: "traces", pageTraceIds: [], isSettled: true },
        instantEvalProgress: { runId: "run-1", judged: 3200, total: 10000, matched: 412 },
      });

      expect(read.instantEvalProgress).toEqual({
        runId: "run-1",
        judged: 3200,
        total: 10000,
        matched: 412,
      });
    });

    it("leaves the field out when no run is judging", () => {
      const read = readLiveExplorer({
        state: explorerState(),
        results: { totalHits: 0, itemNoun: "traces", pageTraceIds: [], isSettled: true },
        instantEvalProgress: null,
      });

      expect("instantEvalProgress" in read).toBe(false);
    });
  });

  describe("given a selection and open rows", () => {
    it("answers them as lists, so the read is plain JSON", () => {
      const read = readLiveExplorer({
        state: explorerState({
          selection: { mode: "explicit", traceIds: new Set(["trace-a"]) },
          expandedRows: new Set(["conversation-a"]),
        }),
        results: { totalHits: 1, itemNoun: "traces", pageTraceIds: [], isSettled: true },
      });

      expect(JSON.parse(JSON.stringify(read))).toMatchObject({
        selection: { mode: "explicit", traceIds: ["trace-a"] },
        expandedRows: ["conversation-a"],
      });
    });
  });
});
