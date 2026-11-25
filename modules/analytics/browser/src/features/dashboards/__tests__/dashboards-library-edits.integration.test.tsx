/**
 * @vitest-environment jsdom
 * Deleting, renaming and duplicating a board from the organization's Dashboards library.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { toaster } from "@langwatch/design-system/toaster";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IN_VIEW, inputsTo, renderLibrary, row, SHOP } from "./dashboards-library.test-helpers.tsx";

afterEach(() => {
  toaster.remove();
});

describe("the Dashboards library's board edits", () => {
  describe("when the member deletes a board of a project they may delete in", () => {
    /** @scenario "Delete, rename and duplicate from the library" */
    it("asks first, deletes it from its own project, says so, and lists it no more", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.delete")).toEqual([
          { projectId: SHOP.id, dashboardId: "board-shop" },
        ]),
      );
      await waitFor(() =>
        expect(host.successes.map((notice) => notice.title)).toEqual(['"Shop board" deleted']),
      );
      await waitFor(() => expect(screen.queryByRole("link", { name: "Shop board" })).toBeNull());
    });

    /** @scenario "Delete, rename and duplicate from the library" */
    it("offers no delete on an Organization board of a project they cannot read", async () => {
      const { user } = renderLibrary();

      const actions = await screen.findByRole("button", { name: "Actions for Everyone's board" });
      await user.click(actions);

      expect(await screen.findByRole("menuitem", { name: "Duplicate to edit" })).toBeVisible();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });
  });

  describe("given the member starred boards before stars were dropped", () => {
    /** @scenario "Delete, rename and duplicate from the library" */
    it("offers no Star, Unstar or star toggle on any row, since the library reads no stars", async () => {
      const { user } = renderLibrary({
        listed: [row({ id: "board-shop", name: "Shop board" })],
      });

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));

      expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeVisible();
      expect(screen.queryByRole("menuitem", { name: "Unstar" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Unstar Shop board" })).toBeNull();
    });
  });

  describe("when the member renames a board they may edit", () => {
    /** @scenario "Delete, rename and duplicate from the library" */
    it("saves the name in place in its own project on Enter, and says so", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
      const field = await screen.findByRole("textbox", { name: "Dashboard name" });
      await user.clear(field);
      await user.type(field, "Checkout{Enter}");

      await waitFor(() =>
        expect(inputsTo(calls, "boards.update")).toEqual([
          { projectId: SHOP.id, dashboardId: "board-shop", name: "Checkout" },
        ]),
      );
      await waitFor(() =>
        expect(host.successes.map((notice) => notice.title)).toEqual(["Dashboard renamed"]),
      );
      expect(await screen.findByRole("link", { name: "Checkout" })).toBeVisible();
    });

    /** @scenario "Delete, rename and duplicate from the library" */
    it("saves nothing on Escape", async () => {
      const { calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
      await user.type(await screen.findByRole("textbox", { name: "Dashboard name" }), "x{Escape}");

      expect(await screen.findByRole("link", { name: "Shop board" })).toBeVisible();
      expect(inputsTo(calls, "boards.update")).toEqual([]);
    });

    /** @scenario "Delete, rename and duplicate from the library" */
    it("offers no Rename on a board of a project they cannot edit in", async () => {
      const { user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Everyone's board" }));

      expect(await screen.findByRole("menuitem", { name: "Move to product…" })).toBeVisible();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });

  describe("when the member duplicates a board", () => {
    /** @scenario "Delete, rename and duplicate from the library" */
    it("copies it into the store project at its scope, opens it, and names the copy", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

      await waitFor(() =>
        expect(host.successes.map((notice) => notice.title)).toEqual([
          'Duplicated as "Shop board copy"',
        ]),
      );
      expect(inputsTo(calls, "boards.create")).toEqual([
        { projectId: IN_VIEW.id, name: "Shop board copy" },
      ]);
      expect(inputsTo(calls, "dashboardWidgets.list")).toEqual([
        { projectId: SHOP.id, dashboardId: "board-shop" },
      ]);
      expect(inputsTo(calls, "boards.setScope")).toEqual([]);
      expect(host.navigations).toEqual(["/dashboards/board-new"]);
    });

    /** @scenario "Delete, rename and duplicate from the library" */
    it("keeps an Only me board Only me, opened by id", async () => {
      const { host, calls, user } = renderLibrary({
        listed: [row({ id: "board-mine", name: "My notes", scope: "PRIVATE" })],
      });

      await user.click(await screen.findByRole("button", { name: "Actions for My notes" }));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([
        { projectId: IN_VIEW.id, name: "My notes copy", scope: "PRIVATE" },
      ]);
      expect(inputsTo(calls, "boards.setScope")).toEqual([]);
    });

    /** @scenario "A copy from the library keeps the board's product and scope" */
    it("keeps the product of a board homed outside LLM Ops, at its scope", async () => {
      const { host, calls, user } = renderLibrary({
        listed: [
          row({ id: "board-gw", name: "Key spend", scope: "ORGANIZATION", homeProduct: "gateway" }),
        ],
      });

      await user.click(await screen.findByRole("button", { name: "Actions for Key spend" }));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([
        {
          projectId: IN_VIEW.id,
          name: "Key spend copy",
          scope: "ORGANIZATION",
          homeProduct: "gateway",
        },
      ]);
      expect(inputsTo(calls, "boards.create")).toEqual([]);
    });
  });
});
