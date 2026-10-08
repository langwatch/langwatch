/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { FROM_LANGWATCH_ABOUT } from "../model/curated-boards.ts";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const board = ({
  id,
  name,
  createdById = "user-1",
}: {
  id: string;
  name: string;
  createdById?: string;
}) => ({
  id,
  projectId: "proj-1",
  name,
  order: 0,
  description: null,
  createdById,
  isStarred: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  _count: { graphs: 0 },
});

const MINE = board({ id: "board-mine", name: "My dashboard" });
const WEEKLY = board({ id: "board-1", name: "Weekly review" });
const LATENCY = board({ id: "board-2", name: "Latency" });
const COSTS = board({ id: "board-3", name: "Costs", createdById: "user-2" });
const THEIRS = board({ id: "board-theirs", name: "My dashboard", createdById: "user-2" });
const BOARDS = [WEEKLY, MINE, LATENCY, COSTS, THEIRS];

type Star =
  | { kind: "board"; dashboard: ReturnType<typeof board> }
  | { kind: "template"; templateId: string };

/** The member starred Latency, then the Release check template. */
const STARS: Star[] = [
  { kind: "board", dashboard: LATENCY },
  { kind: "template", templateId: "release" },
];

const graph = { version: 1, code: "export default () => null;", queries: [] };

const STORED_WIDGETS = [
  { id: "w-1", name: "Traffic", dashboardId: "board-2", gridColumn: 0, gridRow: 0 },
  { id: "w-2", name: "Cost", dashboardId: "board-2", gridColumn: 4, gridRow: 0 },
  { id: "w-3", name: "Other", dashboardId: "board-1", gridColumn: 0, gridRow: 0 },
].map((widget) => ({ ...widget, colSpan: 4, rowSpan: 3, graph }));

const ACK_PATHS = [
  "dashboards.updateDetails",
  "dashboards.star",
  "dashboards.unstar",
  "dashboards.reorderStars",
  "dashboards.delete",
  "dashboardWidgets.batchUpdateLayouts",
];

/** Answers the board list, the stars and the writes, keeping every call for the test. */
function project({ stars = STARS, listFails = false }: { stars?: Star[]; listFails?: boolean }) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "dashboards.listStarred") {
      return listFails ? Promise.reject(new Error("down")) : Promise.resolve(stars);
    }
    if (call.path === "dashboards.getAll") return Promise.resolve(BOARDS);
    if (call.path === "dashboards.create") {
      return Promise.resolve({ ...board({ id: "board-new", name: "Untitled" }) });
    }
    if (call.path === "dashboardWidgets.list") return Promise.resolve(STORED_WIDGETS);
    if (call.path === "dashboardWidgets.create")
      return Promise.resolve({ id: `copy-${calls.length}` });
    if (ACK_PATHS.includes(call.path)) return Promise.resolve({ success: true });
    return NO_PROCEDURES(call);
  };
  return { calls, answer };
}

