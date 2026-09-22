import { describe, expect, it } from "vitest";

import { traceViewContextChip } from "../view-context-chip.ts";

const timeRange = {
  from: Date.UTC(2026, 0, 1),
  to: Date.UTC(2026, 0, 8),
  label: "Last 7 days",
  presetId: "7d",
};

/**
 * The Explorer view as one chip: what "these traces" means before the reader
 * has selected anything. Spec: specs/traces-v2/search.feature.
 */
describe("traceViewContextChip", () => {
  describe("given a lens, a grouping, a sort and a search", () => {
    it("says all of them, with the exact timestamps the range covers", () => {
      const chip = traceViewContextChip({
        queryText: "  status:error  ",
        timeRange,
        lens: { id: "conversations", name: "Conversations", isSavedView: false },
        grouping: "by-conversation",
        sort: { columnId: "startedAt", direction: "desc" },
      });

      expect(chip.label).toBe("Traces · Conversations · Last 7 days · searched");
      expect(chip.ref).toBe(
        [
          "data source: traces",
          "time range: Last 7 days",
          "from: 2026-01-01T00:00:00.000Z",
          "to: 2026-01-08T00:00:00.000Z",
          "built-in lens: Conversations (id: conversations)",
          "grouping: by-conversation",
          "sort: startedAt desc",
          "search and attribute filters: status:error",
        ].join("; "),
      );
      expect(chip.id).toBe("view:traces:conversations:7d:status:error");
    });
  });

  describe("given a saved view the reader has edited", () => {
    it("says it is a saved view, and that it has changes the table is showing", () => {
      const chip = traceViewContextChip({
        queryText: "",
        timeRange,
        lens: { id: "lens_1", name: "Checkout", isSavedView: true, hasLocalChanges: true },
      });

      expect(chip.ref).toContain("saved view: Checkout (id: lens_1); local changes: yes");
      // Nothing typed, so the label does not claim a search.
      expect(chip.label).toBe("Traces · Checkout · Last 7 days");
    });
  });

  describe("given nothing typed and no lens", () => {
    it("describes the complete unfiltered Trace Explorer view", () => {
      const chip = traceViewContextChip({ queryText: "", timeRange });

      expect(chip.label).toBe("Traces · Last 7 days");
      expect(chip.ref).toContain("data source: traces");
      expect(chip.ref).not.toContain("search and attribute filters");
    });
  });

  describe("given a query with quotes and operators", () => {
    it("carries it exactly, without turning it into the label", () => {
      const chip = traceViewContextChip({
        queryText: 'status:"error" AND duration:>5m',
        timeRange,
      });

      expect(chip.label).toBe("Traces · Last 7 days · searched");
      expect(chip.ref).toContain('search and attribute filters: status:"error" AND duration:>5m');
    });
  });

  describe("given a range the reader dragged out themselves", () => {
    it("names it as a custom range and keys the chip on its bounds", () => {
      const chip = traceViewContextChip({
        queryText: "",
        timeRange: { from: timeRange.from, to: timeRange.to },
      });

      expect(chip.ref).toContain("time range: Custom time range");
      expect(chip.id).toBe(`view:traces:default:${timeRange.from}:${timeRange.to}:`);
    });
  });
});
