/**
 * @vitest-environment jsdom
 * The Upgrades page tabs: Tenant migrations always, Dataplanes only with a private target.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { UpgradeTargetSummaryView } from "../model/upgrade-view.ts";
import { UpgradesTabs } from "../ui/sections/upgrades-tabs.tsx";

afterEach(cleanup);

function renderTabs(targets: UpgradeTargetSummaryView[]) {
  render(
    <DesignSystemProvider forcedTheme="light">
      <UpgradesTabs
        targets={targets}
        overview={<p>The overview</p>}
        tenants={<p>The tenant migrations</p>}
      />
    </DesignSystemProvider>,
  );
}

describe("UpgradesTabs", () => {
  describe("given the ledger records no per-target rows", () => {
    /** @scenario "The dataplanes tab is hidden when no private target exists" */
    it("shows the overview and offers no Dataplanes tab", () => {
      renderTabs([]);

      expect(screen.getByText("The overview")).toBeTruthy();
      expect(screen.queryByRole("tab", { name: "Dataplanes" })).toBeNull();
    });
  });

  describe("given two private targets, one with a failed step", () => {
    it("lists each target's version, outstanding steps and the failed one's last error", async () => {
      renderTabs([
        { target: "eu-1", version: "00042", outstanding: 0, lastError: null },
        { target: "us-1", version: "00041", outstanding: 2, lastError: "Code 241: memory limit" },
      ]);

      fireEvent.click(screen.getByRole("tab", { name: "Dataplanes" }));

      const failed = await screen.findByTestId("upgrade-dataplane-us-1");
      expect(failed.textContent).toContain("00041");
      expect(failed.textContent).toContain("2");
      expect(failed.textContent).toContain("Code 241: memory limit");
      expect(screen.getByTestId("upgrade-dataplane-eu-1").textContent).toContain("00042");
    });
  });

  describe("given an operator opens the Tenant migrations tab", () => {
    /** @scenario "Tenant migrations are a tab of the Upgrades page" */
    it("opens the tenant migrations", async () => {
      renderTabs([]);

      fireEvent.click(screen.getByRole("tab", { name: "Tenant migrations" }));

      expect(await screen.findByText("The tenant migrations")).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Tenant migrations" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });
});
