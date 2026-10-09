/**
 * @vitest-environment jsdom
 * Board scope in the browser: the control in a board's header and the sidebar's menu, the
 * confirmation and Undo, the marks and the organization's group, the Project chip, the page
 * for a board that is not available, and view-only with "Duplicate to edit".
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import type { DashboardScope } from "@langwatch/dashboard-contract";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import { BOARD_UNAVAILABLE } from "../model/board-scope.ts";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

type Input = Record<string, unknown>;
type Project = { id: string; name: string; slug: string };
type Board = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  createdById: string | null;
  scope: DashboardScope;
  organizationId: string | null;
  ownerProject: Project | null;
  isStarred: boolean;
  updatedAt: Date;
};

const HERE: Project = { id: "proj-1", name: "Test Project", slug: "test-project" };
const CHECKOUT: Project = { id: "proj-2", name: "Checkout", slug: "checkout" };
const VIEWER = ["analytics:view", "cost:view", "traces:view"];

/** A board the project in view owns, made by the member unless a test says otherwise. */
const own = (overrides: Partial<Board> & { id: string; name: string }): Board => ({
  ...HOME_BOARD,
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

/** An Organization board Checkout owns, as this project lists it. */
const shared = (overrides: Partial<Board> & { id: string; name: string }): Board =>
  own({
    projectId: CHECKOUT.id,
    createdById: "user-9",
    scope: "ORGANIZATION",
    organizationId: "org-1",
    ownerProject: CHECKOUT,
    ...overrides,
  });

const widget = ({ id, dashboardId, name }: { id: string; dashboardId: string; name: string }) => ({
  id,
  dashboardId,
  name,
  graph: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "main", sql: "SELECT 1" }],
  },
  gridColumn: 0,
  gridRow: 0,
  colSpan: 4,
  rowSpan: 3,
});

