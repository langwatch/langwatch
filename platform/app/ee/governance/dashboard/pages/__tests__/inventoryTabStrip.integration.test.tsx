// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Inventory tab strip: which panes exist, in what order, and what the
 * Catalog tab counts.
 *
 * A tab that appears here is a claim that the organization runs the thing it
 * names, which is why the absences are asserted as loudly as the presences.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { connectTools, renderScreen } from "./inventoryScreenHarness";

describe("given an admin on the Inventory page", () => {
  describe("when the tab strip renders", () => {
    /** @scenario "The Environments tab sits between Catalog and Sources" */
    it("reads Catalog, Environments and Sources, with no Approvals or Anomaly rules", () => {
      renderScreen();
      const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
      expect(tabs.map((label) => label?.replace(/\d+$/, "").trim())).toEqual([
        "Catalog",
        "Environments",
        "Sources",
      ]);
      expect(screen.queryByRole("tab", { name: /approvals/i })).toBeNull();
      // A rule is a standing instruction about what to watch for, not a thing
      // the organization runs, so it is not part of an inventory. Asserted by
      // absence rather than left to the list above, because a tab appended
      // after Sources would otherwise only fail the equality on its way past.
      expect(screen.queryByRole("tab", { name: /anomaly/i })).toBeNull();
    });

    /** @scenario "The tab says how many tools are in the catalog" */
    it("counts registered tools on the Catalog tab, not connected sources", () => {
      connectTools();
      renderScreen();
      // Three tools registered against two sources connected, so a count read
      // off the wrong list is visible here rather than being a coincidence.
      expect(screen.getAllByRole("tab")[0]?.textContent).toContain("3");
      expect(screen.getAllByRole("tab")[2]?.textContent).toContain("2");
    });
  });
});
