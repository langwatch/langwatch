/**
 * @vitest-environment jsdom
 * Moving a board to another product from the organization's Dashboards library.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { toaster } from "@langwatch/design-system/toaster";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { inputsTo, renderLibrary, row, SHOP } from "./dashboards-library.test-helpers.tsx";

afterEach(() => {
  toaster.remove();
});

/** The Project-to-Only-me warning, for any product. */
const LOSES_PROJECT = /has no projects, so only you will see it until you share it\./;

const openMoveDialog = async ({
  user,
  name,
}: {
  user: ReturnType<typeof renderLibrary>["user"];
  name: string;
}) => {
  await user.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
  await user.click(await screen.findByRole("menuitem", { name: "Move to product…" }));
  return within(await screen.findByRole("dialog"));
};

describe("the Dashboards library's move", () => {
  describe("when the member moves an Organization board to another product", () => {
    const SHARED = row({
      id: "board-shared",
      name: "Shared board",
      scope: "ORGANIZATION",
      createdById: "user-1",
    });

    /** @scenario "Move an Organization board to Gateway" */
    it("moves it to the product picked, says so, and offers Open", async () => {
      const { host, calls, user } = renderLibrary({ listed: [SHARED] });

      const dialog = await openMoveDialog({ user, name: "Shared board" });
      const hint = 'Pick the product whose sidebar lists "Shared board".';
      expect(dialog.getByText(`${hint} Old links keep opening it.`)).toBeVisible();
      expect(dialog.getByRole("button", { name: "Move" })).toBeDisabled();

      await user.click(dialog.getByRole("radio", { name: /Gateway/ }));
      expect(dialog.queryByText(LOSES_PROJECT)).toBeNull();
      await user.click(dialog.getByRole("button", { name: "Move" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.move")).toEqual([
          { projectId: SHOP.id, dashboardId: "board-shared", homeProduct: "gateway" },
        ]),
      );
      expect(await screen.findByText('Moved "Shared board" to Gateway')).toBeVisible();
      const row = (await screen.findByRole("link", { name: "Shared board" })).closest("tr");
      await waitFor(() => expect(within(row as HTMLElement).getByText("Gateway")).toBeVisible());
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(host.navigations).toEqual(["/dashboards/board-shared"]);
    });
  });

  describe("when the member moves a Project board out of LLM Ops", () => {
    /** @scenario "Only the author can move a Project board out of LLM Ops" */
    it("warns its author that it will be Only me", async () => {
      const { user } = renderLibrary();

      const dialog = await openMoveDialog({ user, name: "Shop board" });
      await user.click(dialog.getByRole("radio", { name: /Coding agents/ }));

      expect(
        dialog.getByText(
          "Coding agents has no projects, so only you will see it until you share it.",
        ),
      ).toBeVisible();
    });

    /** @scenario "Only the author can move a Project board out of LLM Ops" */
    it("keeps another member's Project board in LLM Ops, saying only its author can move it", async () => {
      const { user } = renderLibrary({
        listed: [row({ id: "board-team", name: "Team board", createdById: "someone" })],
      });

      const dialog = await openMoveDialog({ user, name: "Team board" });

      expect(dialog.getByRole("radio", { name: /LLM Ops/ })).toBeEnabled();
      for (const product of [/Coding agents/, /Gateway/, /Governance/]) {
        expect(dialog.getByRole("radio", { name: product })).toBeDisabled();
      }
      expect(
        dialog.getByText("Only its author can move a Project board out of LLM Ops."),
      ).toBeVisible();
      expect(dialog.queryByText(/shared with the organization/)).toBeNull();
      expect(dialog.getByRole("button", { name: "Move" })).toBeDisabled();
    });
  });

  describe("when the member cancels a move", () => {
    /** @scenario "Move edge cases" */
    it("changes nothing on Cancel", async () => {
      const { calls, user } = renderLibrary();

      const dialog = await openMoveDialog({ user, name: "Shop board" });
      await user.click(dialog.getByRole("radio", { name: /Governance/ }));
      await user.click(dialog.getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(inputsTo(calls, "boards.move")).toEqual([]);
    });
  });

  describe("when the member may not edit the board", () => {
    /** @scenario "Move needs edit rights in the owning project" */
    it("greys out Move on a board they cannot edit, saying why", async () => {
      const { user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Everyone's board" }));
      const move = await screen.findByRole("menuitem", { name: "Move to product…" });

      expect(move).toHaveAttribute("aria-disabled", "true");
      expect(move).toHaveAttribute("title", "You can view this dashboard but not change it.");
    });
  });
});
