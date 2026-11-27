/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import type { DashboardScope } from "@langwatch/dashboard-contract";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { useStartDraft } from "../behavior/use-draft-board.ts";
import { FROM_LANGWATCH_ABOUT } from "../model/curated-boards.ts";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const board = ({
  id,
  name,
  createdById = "user-1",
  scope = "PROJECT",
  myDashboardOfUserId = null,
}: {
  id: string;
  name: string;
  createdById?: string;
  scope?: DashboardScope;
  myDashboardOfUserId?: string | null;
}) => ({
  ...HOME_BOARD,
  scope,
  id,
  name,
  order: 0,
  description: null,
  createdById,
  myDashboardOfUserId,
  isStarred: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  _count: { graphs: 0 },
});

const MINE = board({
  id: "board-mine",
  name: "My dashboard",
  scope: "PRIVATE",
  myDashboardOfUserId: "user-1",
});
const WEEKLY = board({ id: "board-1", name: "Weekly review" });
const LATENCY = board({ id: "board-2", name: "Latency" });
const COSTS = board({ id: "board-3", name: "Costs", createdById: "user-2" });
/** Another member's My dashboard, which the server lists only once its author widened it. */
const THEIRS = board({ id: "board-theirs", name: "My dashboard", createdById: "user-2" });
const BOARDS = [WEEKLY, MINE, LATENCY, COSTS];

type Star =
  | { kind: "board"; dashboard: ReturnType<typeof board> }
  | { kind: "template"; templateId: string };

/** The member starred Latency, then the Ready to ship? template. */
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
  "boards.update",
  "boards.star",
  "boards.unstar",
  "boards.reorderStars",
  "boards.delete",
  "dashboardWidgets.batchUpdateLayouts",
];

