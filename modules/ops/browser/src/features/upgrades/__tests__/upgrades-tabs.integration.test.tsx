/**
 * @vitest-environment jsdom
 * The Upgrades page tabs: Overview, Runs, Steps, Organizations, Dataplanes with a private target.
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
        runs={<p>The runs</p>}
        steps={<p>The steps</p>}
        organizations={<p>The organizations</p>}
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

  describe("given only the shared ClickHouse target", () => {
    /** @scenario "The dataplanes tab is hidden when no private target exists" */
    it("offers no Dataplanes tab", () => {
      renderTabs([
        { target: "shared", version: "00042", outstanding: 0, lastError: null, route: "present" },
      ]);

      expect(screen.queryByRole("tab", { name: "Dataplanes" })).toBeNull();
    });
  });

  describe("given two private targets, one with a failed step", () => {
    it("lists each target's version, outstanding steps and the failed one's last error", async () => {
      renderTabs([
        { target: "eu-1", version: "00042", outstanding: 0, lastError: null, route: "present" },
        {
          target: "us-1",
          version: "00041",
          outstanding: 2,
          lastError: "Code 241: memory limit",
          route: "present",
        },
      ]);

      fireEvent.click(screen.getByRole("tab", { name: "Dataplanes" }));

      const failed = await screen.findByTestId("upgrade-dataplane-us-1");
      expect(failed.textContent).toContain("00041");
      expect(failed.textContent).toContain("2");
      expect(failed.textContent).toContain("Code 241: memory limit");
      expect(screen.getByTestId("upgrade-dataplane-eu-1").textContent).toContain("00042");
    });
  });

  describe("given the shared target and a private one", () => {
    /** @scenario "The dataplanes tab lists the shared ClickHouse target beside the private ones" */
    it("lists the shared target first with its version and outstanding steps", async () => {
      renderTabs([
        {
          target: "private:org_1",
          version: "00041",
          outstanding: 1,
          lastError: null,
          route: "present",
        },
        { target: "shared", version: "00042", outstanding: 3, lastError: null, route: "present" },
      ]);

      fireEvent.click(screen.getByRole("tab", { name: "Dataplanes" }));

      const shared = await screen.findByTestId("upgrade-dataplane-shared");
      expect(shared.textContent).toContain("00042");
      expect(shared.textContent).toContain("3");
      const rows = screen.getAllByTestId(/^upgrade-dataplane-(shared|private:org_1)$/);
      expect(rows.map((row) => row.dataset.testid)).toEqual([
        "upgrade-dataplane-shared",
        "upgrade-dataplane-private:org_1",
      ]);
    });
  });

  describe("given a private target whose route variable is missing", () => {
    /** @scenario "The dataplanes tab marks a private target whose route is missing or malformed" */
    it("marks that target's route as missing and the organization as refused", async () => {
      renderTabs([
        {
          target: "private:org_1",
          version: "00042",
          outstanding: 0,
          lastError: null,
          route: "missing",
        },
        {
          target: "private:org_2",
          version: "00042",
          outstanding: 0,
          lastError: null,
          route: "malformed",
        },
      ]);

      fireEvent.click(screen.getByRole("tab", { name: "Dataplanes" }));

      const missing = await screen.findByTestId("upgrade-dataplane-route-private:org_1");
      expect(missing.textContent).toContain("Missing");
      expect(screen.getByTestId("upgrade-dataplane-route-private:org_2").textContent).toContain(
        "Malformed",
      );
    });
  });

  describe("given an operator opens the Organizations tab", () => {
    /** @scenario "Organizations are a tab of the Upgrades page" */
    it("offers Overview, Runs, Steps and Organizations and opens the organizations", async () => {
      renderTabs([]);

      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Overview",
        "Runs",
        "Steps",
        "Organizations",
      ]);
      fireEvent.click(screen.getByRole("tab", { name: "Organizations" }));

      expect(await screen.findByText("The organizations")).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Organizations" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });
});
