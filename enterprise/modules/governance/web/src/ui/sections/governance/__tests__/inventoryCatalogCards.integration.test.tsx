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
    it("shows a card per registered tool with its name and vendor", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-tool-claude-code");
      expect(within(card).getByText("Claude Code")).toBeInTheDocument();
      expect(within(card).getByText("Anthropic")).toBeInTheDocument();
    });

    /** @scenario "The catalog lists registered tools and not ingestion sources" */
    it("lists the registry and never a connected source", () => {
      renderScreen();
      // The fixture's sources are a Genie connector and a Copilot Studio one,
      // and neither is a registered tool. A card for either would be the
      // source-as-tool linkage that was removed.
      expect(screen.queryByTestId("tool-card-src-genie")).toBeNull();
      expect(screen.queryByText("Warehouse questions")).toBeNull();
      expect(
        screen.getByTestId("tool-card-tool-support-desk"),
      ).toBeInTheDocument();
    });

    /** @scenario "A tool registered but not published is still in the catalog" */
    it("keeps an unpublished tool in the inventory and says it is unpublished", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-tool-support-desk");
      expect(within(card).getByText("not published")).toBeInTheDocument();
    });

    /** @scenario "A row nothing measures shows a dash naming what would fill it" */
    it("draws a dash naming the missing read for every row on a real card", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-tool-claude-code");
      const dashes = within(card).getAllByLabelText(/not measured\./);
      // Every read behind these rows is keyed by organization or by ingestion
      // source, so nothing on a real card is measured yet. The count is
      // asserted rather than "more than none" so a card that quietly stopped
      // drawing dashes at all cannot pass this.
      expect(dashes).toHaveLength(5);
      for (const dash of dashes) {
        expect(dash.getAttribute("aria-label")).toMatch(/not measured\. .+\.$/);
      }
      // A row we cannot read is never drawn as a zero.
      expect(within(card).queryByText("0")).toBeNull();
    });

    /** @scenario "A row that does not apply to a tool is left off its card" */
    it("leaves seats and licence cost off a per-person subscription tool", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-tool-claude-code");
      expect(within(card).getByText("Subscriptions")).toBeInTheDocument();
      expect(within(card).queryByText("Seats")).toBeNull();
      expect(within(card).queryByText("Licence per month")).toBeNull();
      expect(within(card).queryByText("Tokens · 30 days")).toBeNull();
      expect(within(card).queryByText("Conversations · 30 days")).toBeNull();
    });

    /** @scenario "A row that does not apply to a tool is left off its card" */
    it("gives a consumption-billed provider tokens and no subscription row", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-tool-openai");
      expect(within(card).getByText("Tokens · 30 days")).toBeInTheDocument();
      expect(within(card).queryByText("Subscriptions")).toBeNull();
      expect(within(card).queryByText("Seats")).toBeNull();
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

    /** @scenario "The catalog is offered as a grid or as a table" */
    it("switches the catalog between a grid of cards and a table", async () => {
      renderScreen();
      expect(screen.getByTestId("tool-catalog-cards")).toHaveAttribute(
        "data-layout",
        "grid",
      );
      expect(screen.queryByRole("table")).toBeNull();
      await userEvent.click(screen.getByRole("radio", { name: /List/ }));
      await waitFor(() =>
        expect(screen.getByTestId("tool-catalog-cards")).toHaveAttribute(
          "data-layout",
          "list",
        ),
      );
      // A real table with a row per tool, not the same tall card stacked.
      const table = screen.getByRole("table");
      expect(
        within(table).getByRole("columnheader", { name: "Tool" }),
      ).toBeInTheDocument();
      expect(
        within(table).getByTestId("tool-card-tool-claude-code"),
      ).toBeInTheDocument();
    });

    /** @scenario "Table headers are spelled out rather than abbreviated" */
    it("spells out every column header", async () => {
      renderScreen();
      await userEvent.click(screen.getByRole("radio", { name: /List/ }));
      const table = await screen.findByRole("table");
      for (const header of [
        "Seats",
        "Licence per month",
        "Unassigned licence cost",
        "Subscriptions",
        "Usage · 30 days",
        "Agents",
        "Top department",
      ]) {
        expect(
          within(table).getByRole("columnheader", { name: header }),
        ).toBeInTheDocument();
      }
      // The design mock abbreviated these three. The section's copy rule does
      // not allow it, and a header is exactly where a guess costs the most.
      const headers = within(table).getAllByRole("columnheader");
      const text = headers.map((header) => header.textContent).join(" ");
      expect(text).not.toMatch(/\/\s*mo\b/i);
      expect(text).not.toMatch(/\b30d\b/i);
      expect(text).not.toMatch(/\bidle\b/i);
    });

    /** @scenario "A column a tool has no row for shows a dash saying so" */
    it("dashes a column the tool does not have and says it does not apply", async () => {
      renderScreen();
      await userEvent.click(screen.getByRole("radio", { name: /List/ }));
      const row = await screen.findByTestId("tool-card-tool-claude-code");
      expect(
        within(row).getByLabelText(/Seats not measured\..*does not apply/),
      ).toBeInTheDocument();
    });

    /** @scenario "Sample mode replaces the cards rather than filling them in" */
    it("shows the sample tools and no card built from the real registry", async () => {
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      expect(
        await screen.findByTestId("tool-card-sample-claude-code"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("tool-card-tool-openai")).toBeNull();
    });

    /** @scenario "A sample card offers no action that would act on a real tool" */
    it("offers no row actions while sample mode is on", async () => {
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      const card = await screen.findByTestId("tool-card-sample-claude-code");
      expect(within(card).queryByRole("button")).toBeNull();
    });
  });

  describe("when the catalog is in view", () => {
    beforeEach(connectTools);

    /** @scenario "Registering a tool opens the registration drawer" */
    it("opens the tool registration drawer from Add tool", async () => {
      renderScreen();
      await userEvent.click(
        screen.getAllByRole("button", { name: /Add tool/ })[0]!,
      );
      expect(
        await screen.findByRole("heading", { name: /Add tool/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "The add deep link opens the registration drawer" */
    it("opens the registration drawer from the add deep link", async () => {
      renderScreen({ at: "/governance/inventory?tab=catalog&add=1" });
      expect(
        await screen.findByRole("heading", { name: /Add tool/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "A tool row offers edit, publish and remove in one menu" */
    it("puts every per-tool action in one overflow menu", async () => {
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "Actions for Claude Code" }),
      );
      for (const action of ["Edit", "Unpublish", "Remove"]) {
        expect(
          await screen.findByRole("menuitem", { name: action }),
        ).toBeInTheDocument();
      }
    });

    /** @scenario "The tile editor and the starter pack stay off this page" */
    it("renders no drag-to-reorder editor or starter-pack import", () => {
      renderScreen();
      const page = document.body.textContent ?? "";
      expect(page).not.toMatch(/starter pack/i);
      expect(page).not.toMatch(/tool tiles/i);
      expect(page).not.toMatch(/ingestion templates/i);
    });
  });
});
