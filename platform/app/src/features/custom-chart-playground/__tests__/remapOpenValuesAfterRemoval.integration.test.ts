/**
 * @vitest-environment jsdom
 *
 * The Queries tab keys its open-accordion state by row index. Removing a row
 * shifts every later row's index down by one, so the open-value map has to be
 * realigned in the same beat — otherwise an open row below the deleted one is
 * read against the wrong (or a now-missing) index and loses its open state.
 *
 * @see specs/analytics/custom-chart-playground.feature
 */

import { describe, expect, it } from "vitest";

import { remapOpenValuesAfterRemoval } from "../DashboardWidgetQueriesPanel";

describe("remapOpenValuesAfterRemoval", () => {
  describe("when removing a row above the open one", () => {
    it("shifts the open value down so it still points at the same row", () => {
      // Rows [0,1,2] with row 2 open; remove row 0 → row 2 becomes row 1.
      expect(remapOpenValuesAfterRemoval(["2"], 0)).toEqual(["1"]);
    });
  });

  describe("when removing the open row itself", () => {
    it("drops its value, leaving nothing open", () => {
      expect(remapOpenValuesAfterRemoval(["1"], 1)).toEqual([]);
    });
  });

  describe("when removing a row below the open one", () => {
    it("leaves the open value untouched", () => {
      expect(remapOpenValuesAfterRemoval(["0"], 2)).toEqual(["0"]);
    });
  });

  describe("when several rows are open across the removal point", () => {
    it("keeps each open row aligned", () => {
      // Rows [0,1,2,3] with 0 and 3 open; remove row 1 → 3 becomes 2.
      expect(remapOpenValuesAfterRemoval(["0", "3"], 1)).toEqual(["0", "2"]);
    });
  });
});
