// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * Sample mode: eight invented tools, and the badges that keep them from ever
 * being read as measurements.
 *
 * Sample data REPLACES the real cards rather than filling them in, so the
 * assertions here are as much about what is absent from the screen as about
 * what is on it.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
import "@testing-library/jest-dom/vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  harness,
  openTab,
  renderScreen,
  SAMPLE_CHOICE_KEY,
} from "./inventoryScreenHarness";

describe("given an admin on the Inventory page", () => {
  describe("when sample mode is explicitly enabled", () => {
    beforeEach(() => window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true"));
    /** @scenario "Every sample card says it is a sample" */
    /** @scenario "Every invented panel is marked, by a badge or by a banner above it" */
    it("badges every card as a sample", () => {
      renderScreen();
      const cards = screen
        .getByTestId("tool-catalog-cards")
        .querySelectorAll("[data-testid^='tool-card-']");
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.textContent).toContain("sample");
      }
    });

    /** @scenario "A tool billed on consumption is not shown as having no seats" */
    it("says a consumption-billed tool has no seats rather than zero", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-databricks-genie");
      expect(
        within(card).getByText("no seats, billed on consumption"),
      ).toBeInTheDocument();
    });

    // Nine digits against a short label cannot be compared card to card.
    // The consumption-billed tool, because it is the one that HAS a token
    // row: tokens are the unit its bill is computed from. On a tool paid for
    // per seat or per plan the token count is the dollar figure told twice,
    // so that card carries no such row to shorten.
    /** @scenario "A count of a million or more is shortened on the card" */
    it("shortens a nine-digit token count", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-custom-agents");
      expect(within(card).getByText("412.9M")).toBeInTheDocument();
      expect(within(card).queryByText("412,900,000")).toBeNull();
    });

    /** @scenario "A shortened count keeps its exact value on hover" */
    it("still carries the exact token count as the row's accessible name", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-custom-agents");
      expect(
        within(card).getByLabelText("Tokens · 30 days: 412,900,000"),
      ).toBeInTheDocument();
    });

    /** @scenario "A count below a million is left exact and grouped" */
    it("leaves a five-digit event count in full", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-github-copilot");
      expect(within(card).getByText("22,180")).toBeInTheDocument();
    });

    // The seat-licensed tool, because it is the one carrying both a money row
    // and a seat sentence on the same card.
    /** @scenario "Money and prose rows are never shortened" */
    it("leaves money and the seat sentence exactly as written", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-github-copilot");
      // Money reads fine at four digits, and shortening it would be worse:
      // "$6.5K" hides the detail of the reported usage amount.
      expect(within(card).getByText("$6,460")).toBeInTheDocument();
      expect(within(card).getByText("310 of 340 assigned")).toBeInTheDocument();
    });

    /** @scenario "A failed read raises no alert while sample mode is on" */
    it("raises no error alert when the source read failed", async () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      harness.sources = {
        data: undefined,
        isLoading: false,
        error: new Error("read failed"),
      };
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      await openTab(/Sources/);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    /** @scenario "Sample environments fill an empty table and say they are samples" */
    it("fills an empty environments table with badged sample rows", async () => {
      renderScreen();
      await openTab(/Environments/);
      const table = await screen.findByTestId("environments-table");
      expect(within(table).getByText("Production")).toBeInTheDocument();
      expect(within(table).getAllByText("sample").length).toBeGreaterThan(0);
    });
  });
});