/** The dashboards procedures the scope flows call, answered from memory; every call is kept. */
function scopeServer({
  boards,
  widgets = [],
  otherStars = 0,
  projects = [HERE, CHECKOUT],
}: {
  boards: Board[];
  widgets?: ReturnType<typeof widget>[];
  otherStars?: number;
  projects?: Project[];
}) {
  const state = {
    boards: boards.map((board) => ({ ...board })),
    widgets: [...widgets],
    calls: [] as UiProcedureCall[],
  };
  const find = (id: unknown) => state.boards.find((board) => board.id === id)!;

  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    const input = (call.input ?? {}) as Input;
    switch (call.path) {
      case "dashboards.getAll":
        return Promise.resolve(state.boards.map((board) => ({ ...board })));
      case "dashboards.listStarred":
        return Promise.resolve(
          state.boards
            .filter((board) => board.isStarred)
            .map((board) => ({ kind: "board", dashboard: { ...board } })),
        );
      case "dashboards.setScope":
        find(input.dashboardId).scope = input.scope as DashboardScope;
        return Promise.resolve({ ...find(input.dashboardId) });
      case "dashboards.scopeImpact":
        return Promise.resolve({ otherStars });
      case "dashboards.scopeProjects": {
        const board = find(input.dashboardId);
        return Promise.resolve({ ownerProject: board.ownerProject ?? HERE, projects });
      }
      case "dashboards.create": {
        const created = own({
          id: `board-new-${state.boards.length + 1}`,
          name: String(input.name),
        });
        state.boards.push(created);
        return Promise.resolve({ ...created });
      }
      case "dashboards.updateDetails":
      case "dashboardWidgets.batchUpdateLayouts":
        return Promise.resolve({ success: true });
      case "dashboardWidgets.list":
        return Promise.resolve(
          state.widgets.filter(
            ({ dashboardId }) =>
              input.dashboardId === dashboardId ||
              (input.dashboardId === undefined && find(dashboardId)?.projectId === HERE.id),
          ),
        );
      case "dashboardWidgets.create": {
        const created = widget({
          id: `widget-new-${state.widgets.length + 1}`,
          dashboardId: String(input.dashboardId),
          name: String(input.name),
        });
        state.widgets.push(created);
        return Promise.resolve({ ...created });
      }
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

type Server = ReturnType<typeof scopeServer>;

function open({
  server,
  dashboardId = "board-1",
  withSidebar = false,
  userId = "user-1",
  permissions = [...ANALYTICS_MEMBER_PERMISSIONS],
}: {
  server: Server;
  dashboardId?: string;
  withSidebar?: boolean;
  userId?: string;
  permissions?: string[];
}) {
  const host = new StubAnalyticsHost({
    flags: { release_dashboards: true },
    userId,
    permissions,
    route: { params: { dashboardId }, query: {} },
  });
  renderDashboards({
    element: (
      <>
        {withSidebar && <SavedDashboardsSection openPath={dashboardId} />}
        <DashboardBoardScreen />
        <Toaster />
      </>
    ),
    host,
    answer: server.answer,
  });
  return { host, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const inputsTo = (server: Server, path: string) =>
  server.state.calls.filter((call) => call.path === path).map(({ input }) => input);

/** Each offered choice: its name, whether it is ticked, and all it says. */
const choices = async () =>
  (await screen.findAllByRole("menuitemradio")).map((choice) => ({
    name: choice.getAttribute("aria-label"),
    ticked: choice.getAttribute("aria-checked") === "true",
    text: choice.textContent,
  }));

const scopeBadge = () => document.querySelector("[data-scope-locked]");
const marks = () =>
  [...document.querySelectorAll("[data-scope-mark]")].map((mark) => [
    mark.closest("li")?.textContent?.trim(),
    mark.getAttribute("data-scope-mark"),
  ]);
const listNames = async (name: string) =>
  within(await screen.findByRole("list", { name }))
    .getAllByRole("link")
    .map((link) => link.textContent?.trim());

const WEEKLY = own({ id: "board-1", name: "Weekly review" });

afterEach(() => {
  cleanup();
  toaster.remove();
});

describe("a board's scope in the browser", () => {
  describe("given a board opened by its author in the project that owns it", () => {
    /** @scenario "AC177 Scope control: the board header shows the scope beside the title" */
    it("names the scope on a control beside the title", async () => {
      open({ server: scopeServer({ boards: [WEEKLY] }) });

      const control = await screen.findByRole("button", { name: "Scope: Project" });

      expect({ scope: control.getAttribute("data-scope"), text: control.textContent }).toEqual({
        scope: "PROJECT",
        text: "Project",
      });
    });

    /** @scenario "AC177 Scope control: the board header shows the scope beside the title" */
    it("offers the three scopes with who sees each, the current one ticked", async () => {
      const { user } = open({ server: scopeServer({ boards: [WEEKLY] }) });

      await user.click(await screen.findByRole("button", { name: "Scope: Project" }));

      expect(await choices()).toEqual([
        { name: "Only me", ticked: false, text: "Only meOnly you" },
        { name: "Project", ticked: true, text: "ProjectEveryone in Test Project" },
        {
          name: "Organization",
          ticked: false,
          text: "OrganizationEveryone in Acme, in each of their projects",
        },
      ]);
      expect(screen.getByText("Who can see this dashboard.")).toBeInTheDocument();
    });
  });

  describe("given a board opened by a member who did not make it", () => {
    /** @scenario "AC177 Scope control: the board header shows the scope beside the title" */
    it("shows the scope as a badge that cannot be opened and says why on hover", async () => {
      open({ server: scopeServer({ boards: [{ ...WEEKLY, createdById: "user-2" }] }) });
      await screen.findByRole("heading", { name: "Weekly review" });

      expect({
        control: screen.queryByRole("button", { name: /^Scope:/ }),
        badge: scopeBadge()?.textContent,
        hover: scopeBadge()?.getAttribute("title"),
      }).toEqual({
        control: null,
        badge: "Project",
        hover:
          "Everyone in Test Project can see this dashboard. Only the person who made this dashboard can change its scope.",
      });
    });
  });

  describe("when the author opens a board's menu in the sidebar", () => {
    const boards = [
      WEEKLY,
      own({ id: "board-2", name: "Costs", createdById: "user-2" }),
      shared({ id: "board-9", name: "Quality" }),
    ];

    /** @scenario "AC178 Scope control: the sidebar menu offers the same three choices" */
    it("offers Only me, Project and Organization on their own board, the current one ticked", async () => {
      const { user } = open({ server: scopeServer({ boards }), withSidebar: true });

      await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));

      expect((await choices()).map(({ name, ticked }) => [name, ticked])).toEqual([
        ["Only me", false],
        ["Project", true],
        ["Organization", false],
      ]);
    });

    /** @scenario "AC178 Scope control: the sidebar menu offers the same three choices" */
    it("offers no scope on a board they did not make", async () => {
      const { user } = open({ server: scopeServer({ boards }), withSidebar: true });

      await user.click(await screen.findByRole("button", { name: "Actions for Costs" }));
      await screen.findByRole("menuitem", { name: "Rename" });

      expect(screen.queryAllByRole("menuitemradio")).toEqual([]);
    });

    /** @scenario "AC178 Scope control: the sidebar menu offers the same three choices" */
    it("offers no scope on a board another project owns", async () => {
      const { user } = open({ server: scopeServer({ boards }), withSidebar: true });

      await user.click(await screen.findByRole("button", { name: "Actions for Quality" }));
      await screen.findByRole("menuitem", { name: "Star" });

      expect(screen.queryAllByRole("menuitemradio")).toEqual([]);
    });

    /** @scenario "AC178 Scope control: the sidebar menu offers the same three choices" */
    it("changes the scope from the menu", async () => {
      const server = scopeServer({ boards });
      const { user } = open({ server, withSidebar: true });

      await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
      await user.click(await screen.findByRole("menuitemradio", { name: "Organization" }));

      await waitFor(() =>
        expect(inputsTo(server, "dashboards.setScope")).toEqual([
          { projectId: "proj-1", dashboardId: "board-1", scope: "ORGANIZATION" },
        ]),
      );
    });
  });

  describe("when a change of scope takes the board from someone", () => {
    const pick = async (user: ReturnType<typeof userEvent.setup>, from: string, to: string) => {
      await user.click(await screen.findByRole("button", { name: `Scope: ${from}` }));
      await user.click(await screen.findByRole("menuitemradio", { name: to }));
    };

    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("says how many other people starred it before anything changes", async () => {
      const server = scopeServer({ boards: [WEEKLY], otherStars: 2 });
      const { user } = open({ server });

      await pick(user, "Project", "Only me");

      expect(await screen.findByText('Make "Weekly review" visible only to you?')).toBeVisible();
      expect(screen.getByText(/2 other people starred it\./)).toBeInTheDocument();
      expect(inputsTo(server, "dashboards.setScope")).toEqual([]);
    });

    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("says the other projects will no longer see a board lowered from Organization", async () => {
      const server = scopeServer({
        boards: [{ ...WEEKLY, scope: "ORGANIZATION", organizationId: "org-1" }],
      });
      const { user } = open({ server });

      await pick(user, "Organization", "Project");

      expect(await screen.findByText('Show "Weekly review" only to Test Project?')).toBeVisible();
      expect(
        screen.getByText(/People in the other projects of Acme will no longer see it\./),
      ).toBeInTheDocument();
      expect(inputsTo(server, "dashboards.setScope")).toEqual([]);
    });

    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("leaves the scope as it was when the author cancels", async () => {
      const server = scopeServer({ boards: [WEEKLY], otherStars: 2 });
      const { user } = open({ server });
      await pick(user, "Project", "Only me");

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      await waitFor(() =>
        expect(screen.queryByText('Make "Weekly review" visible only to you?')).toBeNull(),
      );
      expect(inputsTo(server, "dashboards.setScope")).toEqual([]);
    });

    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("changes the scope once the author confirms", async () => {
      const server = scopeServer({ boards: [WEEKLY], otherStars: 2 });
      const { user } = open({ server });
      await pick(user, "Project", "Only me");

      await user.click(await screen.findByRole("button", { name: "Set to Only me" }));

      await waitFor(() =>
        expect(inputsTo(server, "dashboards.setScope")).toEqual([
          { projectId: "proj-1", dashboardId: "board-1", scope: "PRIVATE" },
        ]),
      );
      expect(await screen.findByRole("button", { name: "Scope: Only me" })).toBeInTheDocument();
    });

    /** @scenario "AC180 Scope change: any other change is made at once and offers Undo" */
    it("widens a board at once, with no confirmation and no count of stars read", async () => {
      const server = scopeServer({ boards: [WEEKLY], otherStars: 5 });
      const { user } = open({ server });

      await pick(user, "Project", "Organization");

      expect(
        await screen.findByText(
          'Everyone in Acme can see "Weekly review" now, each with their own project\'s data',
        ),
      ).toBeInTheDocument();
      expect({
        changes: inputsTo(server, "dashboards.setScope"),
        impactReads: inputsTo(server, "dashboards.scopeImpact"),
      }).toEqual({
        changes: [{ projectId: "proj-1", dashboardId: "board-1", scope: "ORGANIZATION" }],
        impactReads: [],
      });
    });

    /** @scenario "AC180 Scope change: any other change is made at once and offers Undo" */
    it("sets a board nobody else starred to Only me at once", async () => {
      const server = scopeServer({ boards: [WEEKLY], otherStars: 0 });
      const { user } = open({ server });

      await pick(user, "Project", "Only me");

      expect(await screen.findByText('Only you can see "Weekly review" now')).toBeInTheDocument();
      expect(inputsTo(server, "dashboards.setScope")).toEqual([
        { projectId: "proj-1", dashboardId: "board-1", scope: "PRIVATE" },
      ]);
    });

    /** @scenario "AC180 Scope change: any other change is made at once and offers Undo" */
    it("puts the scope back on Undo", async () => {
      const server = scopeServer({ boards: [WEEKLY] });
      const { user } = open({ server });
      await pick(user, "Project", "Organization");

      await user.click(await screen.findByRole("button", { name: "Undo" }));

      await waitFor(() =>
        expect(
          inputsTo(server, "dashboards.setScope").map((input) => (input as Input).scope),
        ).toEqual(["ORGANIZATION", "PROJECT"]),
      );
      expect(await screen.findByRole("button", { name: "Scope: Project" })).toBeInTheDocument();
    });
  });

  describe("given boards at each scope in the sidebar", () => {
    const boards = [
      own({ id: "board-mine", name: "My dashboard", scope: "PRIVATE" }),
      WEEKLY,
      own({ id: "board-2", name: "Latency", isStarred: true }),
      own({ id: "board-3", name: "Spend", scope: "ORGANIZATION", organizationId: "org-1" }),
      shared({ id: "board-9", name: "Quality" }),
      shared({ id: "board-8", name: "Adoption" }),
    ];

    /** @scenario "AC181 Sidebar: scope marks and the organization's group" */
    it("marks an Only me board with a lock and an Organization board with a building", async () => {
      open({ server: scopeServer({ boards }), withSidebar: true });
      await screen.findByRole("list", { name: "From Acme" });

      expect(marks()).toEqual([
        ["My dashboard", "PRIVATE"],
        ["Spend", "ORGANIZATION"],
        ["Adoption", "ORGANIZATION"],
        ["Quality", "ORGANIZATION"],
      ]);
    });

    /** @scenario "AC181 Sidebar: scope marks and the organization's group" */
    it("lists other projects' boards under From <organization>, by name, after Starred", async () => {
      open({ server: scopeServer({ boards }), withSidebar: true });

      expect({
        fromOrganization: await listNames("From Acme"),
        order: screen.getAllByRole("list").map((list) => list.getAttribute("aria-label")),
        yours: await listNames("Your dashboards"),
      }).toEqual({
        fromOrganization: ["Adoption", "Quality"],
        order: ["Your dashboards", "Starred dashboards", "From Acme", "From LangWatch"],
        yours: ["My dashboard", "Spend", "Weekly review"],
      });
    });

    /** @scenario "AC181 Sidebar: scope marks and the organization's group" */
    it("has no such group when no other project shares a board", async () => {
      open({ server: scopeServer({ boards: [WEEKLY] }), withSidebar: true });
      await screen.findByRole("list", { name: "Your dashboards" });

      expect(screen.queryByText(/^From Acme$/)).toBeNull();
    });
  });

  describe("given an Organization board", () => {
    const spend = own({
      id: "board-1",
      name: "Spend",
      scope: "ORGANIZATION",
      organizationId: "org-1",
    });

    /** @scenario "AC182 Organization board: the Project chip says whose data it shows" */
    it("names the project whose data is on screen in a chip", async () => {
      open({ server: scopeServer({ boards: [spend] }) });

      const chip = await screen.findByRole("button", { name: "Project: Test Project" });

      expect(chip.textContent).toBe("ProjectTest Project");
    });

    /** @scenario "AC182 Organization board: the Project chip says whose data it shows" */
    it("lists the projects the reader can open, the owner marked, with no All projects", async () => {
      const { user } = open({ server: scopeServer({ boards: [spend] }) });

      await user.click(await screen.findByRole("button", { name: "Project: Test Project" }));

      expect(await choices()).toEqual([
        { name: "Test Project", ticked: true, text: "Test Projectowner" },
        { name: "Checkout", ticked: false, text: "Checkout" },
      ]);
      expect(
        screen.getByText("Whose data this dashboard shows. One project at a time."),
      ).toBeInTheDocument();
    });

    /** @scenario "AC182 Organization board: the Project chip says whose data it shows" */
    it("opens the same board under the project the reader chooses", async () => {
      const { host, user } = open({ server: scopeServer({ boards: [spend] }) });

      await user.click(await screen.findByRole("button", { name: "Project: Test Project" }));
      await user.click(await screen.findByRole("menuitemradio", { name: "Checkout" }));

      expect(host.navigations).toEqual(["/checkout/dashboards/board-1"]);
    });
  });

  describe("given a Project board", () => {
    /** @scenario "AC182 Organization board: the Project chip says whose data it shows" */
    it("has no Project chip, and asks for no list of projects", async () => {
      const server = scopeServer({ boards: [WEEKLY] });
      open({ server });
      await screen.findByRole("button", { name: "Scope: Project" });

      expect({
        chip: screen.queryByRole("button", { name: /^Project:/ }),
        asked: inputsTo(server, "dashboards.scopeProjects"),
      }).toEqual({ chip: null, asked: [] });
    });
  });

  describe("given the address of a board the server does not list for this member", () => {
    /** @scenario "AC183 A board the reader may not open is not available" */
    it("says the dashboard is not available, and why it may be", async () => {
      open({ server: scopeServer({ boards: [WEEKLY] }), dashboardId: "board-private" });

      expect(
        await screen.findByRole("heading", { name: BOARD_UNAVAILABLE.title }),
      ).toBeInTheDocument();
      expect(screen.getByText(BOARD_UNAVAILABLE.body)).toBeInTheDocument();
    });

    /** @scenario "AC183 A board the reader may not open is not available" */
    it("shows no board control and reads no widget", async () => {
      const server = scopeServer({ boards: [WEEKLY] });
      open({ server, dashboardId: "board-private" });
      await screen.findByRole("heading", { name: BOARD_UNAVAILABLE.title });

      expect({
        headings: screen.getAllByRole("heading").map((heading) => heading.textContent),
        buttons: screen.queryAllByRole("button"),
        widgetReads: inputsTo(server, "dashboardWidgets.list"),
      }).toEqual({ headings: [BOARD_UNAVAILABLE.title], buttons: [], widgetReads: [] });
    });
  });

  describe("given an Organization board opened in a project that does not own it", () => {
    const quality = shared({ id: "board-1", name: "Quality", description: "Checks that passed" });
    const withWidget = () =>
      scopeServer({
        boards: [quality],
        widgets: [widget({ id: "w-1", dashboardId: "board-1", name: "Pass rate" })],
      });

    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("reads the board's widgets by board, from the project that owns it", async () => {
      const server = withWidget();
      open({ server });

      expect(await screen.findByText("Pass rate")).toBeInTheDocument();
      expect(inputsTo(server, "dashboardWidgets.list")).toEqual([
        { projectId: "proj-1", dashboardId: "board-1" },
      ]);
    });

    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("offers no way to add, move or describe", async () => {
      open({ server: withWidget() });
      await screen.findByText("Pass rate");

      expect({
        add: screen.queryAllByRole("button", { name: /Add a widget/ }),
        dragHandles: screen.queryAllByTitle("Drag to move"),
        describe: screen.queryByTitle("Edit description"),
        description: screen.getByText("Checks that passed").tagName,
      }).toEqual({ add: [], dragHandles: [], describe: null, description: "P" });
    });

    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("keeps only the widget menu actions that change nothing", async () => {
      const { user } = open({ server: withWidget() });

      await user.click(await screen.findByRole("button", { name: "Actions for Pass rate" }));
      await screen.findByRole("menuitem", { name: /Copy widget id/ });

      expect(screen.getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual([
        "Copy widget id",
        expect.stringMatching(/^Export CSV/),
      ]);
    });

    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("says in the header who owns it", async () => {
      open({ server: withWidget() });
      await screen.findByRole("heading", { name: "Quality" });

      expect({
        badge: scopeBadge()?.textContent,
        lock: scopeBadge()?.getAttribute("data-scope-locked"),
      }).toEqual({ badge: "Acme · owned by Checkout", lock: "guest" });
    });

    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("offers no Rename and no Delete in the sidebar menu", async () => {
      const { user } = open({ server: withWidget(), withSidebar: true });

      await user.click(await screen.findByRole("button", { name: "Actions for Quality" }));
      await screen.findByRole("menuitem", { name: "Star" });

      expect(screen.getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual([
        "Star",
        "Duplicate to edit",
      ]);
    });

    /** @scenario "AC185 View-only: Duplicate to edit makes the reader's own copy" */
    it("copies the board and its widgets into this project, and opens the copy", async () => {
      const server = withWidget();
      const { host, user } = open({ server, withSidebar: true });

      await user.click(await screen.findByRole("button", { name: "Actions for Quality" }));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate to edit" }));

      await waitFor(() =>
        expect(host.navigations).toEqual(["/test-project/dashboards/board-new-2"]),
      );
      expect({
        board: inputsTo(server, "dashboards.create"),
        widgets: inputsTo(server, "dashboardWidgets.create").map((input) => {
          const { projectId, dashboardId, name } = input as Input;
          return { projectId, dashboardId, name };
        }),
      }).toEqual({
        board: [{ projectId: "proj-1", name: "Quality copy" }],
        widgets: [{ projectId: "proj-1", dashboardId: "board-new-2", name: "Pass rate" }],
      });
    });

    /** @scenario "AC185 View-only: Duplicate to edit makes the reader's own copy" */
    it("reads the widgets to copy by board, from the project that owns it", async () => {
      const server = withWidget();
      const { host, user } = open({ server, withSidebar: true });

      await user.click(await screen.findByRole("button", { name: "Actions for Quality" }));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate to edit" }));
      await waitFor(() => expect(host.navigations).toHaveLength(1));

      expect(inputsTo(server, "dashboardWidgets.list")).toContainEqual({
        projectId: "proj-1",
        dashboardId: "board-1",
      });
    });

    /** @scenario "AC185 View-only: Duplicate to edit makes the reader's own copy" */
    it("has no Duplicate to edit in the header, as on a From LangWatch board", async () => {
      open({ server: withWidget() });
      await screen.findByText("Pass rate");

      expect(screen.queryByRole("button", { name: "Duplicate to edit" })).toBeNull();
    });

    /** @scenario "AC185 View-only: Duplicate to edit makes the reader's own copy" */
    it("offers no copy to a reader who may not create boards", async () => {
      const { user } = open({ server: withWidget(), withSidebar: true, permissions: VIEWER });

      await user.click(await screen.findByRole("button", { name: "Actions for Quality" }));
      await screen.findByRole("menuitem", { name: "Star" });

      expect({
        header: screen.queryByRole("button", { name: "Duplicate to edit" }),
        menu: screen.getAllByRole("menuitem").map((item) => item.textContent?.trim()),
        newBoard: screen.queryByRole("button", { name: "New dashboard" }),
      }).toEqual({ header: null, menu: ["Star"], newBoard: null });
    });
  });

  describe("given a member without the edit permission, in the project that owns the board", () => {
    const withWidget = () =>
      scopeServer({
        boards: [WEEKLY],
        widgets: [widget({ id: "w-1", dashboardId: "board-1", name: "Traces" })],
      });

    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("gets the board view-only, on a board they made too", async () => {
      const { user } = open({ server: withWidget(), permissions: VIEWER });
      await screen.findByText("Traces");

      await user.click(screen.getByRole("button", { name: "Actions for Traces" }));
      await screen.findByRole("menuitem", { name: /Copy widget id/ });

      expect({
        add: screen.queryAllByRole("button", { name: /Add a widget/ }),
        dragHandles: screen.queryAllByTitle("Drag to move"),
        menu: screen.getAllByRole("menuitem").map((item) => item.textContent?.trim()),
        scopeControl: screen.queryByRole("button", { name: /^Scope:/ }),
        lock: scopeBadge()?.getAttribute("data-scope-locked"),
      }).toEqual({
        add: [],
        dragHandles: [],
        menu: ["Copy widget id", expect.stringMatching(/^Export CSV/)],
        scopeControl: null,
        lock: "no-permission",
      });
    });
  });
});
