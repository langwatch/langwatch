/**
 * @vitest-environment jsdom
 * The Dashboards section analytics lends the sidebars: the dashboards the member pinned to the
 * project as links into Dashboards, a "+" that opens a new dashboard with "Add a widget" open,
 * pinned once its first edit stores it, and an "Add dashboard" item when nothing is pinned.
 * @see modules/navigation/specs/product-sidebars.feature
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { StarredDashboardsProject } from "@langwatch/analytics-client";
import type { UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { AnalyticsRouteReading } from "../../../model/analytics-host.ts";
import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import { type DraftEdit, useDraftBoard } from "../behavior/use-draft-board.ts";
import { CURATED_BOARDS } from "../model/curated-boards.ts";
import { StarredDashboardsSection } from "../ui/sections/starred-dashboards-section.tsx";
import {
  HOME_BOARD,
  NO_PROCEDURES,
  RecordingUiAnalytics,
  renderDashboards,
  withAnalytics,
} from "./render-dashboards.test-helpers.tsx";

const LATENCY = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Latency",
  order: 0,
  description: null,
  createdById: "user-1",
  isStarred: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  _count: { graphs: 0 },
};

/**
 * Keeps what is registered as PostHog does, and notes the projectId each event went out with.
 * Starts as the shell leaves it: the page's project ("proj-1") registered.
 */
class RegisteringUiAnalytics extends RecordingUiAnalytics {
  registered: Readonly<Record<string, unknown>> = { projectId: "proj-1" };
  readonly sent: { action?: string; attributes?: unknown; projectId: unknown }[] = [];

  override register(properties: Readonly<Record<string, unknown>>): void {
    this.registered = { ...this.registered, ...properties };
  }

  override unregister(property: string): void {
    this.registered = Object.fromEntries(
      Object.entries(this.registered).filter(([key]) => key !== property),
    );
  }

  override track(event: UiAnalyticsEvent): void {
    super.track(event);
    const { action, attributes } = event;
    this.sent.push({ action, attributes, projectId: this.registered.projectId });
  }
}

/** Viewing only: no analytics:create. */
const VIEWER = ["analytics:view"];

function renderSection({
  stars,
  fails = false,
  permissions,
  pinFails = false,
  holdUpdates = false,
  project,
  projectPermissions,
  tracked,
  route,
}: {
  stars: unknown[];
  fails?: boolean;
  permissions?: string[];
  pinFails?: boolean;
  /** Holds every `boards.update` answer until the test releases it. */
  holdUpdates?: boolean;
  /** What navigation hands the section on a page about no project. */
  project?: StarredDashboardsProject;
  /** The member's grants in projects other than the page's, by project id. */
  projectPermissions?: Readonly<Record<string, readonly string[]>>;
  /** Records the product events the section sends. */
  tracked?: RecordingUiAnalytics;
  /** The page's route, such as the new board "+" opened. */
  route?: AnalyticsRouteReading;
}) {
  const host = new StubAnalyticsHost({
    ...(permissions ? { permissions } : {}),
    ...(projectPermissions ? { projectPermissions } : {}),
    ...(route ? { route } : {}),
  });
  const calls: UiProcedureCall[] = [];
  const heldUpdates: (() => void)[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "boards.listStarred") {
      return fails ? Promise.reject(new Error("down")) : Promise.resolve(stars);
    }
    if (call.path === "boards.getAll") return Promise.resolve([]);
    if (call.path === "boards.create") {
      return Promise.resolve({ ...LATENCY, id: "board-new" });
    }
    if (call.path === "boards.update") {
      const updated = { ...LATENCY, id: "board-new" };
      if (!holdUpdates) return Promise.resolve(updated);
      return new Promise((resolve) => heldUpdates.push(() => resolve(updated)));
    }
    if (call.path === "boards.unstar" || call.path === "boards.delete") {
      return Promise.resolve({ success: true });
    }
    if (call.path === "boards.star") {
      return pinFails
        ? Promise.reject(new UiProcedureRefusal("dashboard_not_found", 404))
        : Promise.resolve({ success: true });
    }
    return NO_PROCEDURES(call);
  };
  const element = (
    <>
      <StarredDashboardsSection project={project} />
      <DraftEdits />
    </>
  );
  renderDashboards({
    element: tracked ? withAnalytics(element, tracked) : element,
    host,
    answer,
  });
  return { host, calls, releaseUpdate: () => heldUpdates.shift()?.() };
}

