/**
 * @vitest-environment jsdom
 * The organization's Dashboards library at `/dashboards`, over the real tRPC hooks and a
 * transport the test answers.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost, type StubAnalyticsHostOptions } from "../../../testing.tsx";
import { CURATED_BOARDS } from "../model/curated-boards.ts";
import DashboardsLibraryScreen from "../ui/sections/dashboards-library.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const SHOP = { id: "proj-shop", slug: "shop-abc123", name: "Shop" };
const IN_VIEW = { id: "proj-1", slug: "test-project", name: "Test Project" };

const row = ({
  id,
  name,
  scope = "PROJECT",
  project = SHOP,
  createdById = "someone",
  ownerName = null,
  starPosition = null,
}: {
  id: string;
  name: string;
  scope?: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  project?: typeof SHOP | null;
  createdById?: string;
  ownerName?: string | null;
  starPosition?: number | null;
}) => ({
  id,
  name,
  description: null,
  createdById,
  ownerName,
  scope,
  updatedAt: new Date("2026-11-01"),
  project,
  openProject: project ?? IN_VIEW,
  starPosition,
});

const LISTED = [
  row({ id: "board-shop", name: "Shop board", createdById: "user-1" }),
  row({
    id: "board-org",
    name: "Everyone's board",
    scope: "ORGANIZATION",
    project: null,
    ownerName: "Sam Rivera",
  }),
];

/** Answers the library, the project list the From LangWatch rows read, and every write. */
function libraryServer(listed: unknown = LISTED) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "boards.listInOrganization") {
      return listed instanceof Error ? Promise.reject(listed) : Promise.resolve(listed);
    }
    if (call.path === "boards.getAll") return Promise.resolve([]);
    if (call.path === "boards.storeProjects") return Promise.resolve([IN_VIEW]);
    if (call.path === "boards.create" || call.path === "boards.createAtScope") {
      const { name } = call.input as { name: string };
      return Promise.resolve({ ...row({ id: "board-new", name }), projectId: IN_VIEW.id });
    }
    if (call.path === "dashboardWidgets.list") return Promise.resolve([]);
    if (call.path === "dashboardWidgets.batchUpdateLayouts") return Promise.resolve([]);
    if (call.path === "boards.delete") return Promise.resolve(row({ id: "x", name: "x" }));
    if (call.path === "boards.update") return Promise.resolve(row({ id: "x", name: "x" }));
    if (call.path === "boards.setScope") return Promise.resolve(row({ id: "x", name: "x" }));
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    if (call.path === "boards.star" || call.path === "boards.unstar") {
      return Promise.resolve({ success: true });
    }
    return NO_PROCEDURES(call);
  };
  return { calls, answer };
}

