/**
 * @vitest-environment jsdom
 * The organization's Dashboards library at `/dashboards`: what its table lists, how its search,
 * filters and column headers narrow and order it, and what it says when a read fails.
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

/** The board names in the table, top to bottom. */
const boardNames = () =>
  within(screen.getByRole("table", { name: "Dashboards" }))
    .getAllByRole("row")
    .slice(1)
    .map((tableRow) => within(tableRow).queryAllByRole("link")[0]?.textContent);

const rowOf = (link: HTMLElement) => link.closest("tr") as HTMLElement;

describe("the Dashboards library", () => {
  describe("when the member can see boards in the organization", () => {
    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    /** @scenario "From LangWatch boards are not listed for now" */
    it("lists boards with no project first, then by project, and no From LangWatch row", async () => {
      renderLibrary();
      await screen.findByRole("link", { name: "Shop board" });

      expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
      expect(screen.getByText("Every dashboard you can see, by product.")).toBeInTheDocument();
      expect(screen.queryByText("From LangWatch")).toBeNull();
      expect(boardNames()).toEqual(["Everyone's board", "Shop board"]);
    });

    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    it("names who sees each board, the member's own as theirs and another's by its author", async () => {
      renderLibrary();
      const shopRow = rowOf(await screen.findByRole("link", { name: "Shop board" }));
      const orgRow = rowOf(screen.getByRole("link", { name: "Everyone's board" }));

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
      row({ id: "board-ops", name: "Shop board", description: "Checkout health at a glance" }),
    ];

    /** @scenario "The library lists every board I may see in one table" */
    it("lists them in one table in the rail's product order, with each board's product", async () => {
      renderLibrary({ listed: HOMED });
      const table = await screen.findByRole("table", { name: "Dashboards" });
      const headers = within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent);

      expect(headers.slice(0, 5)).toEqual(["Name", "Product", "Shared with", "Owner", "Updated"]);
      expect(boardNames()).toEqual(["Agent spend", "Shop board", "Key spend"]);
      expect(rowOf(screen.getByRole("link", { name: "Key spend" }))).toHaveTextContent("Gateway");
      expect(screen.getByText("Checkout health at a glance")).toBeVisible();
      expect(screen.queryByRole("region", { name: "LLM Ops" })).toBeNull();
    });
  });

  describe("when the member searches and filters the library", () => {
    const MINE = "user-1";
    const BOARDS = [
      row({ id: "refund", name: "Refund rate", createdById: MINE, scope: "ORGANIZATION" }),
      row({ id: "latency", name: "Latency", homeProduct: "gateway", scope: "ORGANIZATION" }),
      row({ id: "weekly", name: "Weekly", description: "Weekly refunds review" }),
      row({
        id: "gw-mine",
        name: "Key spend",
        homeProduct: "gateway",
        scope: "ORGANIZATION",
        createdById: MINE,
      }),
      row({
        id: "gw-private",
        name: "My keys",
        homeProduct: "gateway",
        scope: "PRIVATE",
        createdById: MINE,
      }),
    ];
    const search = () => screen.getByRole("searchbox", { name: "Search dashboards" });

    /** @scenario "The library's search finds a board by its name, description, project or owner" */
    it("lists only what the search finds and says how many of all it shows", async () => {
      const { user } = renderLibrary({ listed: BOARDS });
      await screen.findByRole("link", { name: "Latency" });

      await user.type(search(), "REFUND");

      expect(boardNames()).toEqual(["Refund rate", "Weekly"]);
      expect(screen.getByText("2 of 5 dashboards")).toBeVisible();
    });

    /** @scenario "The library's filters narrow it by product, owner and who sees it" */
    it("narrows by product, owner and who sees it, and Clear filters puts all back", async () => {
      const { user } = renderLibrary({ listed: BOARDS });
      const products = await screen.findByRole("group", { name: "Filter dashboards by product" });

      expect(
        within(products)
          .getAllByRole("button")
          .map((chip) => chip.getAttribute("aria-label")),
      ).toEqual(["All, 5 dashboards", "LLM Ops, 2 dashboards", "Gateway, 3 dashboards"]);

      await user.click(within(products).getByRole("button", { name: /^Gateway/ }));
      await user.click(screen.getByRole("radio", { name: "Me" }));
      await user.click(screen.getByRole("radio", { name: "Organization" }));

      expect(boardNames()).toEqual(["Key spend"]);

      await user.type(search(), "nothing");

      expect(screen.getByText("No dashboards match these filters")).toBeVisible();

      await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0] as HTMLElement);

      expect(boardNames()).toHaveLength(5);
      expect(search()).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    });
  });

  describe("when the member presses a column header", () => {
    const DATED = [
      row({ id: "b", name: "Beta", updatedAt: "2026-11-01T00:00:00.000Z" }),
      row({ id: "a", name: "Alpha", updatedAt: "2026-11-25T00:00:00.000Z" }),
      row({
        id: "z",
        name: "Zeta",
        homeProduct: "me",
        scope: "PRIVATE",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    ];

    /** @scenario "The library sorts by name or by last change" */
    it("sorts by name both ways, then by last change newest first", async () => {
      const { user } = renderLibrary({ listed: DATED });
      await screen.findByRole("link", { name: "Zeta" });

      expect(boardNames()).toEqual(["Zeta", "Alpha", "Beta"]);

      await user.click(screen.getByRole("button", { name: "Name" }));
      expect(boardNames()).toEqual(["Alpha", "Beta", "Zeta"]);

      await user.click(screen.getByRole("button", { name: "Name" }));
      expect(boardNames()).toEqual(["Zeta", "Beta", "Alpha"]);

      await user.click(screen.getByRole("button", { name: "Updated" }));
      expect(boardNames()).toEqual(["Alpha", "Beta", "Zeta"]);
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

  describe("when no project of the organization has Dashboards on", () => {
    it("answers the app's not-found page", async () => {
      renderLibrary({ listed: new UiProcedureRefusal("dashboards_not_enabled", 403) });

      expect(await screen.findByRole("heading", { name: "This page is not here" })).toBeVisible();
    });
  });
});
