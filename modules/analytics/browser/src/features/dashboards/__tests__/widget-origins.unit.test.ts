/**
 * The origins one widget leaves out: its own "Langy traces" setting, else its board's.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200
 */

import { describe, expect, it } from "vitest";

import { boardIncludesLangy, widgetExcludedOrigins } from "../model/board-period.ts";

describe("widgetExcludedOrigins", () => {
  describe("given a widget that stores no setting", () => {
    /** @scenario "AC200 Langy setting: the widget editor shows the setting a widget runs with" */
    it("runs with what its board leaves out", () => {
      expect(widgetExcludedOrigins({ stored: undefined, board: ["langy"] })).toEqual(["langy"]);
      expect(widgetExcludedOrigins({ stored: undefined, board: [] })).toEqual([]);
    });
  });

  describe("given a widget saved as Included on a board that leaves Langy out", () => {
    /** @scenario "AC200b Langy setting: a widget saved as Included runs with no origin left out" */
    it("leaves out nothing", () => {
      const excluded = widgetExcludedOrigins({ stored: [], board: ["langy"] });

      expect(excluded).toEqual([]);
      expect(boardIncludesLangy({ excluded })).toBe(true);
    });
  });

  describe("given a widget saved as Left out on a board that includes Langy", () => {
    /** @scenario "AC200f Langy setting: a widget that stores none follows its board's stored setting, else the default" */
    it("keeps its own setting over the board's", () => {
      expect(widgetExcludedOrigins({ stored: ["langy"], board: [] })).toEqual(["langy"]);
    });
  });
});