/** Answers the board list, the stars and the writes, keeping every call for the test. */
function project({
  stars = STARS,
  listFails = false,
  boards = BOARDS,
}: {
  stars?: Star[];
  listFails?: boolean;
  boards?: ReturnType<typeof board>[];
}) {
  const calls: UiProcedureCall[] = [];
  let stored = [...boards];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    // A rename is kept, so the re-read after it lists the new name as the server would.
    if (call.path === "boards.update") {
      const { dashboardId, name } = call.input as { dashboardId: string; name?: string };
      stored = stored.map((row) => (row.id === dashboardId && name ? { ...row, name } : row));
    }
    if (call.path === "boards.listStarred") {
      return listFails
        ? Promise.reject(new UiProcedureRefusal("FORBIDDEN", 403))
        : Promise.resolve(stars);
    }
    if (call.path === "boards.getAll") return Promise.resolve(stored);
    if (call.path === "boards.create") {
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
}: {
  openPath?: string;
  stars?: Star[];
  listFails?: boolean;
  boards?: ReturnType<typeof board>[];
} = {}) {
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
    /** @scenario "AC161 The sidebar lists Your dashboards, Pinned and From LangWatch in order" */
    it("shows the groups in the prototype's order, each board once", async () => {
      renderSection();

      expect(await namesIn("Your dashboards")).toEqual(["My dashboard", "Costs", "Weekly review"]);
      expect(await namesIn("Pinned dashboards")).toEqual(["Latency", "Ready to ship?"]);
      expect(await namesIn("From LangWatch")).toEqual(["Fix missing data", "Errors and failures"]);
      expect(screen.queryByRole("link", { name: /Browse templates/ })).toBeNull();
      expect(screen.queryByText("All dashboards")).toBeNull();
    });

    /** @scenario "AC161b Your dashboards: My dashboard first, then the team's unpinned boards by name" */
    it("lists another member's My dashboard once its author widened it, after the member's own", async () => {
      renderSection({ boards: [...BOARDS, THEIRS] });

      const yours = within(await listNamed("Your dashboards")).getAllByRole("link");
      expect(yours.map((link) => link.getAttribute("href"))).toEqual([
        "/test-project/dashboards/board-mine",
        "/test-project/dashboards/board-3",
        "/test-project/dashboards/board-theirs",
        "/test-project/dashboards/board-1",
      ]);
    });

    /** @scenario "AC161 The sidebar lists Your dashboards, Pinned and From LangWatch in order" */
    it("links a From LangWatch board to its live address and marks the open one", async () => {
      renderSection({ openPath: "curated/data" });

      const data = within(await listNamed("From LangWatch")).getByRole("link", {
        name: /Fix missing data/,
      });
      expect(data).toHaveAttribute("href", "/test-project/dashboards/curated/data");
      expect(data).toHaveAttribute("aria-current", "page");
    });
  });

  describe("given the member has no stars", () => {
    /** @scenario "AC161c Pinned shows only when the member has pins, in their own order" */
    it("shows no Pinned group", async () => {
      renderSection({ stars: [] });

      await listNamed("Your dashboards");
      expect(screen.queryByText("Pinned")).toBeNull();
      expect(await namesIn("From LangWatch")).toHaveLength(3);
    });
  });

  describe("when the stars fail to load", () => {
    /** @scenario "AC161c Pinned shows only when the member has pins, in their own order" */
    it("shows a one-line error with Retry and keeps the + to make a board", async () => {
      renderSection({ listFails: true });

      expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New dashboard" })).toBeInTheDocument();
    });
  });

  describe("when the member presses the '+' on Your dashboards", () => {
    /** @scenario "AC162 The '+' on Your dashboards opens a new board without storing it" */
    it("opens a new board at once, with no menu, and stores nothing", async () => {
      const { user, calls, host } = renderSection();
      await listNamed("Your dashboards");

      await user.click(screen.getByRole("button", { name: "New dashboard" }));

      expect(screen.queryByRole("menuitem")).toBeNull();
      expect(host.navigations).toEqual(["/test-project/dashboards/new"]);
      expect(inputsTo(calls, "boards.create")).toEqual([]);
    });
  });

  describe("given the new board is open", () => {
    /** @scenario "AC162 The '+' on Your dashboards opens a new board without storing it" */
    it("lists it under Your dashboards as the open, numbered untitled board", async () => {
      renderSection({ openPath: "new" });

      expect(await namesIn("Your dashboards")).toEqual([
        "My dashboard",
        "Costs",
        "Weekly review",
        "Untitled dashboard 1",
      ]);
      const row = screen.getByRole("link", { name: "Untitled dashboard 1" });
      expect(row).toHaveAttribute("aria-current", "page");
      expect(row).toHaveAttribute("href", "/test-project/dashboards/new");
    });

    /** @scenario "AC162b Leaving a new board unedited stores nothing" */
    it("drops the row once the member is elsewhere, having stored nothing", async () => {
      const { calls } = renderSection({ openPath: "board-1" });

      expect(await namesIn("Your dashboards")).not.toContain("Untitled dashboard 1");
      expect(inputsTo(calls, "boards.create")).toEqual([]);
    });

    /** @scenario "AC162d Renaming, describing or pinning a new board stores it with that edit" */
    it("stores the board under the name it is renamed to, in one call", async () => {
      const { user, calls } = renderSection({ openPath: "new" });
      await listNamed("Your dashboards");

      await user.click(screen.getByRole("button", { name: "Actions for Untitled dashboard 1" }));
      await user.click(await screen.findByRole("menuitem", { name: /Rename/ }));
      const field = screen.getByRole("textbox", { name: "Dashboard name" });
      await user.clear(field);
      await user.type(field, "Refunds{Enter}");

      await waitFor(() =>
        expect(inputsTo(calls, "boards.create")).toEqual([
          { projectId: "proj-1", name: "Refunds", homeProduct: "llm-ops" },
        ]),
      );
      expect(inputsTo(calls, "boards.update")).toEqual([]);
    });

    /** @scenario "AC162d Renaming, describing or pinning a new board stores it with that edit" */
    it("stores and pins the board when its pin is pressed", async () => {
      const { user, calls } = renderSection({ openPath: "new" });
      const draftLink = await screen.findByRole("link", { name: "Untitled dashboard 1" });

      await user.click(within(draftLink).getByRole("button", { name: "Pin dashboard" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.star")).toEqual([
          { projectId: "proj-1", star: { kind: "board", dashboardId: "board-new" } },
        ]),
      );
      expect(inputsTo(calls, "boards.create")).toHaveLength(1);
    });
  });

  describe("given a new board opened to be pinned once stored", () => {
    /** Presses a "+" that opens a new board pinned, as the Pinned group's does. */
    function PinnedPlus() {
      const startDraft = useStartDraft();
      return (
        <button
          type="button"
          onClick={() =>
            startDraft({ projectId: "proj-1", projectSlug: "test-project", pin: true })
          }
        >
          New pinned dashboard
        </button>
      );
    }

    /** @scenario "AC162d Renaming, describing or pinning a new board stores it with that edit" */
    it("takes the pin off when unpinned, storing nothing, and stores the board unpinned later", async () => {
      const host = new StubAnalyticsHost({ flags: { release_dashboards: true } });
      const { calls, answer } = project({});
      renderDashboards({
        element: (
          <>
            <PinnedPlus />
            <SavedDashboardsSection openPath="new" />
          </>
        ),
        host,
        answer,
      });
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await listNamed("Your dashboards");
      await user.click(screen.getByRole("button", { name: "New pinned dashboard" }));
      const draftLink = await screen.findByRole("link", { name: "Untitled dashboard 1" });

      await user.click(within(draftLink).getByRole("button", { name: "Unpin dashboard" }));

      expect(within(draftLink).getByRole("button", { name: "Pin dashboard" })).toBeInTheDocument();
      expect(inputsTo(calls, "boards.create")).toEqual([]);
      await user.click(screen.getByRole("button", { name: "Actions for Untitled dashboard 1" }));
      await user.click(await screen.findByRole("menuitem", { name: /Rename/ }));
      await user.type(screen.getByRole("textbox", { name: "Dashboard name" }), "!{Enter}");
      await waitFor(() => expect(inputsTo(calls, "boards.create")).toHaveLength(1));
      expect(inputsTo(calls, "boards.star")).toEqual([]);
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

      // Tab from the heading: only keyboard focus opens a tooltip.
      screen.getByRole("button", { name: "From LangWatch" }).focus();
      await user.tab();
      expect(about).toHaveFocus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(FROM_LANGWATCH_ABOUT);
      expect(screen.getByRole("button", { name: "From LangWatch" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(FROM_LANGWATCH_ABOUT).toBe(
        "Dashboards LangWatch made for you. They improve over time. Change one and it becomes " +
          "your own copy.",
      );
    });
  });

  describe("when the member pins and unpins from the row's pin", () => {
    /** @scenario "AC165 A pin can point at a From LangWatch board" */
    it("stars a From LangWatch board by its template id", async () => {
      const { user, calls, host } = renderSection();
      const data = within(await listNamed("From LangWatch"))
        .getAllByRole("listitem")
        .find((item) => item.textContent?.includes("Fix missing data"));

      await user.click(within(data!).getByRole("button", { name: "Pin dashboard" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.star")).toEqual([
          { projectId: "proj-1", star: { kind: "template", templateId: "data" } },
        ]),
      );
      expect(host.navigations).toEqual([]);
    });

    /** @scenario "AC165 A pin can point at a From LangWatch board" */
    it("unstars a starred board", async () => {
      const { user, calls } = renderSection();
      const starred = within(await listNamed("Pinned dashboards"));

      await user.click(starred.getAllByRole("button", { name: "Unpin dashboard" })[0]!);

      await waitFor(() =>
        expect(inputsTo(calls, "boards.unstar")).toEqual([
          { projectId: "proj-1", star: { kind: "board", dashboardId: "board-2" } },
        ]),
      );
    });
  });

  describe("when the member opens a board's menu", () => {
    /** @scenario "AC107 Sidebar menu: each board offers its actions in order" */
    it("offers Pin, Rename, Duplicate and Delete on a team board", async () => {
      const { user } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
      await screen.findByRole("menuitem", { name: "Delete" });

      expect(menuItemNames()).toEqual(["Pin", "Rename", "Duplicate", "Delete"]);
      expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
    });

    /** @scenario "AC163 My dashboard cannot be deleted" */
    it("offers Rename and a disabled Delete on My dashboard", async () => {
      const { user } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for My dashboard" }));

      expect(await screen.findByRole("menuitem", { name: "Delete" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getByRole("menuitem", { name: "Rename" })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    /** @scenario "My dashboards made before the mark are marked by a background step" */
    it("offers no Rename on a My dashboard the step has not marked yet", async () => {
      const unmarked = { ...MINE, myDashboardOfUserId: null };
      const { user } = renderSection({ boards: [WEEKLY, unmarked, LATENCY, COSTS] });

      await user.click(await screen.findByRole("button", { name: "Actions for My dashboard" }));

      expect(await screen.findByRole("menuitem", { name: "Rename" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    /** @scenario "My dashboard can be renamed and stays the member's My dashboard" */
    it("renames My dashboard from its menu and keeps it first, still undeletable", async () => {
      const { user, calls } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for My dashboard" }));
      await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
      const field = await screen.findByRole("textbox");
      await user.clear(field);
      await user.type(field, "Team pulse{Enter}");

      await waitFor(() =>
        expect(inputsTo(calls, "boards.update")).toEqual([
          { projectId: "proj-1", dashboardId: "board-mine", name: "Team pulse" },
        ]),
      );
      expect(inputsTo(calls, "boards.create")).toEqual([]);

      await waitFor(async () =>
        expect(await namesIn("Your dashboards")).toEqual(["Team pulse", "Costs", "Weekly review"]),
      );
      await user.click(screen.getByRole("button", { name: "Actions for Team pulse" }));
      expect(await screen.findByRole("menuitem", { name: "Delete" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    /** @scenario "AC163 My dashboard cannot be deleted" */
    it("offers the three scope choices on My dashboard, Only me ticked", async () => {
      const { user } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for My dashboard" }));
      const choices = await screen.findAllByRole("menuitemradio");

      expect(
        choices.map((choice) => [
          choice.getAttribute("aria-label"),
          choice.getAttribute("aria-checked"),
        ]),
      ).toEqual([
        ["Only me", "true"],
        ["Project", "false"],
        ["Organization", "false"],
      ]);
    });

    /** @scenario "AC107 Sidebar menu: each board offers its actions in order" */
    it("offers Unpin, Move up, Move down then Duplicate to edit on a starred template", async () => {
      const { user } = renderSection();
      const starred = within(await listNamed("Pinned dashboards"));

      await user.click(starred.getByRole("button", { name: "Actions for Ready to ship?" }));
      await screen.findByRole("menuitem", { name: "Duplicate to edit" });

      expect(menuItemNames()).toEqual(["Unpin", "Move up", "Move down", "Duplicate to edit"]);
    });

    /** @scenario "AC107b Sidebar menu: reorder is bounded by the Pinned list's ends" */
    it("disables Move up on the first star and Move down on the last", async () => {
      const { user } = renderSection();

      await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
      expect(await screen.findByRole("menuitem", { name: "Move Latency up" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByRole("menuitem", { name: "Move Latency up" })).toBeNull(),
      );

      await user.click(screen.getByRole("button", { name: "Actions for Ready to ship?" }));
      expect(
        await screen.findByRole("menuitem", { name: "Move Ready to ship? down" }),
      ).toHaveAttribute("aria-disabled", "true");
    });

    /** @scenario "AC155 Move up and Move down reorder the member's pins" */
    it("swaps a star with the one above and saves the order, boards and templates alike", async () => {
      const { user, calls } = renderSection();
      const starred = within(await listNamed("Pinned dashboards"));

      await user.click(starred.getByRole("button", { name: "Actions for Ready to ship?" }));
      await user.click(await screen.findByRole("menuitem", { name: "Move Ready to ship? up" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.reorderStars")).toEqual([
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

    /** @scenario "AC155b Pins the section does not show keep their place in the pin order" */
    it("keeps a hidden My dashboard first in the saved order when a shown star moves", async () => {
      const { user, calls } = renderSection({
        stars: [{ kind: "board", dashboard: MINE }, ...STARS],
      });
      const starred = within(await listNamed("Pinned dashboards"));
      expect(await namesIn("Pinned dashboards")).toEqual(["Latency", "Ready to ship?"]);

      await user.click(starred.getByRole("button", { name: "Actions for Ready to ship?" }));
      await user.click(await screen.findByRole("menuitem", { name: "Move Ready to ship? up" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.reorderStars")).toEqual([
          {
            projectId: "proj-1",
            stars: [
              { kind: "board", dashboardId: "board-mine" },
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
      expect(inputsTo(calls, "boards.create")).toEqual([
        { projectId: "proj-1", name: "Latency copy" },
      ]);
      expect(
        inputsTo(calls, "dashboardWidgets.create").map((input) => (input as { name: string }).name),
      ).toEqual(["Traffic", "Cost"]);
      expect(inputsTo(calls, "boards.star")).toEqual([]);
    });

    /** @scenario "From LangWatch: Duplicate to edit makes an own board named after the template" */
    it("duplicates a From LangWatch board as '<name> (copy)'", async () => {
      const { user, calls } = renderSection();

      await user.click(
        await screen.findByRole("button", { name: "Actions for Errors and failures" }),
      );
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate to edit" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.create")).toEqual([
          { projectId: "proj-1", name: "Errors and failures (copy)" },
        ]),
      );
    });

    /** @scenario "AC107 Sidebar menu: each board offers its actions in order" */
    it("deletes a team board after the member confirms", async () => {
      const { user, calls } = renderSection({ openPath: "board-1" });

      await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(inputsTo(calls, "boards.delete")).toEqual([]);
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.delete")).toEqual([
          { projectId: "proj-1", dashboardId: "board-1" },
        ]),
      );
    });
  });
});
