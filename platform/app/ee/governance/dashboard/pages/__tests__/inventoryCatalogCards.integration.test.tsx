// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Catalog pane: what a card says about a connected tool, and what it
 * refuses to say about one nobody has measured.
 *
 * The hard rule under test is that a figure is either measured or absent. A
 * card that fills a gap with a plausible number is the one failure this
 * screen cannot afford, because it is read before a renewal is signed.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { connectTools, openTab, renderScreen } from "./inventoryScreenHarness";

describe("given an admin on the Inventory page", () => {
  describe("when the page renders with tools connected", () => {
    beforeEach(connectTools);

    // The rulebook's badge scenario has two clauses and the second is the one
    // that protects the reader: a badge on every card, sample or not, would be
    // decoration rather than a warning. The sample half is asserted in the
    // sample-mode block below; this is the measured half, and the pair of them
    // is what the scenario actually claims.
    /** @scenario "Every invented panel is marked, by a badge or by a banner above it" */
    it("leaves the badge off cards built from real connected tools", () => {
      renderScreen();
      const cards = screen
        .getByTestId("tool-catalog-cards")
        .querySelectorAll("[data-testid^='tool-card-']");
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.textContent).not.toMatch(/sample/i);
      }
    });

    /** @scenario "A registered tool is a card carrying its name and its vendor" */
    it("shows a card per connected tool with its name and vendor", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-src-genie");
      expect(within(card).getByText("Warehouse questions")).toBeInTheDocument();
      expect(
        within(card).getByText(/Databricks AI\/BI Genie/),
      ).toBeInTheDocument();
    });

    /** @scenario "The one row this branch measures carries its real figure" */
    it("shows the measured event count under the window it was counted over", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-src-genie");
      expect(within(card).getByText("Events · 24 hours")).toBeInTheDocument();
      expect(within(card).getByText("1,234")).toBeInTheDocument();
    });

    /** @scenario "A row nothing measures shows a dash naming what would fill it" */
    it("draws a dash naming the missing read for every unmeasured row", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-src-genie");
      const dashes = within(card).getAllByLabelText(/not measured\./);
      // Nine of the ten rows have no read keyed by tool on this branch. The
      // count is asserted rather than "more than none" so a card that quietly
      // stopped drawing dashes at all cannot pass this.
      expect(dashes).toHaveLength(9);
      for (const dash of dashes) {
        expect(dash.getAttribute("aria-label")).toMatch(/not measured\. .+\.$/);
      }
      // A row we cannot read is never drawn as a zero.
      expect(within(card).queryByText("0")).toBeNull();
    });

    /** @scenario "An environment a source points at is listed without being created" */
    it("lists a discovered environment badged with the source it came from", async () => {
      renderScreen();
      await openTab(/Environments/);
      const table = await screen.findByTestId("environments-table");
      expect(
        within(table).getByText("example-env.crm.test"),
      ).toBeInTheDocument();
      expect(
        within(table).getByText("Discovered from Assistant transcripts"),
      ).toBeInTheDocument();
    });

    /** @scenario "A discovered row says nobody created it" */
    it("says a discovered environment was discovered automatically", async () => {
      renderScreen();
      await openTab(/Environments/);
      const table = await screen.findByTestId("environments-table");
      expect(
        within(table).getAllByText("Discovered automatically").length,
      ).toBeGreaterThan(0);
    });

    /** @scenario "Sample environments replace discovered environments until disabled" */
    it("replaces discovered environments and restores them when samples are off", async () => {
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      await openTab(/Environments/);
      const table = await screen.findByTestId("environments-table");
      expect(within(table).getByText("Production")).toBeInTheDocument();
      expect(within(table).queryByText("example-env.crm.test")).toBeNull();
      await userEvent.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );
      expect(
        within(table).getByText("example-env.crm.test"),
      ).toBeInTheDocument();
      expect(within(table).queryByText("Production")).toBeNull();
    });

    /** @scenario "Sample sources replace real sources without offering real actions" */
    it("replaces real sources with read-only samples until disabled", async () => {
      renderScreen();
      await openTab(/Sources/);
      expect(screen.getByTestId("source-row-src-genie")).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      expect(screen.queryByTestId("source-row-src-genie")).toBeNull();
      const rows = screen.getAllByTestId(/^source-row-/);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(within(row).queryByRole("link")).toBeNull();
        expect(within(row).queryByRole("button")).toBeNull();
      }
      await userEvent.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );
      expect(screen.getByTestId("source-row-src-genie")).toBeInTheDocument();
    });

    /** @scenario "The catalog is offered as a grid or as a list" */
    it("switches the cards between a grid and a single column", async () => {
      renderScreen();
      expect(screen.getByTestId("tool-catalog-cards")).toHaveAttribute(
        "data-layout",
        "grid",
      );
      await userEvent.click(screen.getByRole("radio", { name: /List/ }));
      await waitFor(() =>
        expect(screen.getByTestId("tool-catalog-cards")).toHaveAttribute(
          "data-layout",
          "list",
        ),
      );
    });

    /** @scenario "Sample mode replaces the cards rather than filling them in" */
    it("shows the sample tools and no card built from a real source", async () => {
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      expect(
        await screen.findByTestId("tool-card-sample-claude-code"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("tool-card-src-genie")).toBeNull();
    });
  });

  describe("when the catalog is in view", () => {
    /** @scenario "Adding a tool opens the same menu that adds a source" */
    it("offers the Add source menu's own tools behind Add tool", async () => {
      renderScreen();
      await userEvent.click(
        screen.getAllByRole("button", { name: /Add tool/ })[0]!,
      );
      expect(
        await screen.findByRole("menuitem", {
          name: /Databricks AI\/BI Genie/,
        }),
      ).toBeInTheDocument();
    });

    /** @scenario "The tool tiles and the starter pack are gone from this page" */
    it("renders no tile editor, tile section or starter pack", () => {
      renderScreen();
      const page = document.body.textContent ?? "";
      expect(page).not.toMatch(/starter pack/i);
      expect(page).not.toMatch(/tool tiles/i);
      expect(page).not.toMatch(/ingestion templates/i);
      expect(page).not.toMatch(/add tile/i);
      expect(page).not.toMatch(/coding assistants/i);
    });
  });
});
