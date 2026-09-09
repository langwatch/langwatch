// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Environments pane: what an empty estate is told, and what happens to a
 * row added by hand.
 *
 * Environments are not stored yet. The dialog says so where the reader is
 * about to act on it, and the assertion that it does is the point of this
 * file — a form that looks like it saves and does not is worse than no form.
 *
 * Spec: specs/ai-governance/dashboard/inventory-environments.feature
 */
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SAMPLE_CHOICE_KEY } from "~/components/governance/sample";

import { openTab, renderScreen } from "./inventoryScreenHarness";

describe("given an admin on the Inventory page", () => {
  describe("when nothing is connected and samples are turned off", () => {
    /** @scenario "An organization with no environments is told where they come from" */
    it("says where environments come from instead of listing none", async () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );
      await openTab(/Environments/);
      expect(
        await screen.findByText(/appear here once a source points at one/i),
      ).toBeInTheDocument();
    });
  });

  describe("when an admin adds an environment", () => {
    /** Open the Environments pane and its add dialog. */
    async function openAddEnvironment() {
      renderScreen();
      await openTab(/Environments/);
      // Two on an empty pane, and deliberately so: the header's control and
      // the empty state's second doorway to it. Same component, same label,
      // same flow — the first is the header's.
      await userEvent.click(
        screen.getAllByRole("button", { name: /Add environment/ })[0]!,
      );
      return await screen.findByRole("dialog");
    }

    /** @scenario "The add dialog asks for a name and a description" */
    it("asks for a name and a description and refuses an empty name", async () => {
      const dialog = await openAddEnvironment();
      expect(within(dialog).getByText("Name")).toBeInTheDocument();
      expect(within(dialog).getByText("Description")).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Add environment" }),
      ).toBeDisabled();
    });

    /** @scenario "The add dialog says the environment will not be stored" */
    it("says the environment is not stored and is gone on reload", async () => {
      const dialog = await openAddEnvironment();
      expect(
        within(dialog).getByText(/not stored yet[\s\S]*gone when you reload/i),
      ).toBeInTheDocument();
    });

    /** @scenario "An added environment joins the table for this sitting" */
    it("puts the added environment in the table", async () => {
      const dialog = await openAddEnvironment();
      await userEvent.type(
        within(dialog).getByPlaceholderText("Production"),
        "Blue ring",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Add environment" }),
      );
      const table = await screen.findByTestId("environments-table");
      await waitFor(() =>
        expect(within(table).getByText("Blue ring")).toBeInTheDocument(),
      );
    });
  });
});
