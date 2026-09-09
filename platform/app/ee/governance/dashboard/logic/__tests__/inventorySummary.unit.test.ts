// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Inventory's resume strip, as figures rather than as pixels.
 *
 * The interesting claim is what happens when a count is NOT available: the
 * strip must say so rather than report an unmeasured organization as an empty
 * one, and a zero is a measurement.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
import { describe, expect, it } from "vitest";

import type { ToolCard } from "../../components/toolCatalog/toolCards";
import { inventorySummaryItems, vendorCount } from "../inventorySummary";

function card(id: string, vendor: string): ToolCard {
  return {
    id,
    name: id,
    vendor,
    sourceType: null,
    badges: [],
    applicableRows: [],
    values: {},
  };
}

const CARDS = [
  card("a", "Anthropic"),
  card("b", "Anthropic"),
  card("c", "OpenAI"),
];

describe("given the Inventory resume strip", () => {
  describe("when every count is available", () => {
    /** @scenario "A strip above the tabs resumes each pane" */
    it("says how many tools, environments and sources there are", () => {
      const items = inventorySummaryItems({
        cards: CARDS,
        environmentCount: 4,
        discoveredEnvironmentCount: 3,
        sourceCount: 2,
        activeSourceCount: 1,
      });
      expect(items.map((item) => [item.value, item.label])).toEqual([
        [3, "tools"],
        [4, "environments"],
        [2, "sources"],
      ]);
    });

    /** @scenario "A strip above the tabs resumes each pane" */
    it("hints the one fact worth knowing about each pane", () => {
      const items = inventorySummaryItems({
        cards: CARDS,
        environmentCount: 4,
        discoveredEnvironmentCount: 3,
        sourceCount: 2,
        activeSourceCount: 1,
      });
      expect(items.map((item) => item.hint)).toEqual([
        "2 vendors",
        "3 discovered from your sources",
        "1 active",
      ]);
    });
  });

  describe("when a count could not be read", () => {
    /** @scenario "A figure the page cannot measure is a dash, never a zero" */
    it("leaves the figure null rather than reporting zero", () => {
      const items = inventorySummaryItems({
        cards: null,
        environmentCount: 0,
        discoveredEnvironmentCount: 0,
        sourceCount: null,
        activeSourceCount: null,
      });
      // Null draws the em dash. A zero here would be the claim that this
      // organization runs no tools, which is a different sentence entirely.
      expect(items[0]?.value).toBeNull();
      expect(items[0]?.hint).toBeUndefined();
      expect(items[2]?.value).toBeNull();
      expect(items[2]?.hint).toBeUndefined();
    });
  });

  describe("when one tool is counted", () => {
    /** @scenario "A strip above the tabs resumes each pane" */
    it("says tool rather than tools", () => {
      const items = inventorySummaryItems({
        cards: [card("a", "Anthropic")],
        environmentCount: 1,
        discoveredEnvironmentCount: 1,
        sourceCount: 1,
        activeSourceCount: 1,
      });
      expect(items.map((item) => item.label)).toEqual([
        "tool",
        "environment",
        "source",
      ]);
      expect(items[0]?.hint).toBe("1 vendor");
    });
  });
});

describe("given a catalog of cards", () => {
  describe("when its vendors are counted", () => {
    /** @scenario "A strip above the tabs resumes each pane" */
    it("counts each vendor once however many tools it makes", () => {
      expect(vendorCount(CARDS)).toBe(2);
      expect(vendorCount([])).toBe(0);
    });
  });
});