function renderSection({
  openPath = "",
  ...options
}: { openPath?: string; stars?: Star[]; listFails?: boolean } = {}) {
  const host = new StubAnalyticsHost({ flags: { release_dashboards: true } });
  const { calls, answer } = project(options);
  renderDashboards({ element: <SavedDashboardsSection openPath={openPath} />, host, answer });
  return { host, calls, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const listNamed = (name: string) => screen.findByRole("list", { name });
const namesIn = async (name: string) =>
  within(await listNamed(name))
    .getAllByRole("link")
    .map((link) => link.textContent?.trim());
const menuItemNames = () => screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());
const inputsTo = (calls: UiProcedureCall[], path: string) =>
  calls.filter((call) => call.path === path).map(({ input }) => input);

describe("the Dashboards sidebar", () => {
  describe("given the member's boards, stars and the From LangWatch boards", () => {
    /** @scenario "AC161 The sidebar lists Your dashboards, Starred and From LangWatch in order" */
    it("shows the groups in the prototype's order, each board once", async () => {
      renderSection();

      expect(await namesIn("Your dashboards")).toEqual(["My dashboard", "Costs", "Weekly review"]);
      expect(await namesIn("Starred dashboards")).toEqual(["Latency", "Release check"]);
      expect(await namesIn("From LangWatch")).toEqual([
        "Can I trust my numbers?",
        "Where my agent breaks",
      ]);
      expect(screen.queryByRole("link", { name: /Browse templates/ })).toBeNull();
      expect(screen.queryByText("All dashboards")).toBeNull();
    });

    /** @scenario "AC161b Your dashboards: My dashboard first, then the team's unstarred boards by name" */
    it("leaves another member's My dashboard out", async () => {
      renderSection();

      const yours = within(await listNamed("Your dashboards")).getAllByRole("link");
      expect(yours.map((link) => link.getAttribute("href"))).not.toContain(
        "/test-project/dashboards/board-theirs",
      );
    });

    /** @scenario "AC161 The sidebar lists Your dashboards, Starred and From LangWatch in order" */
    it("links a From LangWatch board to its live address and marks the open one", async () => {
      renderSection({ openPath: "curated/data" });

      const data = within(await listNamed("From LangWatch")).getByRole("link", {
        name: /Can I trust my numbers\?/,
      });
      expect(data).toHaveAttribute("href", "/test-project/dashboards/curated/data");
      expect(data).toHaveAttribute("aria-current", "page");
    });
  });

  describe("given the member has no stars", () => {
    /** @scenario "AC161c Starred shows only when the member has stars, in their own order" */
    it("shows no Starred group", async () => {
      renderSection({ stars: [] });

      await listNamed("Your dashboards");
      expect(screen.queryByText("Starred")).toBeNull();
      expect(await namesIn("From LangWatch")).toHaveLength(3);
    });
  });

  describe("when the stars fail to load", () => {
    /** @scenario "AC161c Starred shows only when the member has stars, in their own order" */
    it("shows a one-line error with Retry and keeps the + to make a board", async () => {
      renderSection({ listFails: true });

      expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New dashboard" })).toBeInTheDocument();
    });
  });

  describe("when the member presses the '+' on Your dashboards", () => {
    /** @scenario "AC162 The '+' on Your dashboards makes a blank board at once" */
    it("makes a blank board at once, with no menu", async () => {
      const { user, calls } = renderSection();
      await listNamed("Your dashboards");

      await user.click(screen.getByRole("button", { name: "New dashboard" }));
      expect(screen.queryByRole("menuitem")).toBeNull();
      await waitFor(() => expect(inputsTo(calls, "dashboards.create")).toHaveLength(1));
    });
  });

  describe("when the member clicks the From LangWatch heading", () => {
    /** @scenario "AC164 From LangWatch folds only when the member clicks it" */
    it("folds the group, and a second click opens it again", async () => {
      const { user } = renderSection();
      await listNamed("From LangWatch");

      await user.click(screen.getByRole("button", { name: "From LangWatch" }));
      expect(screen.queryByRole("list", { name: "From LangWatch" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "From LangWatch" }));
      expect(await listNamed("From LangWatch")).toBeInTheDocument();
    });
  });

  describe("when the member hovers or focuses the (i) beside From LangWatch", () => {
    /** @scenario "From LangWatch: the heading's (i) says what these boards are" */
    it("says what the boards are, on hover and on keyboard focus, leaving the fold alone", async () => {
      const { user } = renderSection();
      await listNamed("From LangWatch");
      const about = screen.getByRole("button", { name: "About From LangWatch" });

      await user.hover(about);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(FROM_LANGWATCH_ABOUT);
      await user.unhover(about);
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

      about.focus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(FROM_LANGWATCH_ABOUT);
      expect(screen.getByRole("button", { name: "From LangWatch" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(FROM_LANGWATCH_ABOUT).toBe(
        "Boards LangWatch made for you. They are read-only and improve over time. " +
          "Duplicate one to make a copy you can edit.",
      );
    });
  });

  describe("when the member stars and unstars from the row's star", () => {
    /** @scenario "AC165 A star can point at a From LangWatch board" */
    it("stars a From LangWatch board by its template id", async () => {
      const { user, calls, host } = renderSection();
      const data = within(await listNamed("From LangWatch"))
        .getAllByRole("listitem")
        .find((item) => item.textContent?.includes("Can I trust my numbers?"));

      await user.click(within(data!).getByRole("button", { name: "Star dashboard" }));

      await waitFor(() =>
        expect(inputsTo(calls, "dashboards.star")).toEqual([
          { projectId: "proj-1", star: { kind: "template", templateId: "data" } },
        ]),
      );
      expect(host.navigations).toEqual([]);
    });

    /** @scenario "AC165 A star can point at a From LangWatch board" */
    it("unstars a starred board", async () => {
      const { user, calls } = renderSection();
      const starred = within(await listNamed("Starred dashboards"));

      await user.click(starred.getAllByRole("button", { name: "Unstar dashboard" })[0]!);

      await waitFor(() =>
        expect(inputsTo(calls, "dashboards.unstar")).toEqual([
          { projectId: "proj-1", star: { kind: "board", dashboardId: "board-2" } },
        ]),
      );
    });
  });

  describe("when the member opens a board's menu", () => {
    /** @scenario "AC107 Sidebar menu: each board offers its actions in order" */
    it("offers Star, Rename, Duplicate and Delete on a team board", async () => {
      const { user } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
      await screen.findByRole("menuitem", { name: "Delete" });

      expect(menuItemNames()).toEqual(["Star", "Rename", "Duplicate", "Delete"]);
      expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
    });

    /** @scenario "AC163 My dashboard cannot be deleted" */
    it("offers no Delete and no Rename on My dashboard", async () => {
      const { user } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for My dashboard" }));

      expect(await screen.findByRole("menuitem", { name: "Delete" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    /** @scenario "AC107 Sidebar menu: each board offers its actions in order" */
    it("offers Unstar, Move up, Move down then Duplicate to edit on a starred template", async () => {
      const { user } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for Release check" }));
      await screen.findByRole("menuitem", { name: "Duplicate to edit" });

      expect(menuItemNames()).toEqual(["Unstar", "Move up", "Move down", "Duplicate to edit"]);
    });

    /** @scenario "AC107b Sidebar menu: reorder is bounded by the Starred list's ends" */
    it("disables Move up on the first star and Move down on the last", async () => {
      const { user } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
      expect(await screen.findByRole("menuitem", { name: "Move up" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull());

      await user.click(screen.getByRole("button", { name: "Actions for Release check" }));
      expect(await screen.findByRole("menuitem", { name: "Move down" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    /** @scenario "AC155 Move up and Move down reorder the member's stars" */
    it("swaps a star with the one above and saves the order, boards and templates alike", async () => {
      const { user, calls } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for Release check" }));
      await user.click(await screen.findByRole("menuitem", { name: "Move up" }));

      await waitFor(() =>
        expect(inputsTo(calls, "dashboards.reorderStars")).toEqual([
          {
            projectId: "proj-1",
            stars: [
              { kind: "template", templateId: "release" },
              { kind: "board", dashboardId: "board-2" },
            ],
          },
        ]),
      );
    });

    /** @scenario "AC109 Sidebar menu: Duplicate copies the board and its widgets" */
    it("copies the board and its widgets, then opens it, starring nothing", async () => {
      const { user, host, calls } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

      await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-new"]));
      expect(inputsTo(calls, "dashboards.create")).toEqual([
        { projectId: "proj-1", name: "Latency copy" },
      ]);
      expect(
        inputsTo(calls, "dashboardWidgets.create").map((input) => (input as { name: string }).name),
      ).toEqual(["Traffic", "Cost"]);
      expect(inputsTo(calls, "dashboards.star")).toEqual([]);
    });

    /** @scenario "From LangWatch: Duplicate to edit makes an own board named after the template" */
    it("duplicates a From LangWatch board as '<name> (copy)'", async () => {
      const { user, calls } = renderSection();

      await user.click(
        await screen.findByRole("button", { name: "Actions for Where my agent breaks" }),
      );
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate to edit" }));

      await waitFor(() =>
        expect(inputsTo(calls, "dashboards.create")).toEqual([
          { projectId: "proj-1", name: "Where my agent breaks (copy)" },
        ]),
      );
    });

    /** @scenario "AC107 Sidebar menu: each board offers its actions in order" */
    it("deletes a team board after the member confirms", async () => {
      const { user, calls } = renderSection({ openPath: "board-1" });

      await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
      const dialog = await screen.findByRole("dialog");
      expect(inputsTo(calls, "dashboards.delete")).toEqual([]);
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() =>
        expect(inputsTo(calls, "dashboards.delete")).toEqual([
          { projectId: "proj-1", dashboardId: "board-1" },
        ]),
      );
    });
  });
});
