/**
 * What the trace-table selection will and will not hold.
 * See specs/traces-v2/bulk-actions.feature.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "../selectionStore";

const selection = () => Array.from(useSelectionStore.getState().traceIds);

beforeEach(() => {
  useSelectionStore.getState().clear();
});

describe("given the trace-table selection", () => {
  describe("when ids that address no trace are selected", () => {
    /** @scenario "The selection never holds a blank or placeholder id" */
    it("keeps the real ids and drops the blank ones", () => {
      useSelectionStore
        .getState()
        .setMany(["trace-a", "", "   ", "trace-b"], true);

      expect(selection()).toEqual(["trace-a", "trace-b"]);
    });

    /** @scenario "The selection never holds a blank or placeholder id" */
    it("refuses a blank id toggled on its own", () => {
      useSelectionStore.getState().toggle("  ");

      expect(selection()).toEqual([]);
    });

    /** @scenario "The selection never holds a blank or placeholder id" */
    it("still takes ids back out, so nothing can get stuck", () => {
      useSelectionStore.getState().setMany(["trace-a", "trace-b"], true);
      useSelectionStore.getState().setMany(["trace-a", "", "trace-b"], false);

      expect(selection()).toEqual([]);
    });
  });
});
