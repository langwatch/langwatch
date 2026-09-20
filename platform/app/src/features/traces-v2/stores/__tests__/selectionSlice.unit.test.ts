/**
 * What the trace-table selection will and will not hold.
 * See specs/traces-v2/bulk-actions.feature.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useExplorerStore } from "../explorerStore";

const selection = () =>
  Array.from(useExplorerStore.getState().selection.traceIds);

beforeEach(() => {
  useExplorerStore.getState().clearSelection();
});

describe("given the trace-table selection", () => {
  describe("when ids that address no trace are selected", () => {
    /** @scenario "The selection never holds a blank or placeholder id" */
    it("keeps the real ids and drops the blank ones", () => {
      useExplorerStore
        .getState()
        .setSelectedMany(["trace-a", "", "   ", "trace-b"], true);

      expect(selection()).toEqual(["trace-a", "trace-b"]);
    });

    /** @scenario "The selection never holds a blank or placeholder id" */
    it("refuses a blank id toggled on its own", () => {
      useExplorerStore.getState().toggleSelected("  ");

      expect(selection()).toEqual([]);
    });

    /** @scenario "The selection never holds a blank or placeholder id" */
    it("still takes ids back out, so nothing can get stuck", () => {
      useExplorerStore.getState().setSelectedMany(["trace-a", "trace-b"], true);
      useExplorerStore
        .getState()
        .setSelectedMany(["trace-a", "", "trace-b"], false);

      expect(selection()).toEqual([]);
    });
  });
});