/** The new board's first edit, made as the board screen makes it. */
const draft: {
  edit: (edit?: DraftEdit) => Promise<string>;
  unpin: () => void;
} = {
  edit: () => Promise.reject(new Error("No draft mounted")),
  unpin: () => undefined,
};

function DraftEdits() {
  const { materialise, unpin } = useDraftBoard({ takenNames: [] });
  draft.edit = materialise;
  draft.unpin = unpin;
  return null;
}

/** The address "+" opens, with "Add a widget" open on it. */
const ON_NEW_BOARD = { params: { dashboardId: "new" }, query: { addBlock: "open" } };

const inputsTo = (calls: UiProcedureCall[], path: string) =>
  calls.filter((call) => call.path === path).map(({ input }) => input);

const section = async () => within(await screen.findByRole("region", { name: "Dashboards" }));

const starsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    kind: "board",
    dashboard: { ...LATENCY, id: `board-${index}`, name: `Board ${index}` },
  }));

afterEach(cleanup);

describe("the LLM Ops sidebar's Dashboards section", () => {
  describe("given the member pinned a board and a From LangWatch board", () => {
    /** @scenario "The LLM Ops sidebar has a Dashboards section listing the pinned dashboards" */
    it("titles itself Dashboards, lists both in the member's order, and an entry opens it", async () => {
      const user = userEvent.setup();
      const { host } = renderSection({
        stars: [
          { kind: "board", dashboard: LATENCY },
          { kind: "template", templateId: "release" },
        ],
      });

      const group = await section();
      expect(group.getByText("Dashboards")).toBeInTheDocument();
      const release = CURATED_BOARDS.find(({ templateId }) => templateId === "release")!;
      await waitFor(() =>
        expect(group.getAllByRole("link").map((link) => link.textContent)).toEqual([
          "Latency",
          release.name,
        ]),
      );
      await user.click(group.getByRole("link", { name: "Latency" }));
      expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]);
    });
  });

  describe("given a pinned board is the page open, with the library off", () => {
    /** @scenario "The open board's sidebar row is marked as the page I am on" */
    it("marks its row, and no other, as the current page", async () => {
      renderSection({
        stars: [
          { kind: "board", dashboard: LATENCY },
          { kind: "template", templateId: "release" },
        ],
        route: { params: { project: "test-project", dashboardId: LATENCY.id }, query: {} },
      });

      const group = await section();
      await waitFor(() => expect(group.getAllByRole("link")).toHaveLength(2));
      const current = group
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page");
      expect(current.map((link) => link.textContent)).toEqual(["Latency"]);
    });
  });

  describe("given the member opens a pinned board's \u22ee menu", () => {
    /** @scenario "A pinned dashboard in the LLM Ops sidebar has the same menu as in Dashboards" */
    it("offers Unpin, Rename, Duplicate and Delete, and Delete asks first then deletes it", async () => {
      const user = userEvent.setup();
      const { calls } = renderSection({ stars: [{ kind: "board", dashboard: LATENCY }] });

      await user.click(
        await (await section()).findByRole("button", { name: "Actions for Latency" }),
      );
      for (const name of ["Unpin", "Rename", "Duplicate", "Delete"]) {
        expect(await screen.findByRole("menuitem", { name })).toBeInTheDocument();
      }
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(inputsTo(calls, "boards.delete")).toEqual([]);
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
      );

      await waitFor(() =>
        expect(inputsTo(calls, "boards.delete")).toEqual([
          { projectId: "proj-1", dashboardId: "board-1" },
        ]),
      );
    });

    /** @scenario "A pinned dashboard in the LLM Ops sidebar has the same menu as in Dashboards" */
    it("offers only Unpin on a From LangWatch board", async () => {
      const user = userEvent.setup();
      renderSection({ stars: [{ kind: "template", templateId: "release" }] });
      const release = CURATED_BOARDS.find(({ templateId }) => templateId === "release")!;

      await user.click(
        await (await section()).findByRole("button", { name: `Actions for ${release.name}` }),
      );

      expect(await screen.findByRole("menuitem", { name: "Unpin" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });

    /** @scenario "A pinned dashboard in the LLM Ops sidebar has the same menu as in Dashboards" */
    it("unpins a stored board through boards.unstar", async () => {
      const user = userEvent.setup();
      const { calls } = renderSection({ stars: [{ kind: "board", dashboard: LATENCY }] });

      await user.click(
        await (await section()).findByRole("button", { name: "Actions for Latency" }),
      );
      await user.click(await screen.findByRole("menuitem", { name: "Unpin" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.unstar")).toEqual([
          { projectId: "proj-1", star: { kind: "board", dashboardId: "board-1" } },
        ]),
      );
    });

    /** @scenario "A pinned dashboard in the LLM Ops sidebar has the same menu as in Dashboards" */
    it("offers only Unpin on a stored board the member may only read", async () => {
      const user = userEvent.setup();
      renderSection({ stars: [{ kind: "board", dashboard: LATENCY }], permissions: VIEWER });

      await user.click(
        await (await section()).findByRole("button", { name: "Actions for Latency" }),
      );

      expect(await screen.findByRole("menuitem", { name: "Unpin" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });

    /** @scenario "A pinned dashboard in the LLM Ops sidebar has the same menu as in Dashboards" */
    it("does not offer Delete on My dashboard", async () => {
      const user = userEvent.setup();
      const mine = { ...LATENCY, id: "mine", name: "My dashboard" };
      renderSection({ stars: [{ kind: "board", dashboard: mine }] });

      await user.click(
        await (await section()).findByRole("button", { name: "Actions for My dashboard" }),
      );

      expect(await screen.findByRole("menuitem", { name: "Delete" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
  });

  describe("given the member pinned more than 7 boards", () => {
    /** @scenario "Pinned dashboards in the LLM Ops sidebar stop at 7" */
    it("lists 7 and an All pinned (N) row that opens Dashboards", async () => {
      const user = userEvent.setup();
      const { host } = renderSection({ stars: starsOf(9) });

      const group = await section();
      await waitFor(() =>
        expect(group.getAllByRole("link").map((link) => link.textContent)).toEqual([
          ...[0, 1, 2, 3, 4, 5, 6].map((index) => `Board ${index}`),
          "All pinned (9)",
        ]),
      );
      await user.click(group.getByRole("link", { name: "All pinned (9)" }));
      expect(host.navigations).toEqual(["/test-project/dashboards"]);
    });

    /** @scenario "Pinned dashboards in the LLM Ops sidebar stop at 7" */
    it("adds no All pinned row at 7 or fewer", async () => {
      renderSection({ stars: starsOf(7) });

      const group = await section();
      await waitFor(() => expect(group.getAllByRole("link")).toHaveLength(7));
      expect(group.queryByText(/^All pinned/)).toBeNull();
    });
  });

  describe("when the member presses the '+' on the Dashboards title", () => {
    /** @scenario "The Dashboards section's plus button makes a dashboard pinned to this project" */
    it("opens a new board with Add a widget open, and stores nothing", async () => {
      const user = userEvent.setup();
      const { host, calls } = renderSection({ stars: [{ kind: "board", dashboard: LATENCY }] });

      await user.click((await section()).getByRole("button", { name: "New dashboard" }));

      expect(host.navigations).toEqual(["/test-project/dashboards/new?addBlock=open"]);
      expect(inputsTo(calls, "boards.create")).toEqual([]);
      expect(inputsTo(calls, "boards.star")).toEqual([]);
    });

    /** @scenario "The Dashboards section's plus button makes a dashboard pinned to this project" */
    it("stores the board on its first edit, pinned to the project, and moves to its address", async () => {
      const user = userEvent.setup();
      const { host, calls } = renderSection({
        stars: [{ kind: "board", dashboard: LATENCY }],
        route: ON_NEW_BOARD,
      });
      await user.click((await section()).getByRole("button", { name: "New dashboard" }));

      await expect(draft.edit()).resolves.toBe("board-new");

      expect(inputsTo(calls, "boards.create")).toEqual([
        { projectId: "proj-1", name: "Untitled dashboard 1", homeProduct: "llm-ops" },
      ]);
      expect(inputsTo(calls, "boards.star")).toEqual([
        { projectId: "proj-1", star: { kind: "board", dashboardId: "board-new" } },
      ]);
      expect(host.replacements).toEqual(["/test-project/dashboards/board-new"]);
    });
  });

  describe("when the member presses the '+' twice in a row", () => {
    /** @scenario "A double click leaves exactly one dashboard" */
    it("makes no board, and two edits landing at once make exactly one", async () => {
      const { calls } = renderSection({ stars: [{ kind: "board", dashboard: LATENCY }] });
      const plus = (await section()).getByRole("button", { name: "New dashboard" });

      fireEvent.click(plus);
      fireEvent.click(plus);
      expect(inputsTo(calls, "boards.create")).toHaveLength(0);

      const [first, second] = await Promise.all([draft.edit(), draft.edit()]);
      expect(second).toBe(first);
      expect(inputsTo(calls, "boards.create")).toHaveLength(1);
      expect(inputsTo(calls, "boards.star")).toHaveLength(1);
    });
  });

  describe("when the member double clicks Add dashboard", () => {
    /** @scenario "A double click leaves exactly one dashboard" */
    it("makes no board until the new one is edited", async () => {
      const user = userEvent.setup();
      const { calls } = renderSection({ stars: [] });
      const add = await (await section()).findByRole("button", { name: "Add dashboard" });

      await user.dblClick(add);

      expect(inputsTo(calls, "boards.create")).toHaveLength(0);
      await draft.edit();
      expect(inputsTo(calls, "boards.create")).toHaveLength(1);
    });
  });

  describe("when two descriptions are submitted while the board is being stored", () => {
    /** @scenario "AC162j Edits made while a new board is being stored land on it in the order made" */
    it("writes them in the order submitted, the second only after the first", async () => {
      const { calls, releaseUpdate } = renderSection({ stars: [], holdUpdates: true });
      await section();

      const stored = draft.edit();
      const first = draft.edit({ description: "Weekly costs" });
      const second = draft.edit({ description: "Per team" });
      await expect(stored).resolves.toBe("board-new");
      await waitFor(() => expect(inputsTo(calls, "boards.update")).toHaveLength(1));
      expect(inputsTo(calls, "boards.update")).toEqual([
        expect.objectContaining({ description: "Weekly costs" }),
      ]);

      releaseUpdate();
      await first;
      await waitFor(() => expect(inputsTo(calls, "boards.update")).toHaveLength(2));
      releaseUpdate();
      await second;

      expect(inputsTo(calls, "boards.update").at(-1)).toMatchObject({ description: "Per team" });
    });
  });

  describe("when the member pins a board being stored, then unpins it", () => {
    /** @scenario "AC162j Edits made while a new board is being stored land on it in the order made" */
    it("writes no pin once the board is stored", async () => {
      const { calls } = renderSection({ stars: [] });
      await section();

      const stored = draft.edit();
      const pinned = draft.edit({ pin: true });
      draft.unpin();

      await Promise.all([stored, pinned]);
      expect(inputsTo(calls, "boards.star")).toEqual([]);
    });
  });

  describe("when the pin fails after the board is stored", () => {
    /** @scenario "A failed pin leaves exactly one dashboard" */
    it("keeps the one board, opens it and tells the member", async () => {
      const user = userEvent.setup();
      const { host, calls } = renderSection({ stars: [], pinFails: true, route: ON_NEW_BOARD });
      await user.click(await (await section()).findByRole("button", { name: "Add dashboard" }));

      await expect(draft.edit()).resolves.toBe("board-new");

      expect(inputsTo(calls, "boards.create")).toHaveLength(1);
      expect(host.failures.map(({ error }) => readHandledError(error)?.code)).toEqual([
        "dashboard_not_found",
      ]);
      expect(host.replacements).toEqual(["/test-project/dashboards/board-new"]);
    });
  });

  describe("given a member who may not create dashboards", () => {
    /** @scenario "The Dashboards section's plus button makes a dashboard pinned to this project" */
    it("offers no '+' beside the pinned boards", async () => {
      renderSection({ stars: [{ kind: "board", dashboard: LATENCY }], permissions: VIEWER });

      const group = await section();
      await waitFor(() => expect(group.getAllByRole("link")).toHaveLength(1));
      expect(group.queryByRole("button", { name: "New dashboard" })).toBeNull();
    });

    /** @scenario "A member who may not create dashboards causes no dashboard list read" */
    it("reads no board list for them, only their pins", async () => {
      const { calls } = renderSection({
        stars: [{ kind: "board", dashboard: LATENCY }],
        permissions: VIEWER,
      });

      await waitFor(() => expect(inputsTo(calls, "boards.listStarred")).toHaveLength(1));
      await (await section()).findByRole("link", { name: "Latency" });
      expect(inputsTo(calls, "boards.getAll")).toEqual([]);
    });

    /** @scenario "With nothing pinned, the Dashboards section offers an Add dashboard item" */
    it("draws nothing when they pinned none", async () => {
      const { calls } = renderSection({ stars: [], permissions: VIEWER });
      await waitFor(() => expect(inputsTo(calls, "boards.listStarred")).toHaveLength(1));

      await waitFor(() => expect(screen.queryByText("Dashboards")).toBeNull());
      expect(screen.queryByText("Add dashboard")).toBeNull();
    });
  });

  describe("given the member pinned nothing", () => {
    /** @scenario "With nothing pinned, the Dashboards section offers an Add dashboard item" */
    it("offers Add dashboard first, which does what the '+' does", async () => {
      const user = userEvent.setup();
      const { host, calls } = renderSection({ stars: [] });

      const group = await section();
      const add = await group.findByRole("button", { name: "Add dashboard" });
      expect(group.getAllByRole("listitem")[0]).toContainElement(add);
      await user.click(add);

      expect(host.navigations).toEqual(["/test-project/dashboards/new?addBlock=open"]);
      expect(inputsTo(calls, "boards.create")).toEqual([]);
    });

    /** @scenario "With nothing pinned, the Dashboards section offers an Add dashboard item" */
    it("offers no Add dashboard item once a board is pinned", async () => {
      renderSection({ stars: [{ kind: "board", dashboard: LATENCY }] });

      const group = await section();
      await waitFor(() => expect(group.getAllByRole("link")).toHaveLength(1));
      expect(group.queryByRole("button", { name: "Add dashboard" })).toBeNull();
    });
  });

  describe("given the pins cannot be read", () => {
    /** @scenario "With the pinned list unreadable, the Dashboards section keeps its title and plus and lists nothing" */
    it("keeps the title and the '+', and lists nothing", async () => {
      const { calls } = renderSection({ stars: [], fails: true });
      await waitFor(() => expect(inputsTo(calls, "boards.listStarred").length).toBeGreaterThan(0));

      const group = await section();
      expect(group.getByRole("button", { name: "New dashboard" })).toBeInTheDocument();
      expect(group.queryByRole("link")).toBeNull();
      expect(group.queryByRole("button", { name: "Add dashboard" })).toBeNull();
    });
  });
});

describe("the Dashboards section handed a project, in Gateway or Coding agents", () => {
  const SHOP = { id: "proj-shop", slug: "shop", name: "Shop" };
  /** A member who may make and change boards in Shop. */
  const SHOP_MEMBER = { "proj-shop": ANALYTICS_MEMBER_PERMISSIONS };

  describe("given the member pinned a board in that project", () => {
    /** @scenario "Gateway and Coding agents show the Dashboards section of the project LLM Ops opens" */
    it('titles it "Dashboards" with no project name and lists that project\'s pins', async () => {
      const user = userEvent.setup();
      const { host, calls } = renderSection({
        stars: [{ kind: "board", dashboard: { ...LATENCY, projectId: "proj-shop" } }],
        project: SHOP,
      });

      const group = within(await screen.findByRole("region", { name: "Dashboards" }));
      expect(group.getByText("Dashboards")).toBeInTheDocument();
      expect(group.queryByText(/Shop/)).not.toBeInTheDocument();
      await waitFor(() => expect(inputsTo(calls, "boards.listStarred")).toHaveLength(1));
      expect(inputsTo(calls, "boards.listStarred")).toEqual([{ projectId: "proj-shop" }]);
      await user.click(await group.findByRole("link", { name: "Latency" }));
      expect(host.navigations).toEqual(["/shop/dashboards/board-1"]);
    });
  });

  describe("when the member presses the '+' on its title", () => {
    /** @scenario "The plus button in Gateway or Coding agents makes the dashboard in the named project" */
    it("opens a new board in that project with Add a widget, storing nothing yet", async () => {
      const user = userEvent.setup();
      const { host, calls } = renderSection({
        stars: [],
        project: SHOP,
        projectPermissions: SHOP_MEMBER,
      });

      const group = within(await screen.findByRole("region", { name: "Dashboards" }));
      await user.click(group.getByRole("button", { name: "New dashboard" }));

      expect(host.navigations).toEqual(["/shop/dashboards/new?addBlock=open"]);
      expect(inputsTo(calls, "boards.create")).toEqual([]);
    });
  });

  describe("given the member may only view dashboards in that project", () => {
    /** @scenario "In Gateway or Coding agents, what I may do follows the named project's grants" */
    it("offers no '+' and only Unpin, whatever the page's own project grants", async () => {
      const user = userEvent.setup();
      // The page's project grants everything; Shop grants viewing only.
      renderSection({
        stars: [{ kind: "board", dashboard: { ...LATENCY, projectId: "proj-shop" } }],
        project: SHOP,
        projectPermissions: { "proj-shop": VIEWER },
      });

      const group = within(await screen.findByRole("region", { name: "Dashboards" }));
      await user.click(await group.findByRole("button", { name: "Actions for Latency" }));

      expect(await screen.findByRole("menuitem", { name: "Unpin" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
      expect(group.queryByRole("button", { name: "New dashboard" })).toBeNull();
    });

    /** @scenario "In Gateway or Coding agents, what I may do follows the named project's grants" */
    it("draws nothing when they pinned none there", async () => {
      const { calls } = renderSection({
        stars: [],
        project: SHOP,
        projectPermissions: { "proj-shop": VIEWER },
      });
      await waitFor(() => expect(inputsTo(calls, "boards.listStarred")).toHaveLength(1));

      await waitFor(() => expect(screen.queryByText(/^Dashboards/)).toBeNull());
      expect(screen.queryByText("Add dashboard")).toBeNull();
    });
  });

  describe("when the member opens a new board, then unpins one", () => {
    /** @scenario "Telemetry: a board made or unpinned from Gateway or Coding agents names its project" */
    it("sends the unpin with that project registered, then puts the page's back", async () => {
      const user = userEvent.setup();
      const tracked = new RegisteringUiAnalytics();
      const { host } = renderSection({
        stars: [{ kind: "board", dashboard: { ...LATENCY, projectId: "proj-shop" } }],
        project: SHOP,
        projectPermissions: SHOP_MEMBER,
        tracked,
      });

      const group = within(await screen.findByRole("region", { name: "Dashboards" }));
      await user.click(group.getByRole("button", { name: "New dashboard" }));
      await waitFor(() => expect(host.navigations).toHaveLength(1));
      await user.click(await group.findByRole("button", { name: "Actions for Latency" }));
      await user.click(await screen.findByRole("menuitem", { name: "Unpin" }));

      await waitFor(() =>
        // A new board is created, and that sent, from its own page once its first edit lands.
        expect(tracked.sent).toEqual([
          { action: "favourited", attributes: { starred: false }, projectId: "proj-shop" },
        ]),
      );
      expect(tracked.registered).toEqual({ projectId: "proj-1" });
    });
  });

  describe("given no project is handed over, as in LLM Ops", () => {
    /** @scenario "The LLM Ops sidebar's Dashboards section names no project" */
    it("titles itself Dashboards alone and works in the project in scope", async () => {
      const { calls } = renderSection({ stars: [] });

      const group = await section();
      expect(group.getByText("Dashboards")).toBeInTheDocument();
      expect(group.queryByText(/Dashboards ·/)).toBeNull();
      await waitFor(() =>
        expect(inputsTo(calls, "boards.listStarred")).toEqual([{ projectId: "proj-1" }]),
      );
    });
  });
});