function renderLibrary({
  listed,
  ...options
}: StubAnalyticsHostOptions & { listed?: unknown } = {}) {
  const host = new StubAnalyticsHost({
    projectPermissions: {
      [SHOP.id]: ["analytics:view", "analytics:update", "analytics:delete"],
      [IN_VIEW.id]: ["analytics:create", "analytics:update"],
    },
    ...options,
  });
  const server = libraryServer(listed);
  renderDashboards({ element: <DashboardsLibraryScreen />, host, answer: server.answer });
  return { host, calls: server.calls, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const inputsTo = (calls: readonly UiProcedureCall[], path: string) =>
  calls.filter((call) => call.path === path).map((call) => call.input);

describe("the Dashboards library", () => {
  describe("when the member can see boards in the organization", () => {
    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    it("lists From LangWatch first, then boards with no project, then by project", async () => {
      renderLibrary();
      const group = await screen.findByRole("region", { name: "LLM Ops" });
      const names = within(group)
        .getAllByRole("listitem")
        .map((item) => item.textContent ?? "");

      expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
      expect(screen.getByText("Every dashboard you can see, by product.")).toBeInTheDocument();
      expect(within(group).getByText(`LLM Ops · ${CURATED_BOARDS.length + 2}`)).toBeVisible();
      const curatedNames = names.slice(0, CURATED_BOARDS.length);
      expect(curatedNames.filter((name) => name.includes("Read-only"))).toEqual(curatedNames);
      expect(names.slice(CURATED_BOARDS.length)).toEqual([
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
    it("opens a Project board at its own project's address", async () => {
      const { host, user } = renderLibrary();

      await user.click(await screen.findByRole("link", { name: "Shop board" }));

      expect(host.navigations).toEqual([`/${SHOP.slug}/dashboards/board-shop`]);
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
      expect(within(group).getByText(`LLM Ops · ${CURATED_BOARDS.length + 11}`)).toBeVisible();

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
  });

  describe("when no project of the organization has Dashboards on", () => {
    it("answers the app's not-found page", async () => {
      renderLibrary({ listed: new UiProcedureRefusal("dashboards_not_enabled", 403) });

      expect(await screen.findByRole("heading", { name: "This page is not here" })).toBeVisible();
    });
  });

  describe("when the member makes a new dashboard", () => {
    /** @scenario "A board made in the library is made at its scope in one write" */
    it("stores it in the project in view at the scope Project and opens it", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      await user.click(await screen.findByRole("button", { name: "Create" }));

      await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.create")).toEqual([
        { projectId: IN_VIEW.id, name: "Untitled dashboard 1" },
      ]);
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([]);
      expect(inputsTo(calls, "boards.setScope")).toEqual([]);
      expect(host.successes.map((notice) => notice.title)).toEqual(["Dashboard created"]);
    });

    /** @scenario "A board made in the library is made at its scope in one write" */
    it("makes a board Only me in one call and opens it at the organization's address", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      await user.click(await screen.findByRole("radio", { name: /Only me/ }));
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([
        { projectId: IN_VIEW.id, name: "Untitled dashboard 1", scope: "PRIVATE" },
      ]);
      expect(inputsTo(calls, "boards.create")).toEqual([]);
      expect(inputsTo(calls, "boards.setScope")).toEqual([]);
    });
  });

  describe("when the member deletes a board of a project they may delete in", () => {
    /** @scenario "Delete, rename, star and duplicate from the library" */
    it("asks first, deletes it from its own project, and says so", async () => {
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
    });

    /** @scenario "Delete, rename, star and duplicate from the library" */
    it("offers no delete on an Organization board of a project they cannot read", async () => {
      const { user } = renderLibrary();

      const actions = await screen.findByRole("button", { name: "Actions for Everyone's board" });
      await user.click(actions);

      expect(await screen.findByRole("menuitem", { name: "Duplicate to edit" })).toBeVisible();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });
  });

  describe("when the member stars a board from its row", () => {
    /** @scenario "Delete, rename, star and duplicate from the library" */
    it("stars it in the project it opens in", async () => {
      const { calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Everyone's board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Star" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.star")).toEqual([
          { projectId: IN_VIEW.id, star: { kind: "board", dashboardId: "board-org" } },
        ]),
      );
    });

    /** @scenario "Delete, rename, star and duplicate from the library" */
    it("offers Unstar on a starred board, which removes the star", async () => {
      const { calls, user } = renderLibrary({
        listed: [row({ id: "board-shop", name: "Shop board", starPosition: 0 })],
      });

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Unstar" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.unstar")).toEqual([
          { projectId: SHOP.id, star: { kind: "board", dashboardId: "board-shop" } },
        ]),
      );
    });

    /** @scenario "Delete, rename, star and duplicate from the library" */
    it("stars and unstars from the row's own toggle, filled once starred", async () => {
      const { calls, user } = renderLibrary({
        listed: [
          row({ id: "board-shop", name: "Shop board", starPosition: 0 }),
          row({ id: "board-org", name: "Everyone's board", scope: "ORGANIZATION", project: null }),
        ],
      });

      const starred = await screen.findByRole("button", { name: "Unstar Shop board" });
      expect(starred).toHaveAttribute("aria-pressed", "true");
      await user.click(starred);
      await user.click(screen.getByRole("button", { name: "Star Everyone's board" }));

      await waitFor(() =>
        expect([...inputsTo(calls, "boards.unstar"), ...inputsTo(calls, "boards.star")]).toEqual([
          { projectId: SHOP.id, star: { kind: "board", dashboardId: "board-shop" } },
          { projectId: IN_VIEW.id, star: { kind: "board", dashboardId: "board-org" } },
        ]),
      );
    });
  });

  describe("when the member renames a board they may edit", () => {
    /** @scenario "Delete, rename, star and duplicate from the library" */
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
    });

    /** @scenario "Delete, rename, star and duplicate from the library" */
    it("saves nothing on Escape", async () => {
      const { calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
      await user.type(await screen.findByRole("textbox", { name: "Dashboard name" }), "x{Escape}");

      expect(await screen.findByRole("link", { name: "Shop board" })).toBeVisible();
      expect(inputsTo(calls, "boards.update")).toEqual([]);
    });

    /** @scenario "Delete, rename, star and duplicate from the library" */
    it("offers no Rename on a board of a project they cannot edit in", async () => {
      const { user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Everyone's board" }));

      expect(await screen.findByRole("menuitem", { name: "Star" })).toBeVisible();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });

  describe("when the member duplicates a board", () => {
    /** @scenario "Delete, rename, star and duplicate from the library" */
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
      expect(host.navigations).toEqual([`/${IN_VIEW.slug}/dashboards/board-new`]);
    });

    /** @scenario "Delete, rename, star and duplicate from the library" */
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
  });
});
