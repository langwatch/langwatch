/**
 * @vitest-environment jsdom
 * The organization's Dashboards library at `/dashboards`: what it lists, how its groups fold and
 * what it says when a read fails.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { toaster } from "@langwatch/design-system/toaster";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { inputsTo, renderLibrary, row } from "./dashboards-library.test-helpers.tsx";

afterEach(() => {
  toaster.remove();
});

describe("the Dashboards library", () => {
  describe("when the member can see boards in the organization", () => {
    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    /** @scenario "From LangWatch boards are not listed for now" */
    it("lists boards with no project first, then by project, and no From LangWatch row", async () => {
      renderLibrary();
      const group = await screen.findByRole("region", { name: "LLM Ops" });
      const names = within(group)
        .getAllByRole("listitem")
        .map((item) => item.textContent ?? "");

      expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
      expect(screen.getByText("Every dashboard you can see, by product.")).toBeInTheDocument();
      expect(within(group).getByText("LLM Ops · 2")).toBeVisible();
      expect(screen.queryByText("From LangWatch")).toBeNull();
      expect(names).toEqual([
        expect.stringContaining("Everyone's board"),
        expect.stringContaining("Shop board"),
      ]);
    });

    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    it("names who sees each board, the member's own as theirs and another's by its author", async () => {
      renderLibrary();
      const shopRow = (await screen.findByText("Shop board")).closest("li");
      const orgRow = screen.getByText("Everyone's board").closest("li");

      expect(shopRow).toHaveTextContent("Shop");
      expect(shopRow).toHaveTextContent("You");
      expect(orgRow).toHaveTextContent("Organization");
      expect(orgRow).toHaveTextContent("Sam Rivera");
    });

    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    it("opens an Organization board at the organization's address, by id", async () => {
      const { host, user } = renderLibrary();

      await user.click(await screen.findByRole("link", { name: "Everyone's board" }));

      expect(host.navigations).toEqual(["/dashboards/board-org"]);
    });

    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    it("opens a Project board at the organization's address too", async () => {
      const { host, user } = renderLibrary();

      await user.click(await screen.findByRole("link", { name: "Shop board" }));

      expect(host.navigations).toEqual(["/dashboards/board-shop"]);
    });
  });

  describe("when boards are homed in different products", () => {
    const HOMED = [
      row({ id: "board-gw", name: "Key spend", scope: "ORGANIZATION", homeProduct: "gateway" }),
      row({ id: "board-me", name: "Agent spend", scope: "PRIVATE", homeProduct: "me" }),
      row({ id: "board-ops", name: "Shop board" }),
    ];
    const groupLabels = () =>
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent?.split(" · ")[0]);

    /** @scenario "The library lists every board I may see, grouped by product" */
    it("groups them by product in rail order, and gives a product with none no group", async () => {
      renderLibrary({ listed: HOMED });
      await screen.findByRole("region", { name: "LLM Ops" });

      expect(groupLabels()).toEqual(["Coding agents", "LLM Ops", "Gateway"]);
      expect(screen.queryByRole("region", { name: "Governance" })).toBeNull();
    });

    /** @scenario "The library lists every board I may see, grouped by product" */
    it("lists each board in its own product's group", async () => {
      renderLibrary({ listed: HOMED });
      const llmOps = await screen.findByRole("region", { name: "LLM Ops" });
      const gateway = screen.getByRole("region", { name: "Gateway" });

      expect(within(llmOps).getByText("LLM Ops · 1")).toBeVisible();
      expect(within(gateway).getByText("Gateway · 1")).toBeVisible();
      expect(within(gateway).getAllByRole("listitem")).toEqual([
        within(gateway).getByText("Key spend").closest("li"),
      ]);
      expect(
        within(screen.getByRole("region", { name: "Coding agents" })).getByText("Agent spend"),
      ).toBeVisible();
    });
  });

  describe("when the member can see no board", () => {
    /** @scenario "An empty library" */
    it("says No dashboards yet and lists no From LangWatch group", async () => {
      renderLibrary({ listed: [] });

      expect(await screen.findByText("No dashboards yet")).toBeVisible();
      expect(
        screen.getByText("Make one for any product. It shows in that product's sidebar."),
      ).toBeVisible();
      expect(screen.queryByText("From LangWatch")).toBeNull();
    });

    describe("given the store projects cannot be read", () => {
      // A refusal the query layer does not retry, so the page answers at once.
      it("says the failure with Retry beside the empty state, and Retry asks again", async () => {
        const { calls, user } = renderLibrary({
          listed: [],
          storeProjects: new UiProcedureRefusal("forbidden", 403),
        });

        const retry = await screen.findByRole("button", { name: "Retry" });
        expect(retry).toBeVisible();
        expect(screen.getByText("No dashboards yet")).toBeVisible();
        expect(screen.queryByRole("button", { name: "New dashboard" })).toBeNull();
        const asked = inputsTo(calls, "boards.storeProjects").length;

        await user.click(retry);

        await waitFor(() =>
          expect(inputsTo(calls, "boards.storeProjects").length).toBeGreaterThan(asked),
        );
      });
    });
  });

  describe("when a group lists more than eight boards", () => {
    const ELEVEN = Array.from({ length: 11 }, (_, index) => {
      const name = `Board ${String(index + 1).padStart(2, "0")}`;
      return row({ id: `board-${index + 1}`, name });
    });
    const boardLinks = (group: HTMLElement) =>
      within(group)
        .queryAllByRole("link", { name: /^Board \d+$/ })
        .map((link) => link.textContent);

    /** @scenario 'A long group shows 8 boards, then "Show N more" and "Show less"' */
    it("shows eight, opens the rest with Show 3 more, and folds back with Show less", async () => {
      const { user } = renderLibrary({ listed: ELEVEN });
      const group = await screen.findByRole("region", { name: "LLM Ops" });
      const firstEight = ELEVEN.slice(0, 8).map((board) => board.name);

      expect(boardLinks(group)).toEqual(firstEight);
      expect(within(group).getByText("LLM Ops · 11")).toBeVisible();

      await user.click(within(group).getByRole("button", { name: "Show 3 more" }));

      expect(boardLinks(group)).toEqual(ELEVEN.map((board) => board.name));
      expect(within(group).queryByRole("button", { name: "Show 3 more" })).toBeNull();

      await user.click(within(group).getByRole("button", { name: "Show less" }));

      expect(boardLinks(group)).toEqual(firstEight);
      expect(within(group).getByRole("button", { name: "Show 3 more" })).toBeVisible();
    });

    /** @scenario 'A long group shows 8 boards, then "Show N more" and "Show less"' */
    it("offers no toggle with eight boards or fewer", async () => {
      renderLibrary({ listed: ELEVEN.slice(0, 8) });
      const group = await screen.findByRole("region", { name: "LLM Ops" });

      expect(boardLinks(group)).toHaveLength(8);
      expect(within(group).queryByRole("button", { name: /^Show / })).toBeNull();
    });

    /** @scenario "A long group stays open or folded after a reload" */
    it("keeps the group open when the library is opened again, and folded once folded", async () => {
      const first = renderLibrary({ listed: ELEVEN });
      const group = await screen.findByRole("region", { name: "LLM Ops" });
      await first.user.click(within(group).getByRole("button", { name: "Show 3 more" }));
      first.unmount();

      const second = renderLibrary({ listed: ELEVEN });
      const reopened = await screen.findByRole("region", { name: "LLM Ops" });

      expect(boardLinks(reopened)).toEqual(ELEVEN.map((board) => board.name));
      await second.user.click(within(reopened).getByRole("button", { name: "Show less" }));
      second.unmount();

      renderLibrary({ listed: ELEVEN });
      const folded = await screen.findByRole("region", { name: "LLM Ops" });

      expect(boardLinks(folded)).toHaveLength(8);
      expect(within(folded).getByRole("button", { name: "Show 3 more" })).toBeVisible();
    });
  });

  describe("when no project of the organization has Dashboards on", () => {
    it("answers the app's not-found page", async () => {
      renderLibrary({ listed: new UiProcedureRefusal("dashboards_not_enabled", 403) });

      expect(await screen.findByRole("heading", { name: "This page is not here" })).toBeVisible();
    });
  });
});
