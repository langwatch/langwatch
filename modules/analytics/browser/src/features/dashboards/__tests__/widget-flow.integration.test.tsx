/**
 * @vitest-environment jsdom
 * The widget flow on a board, against an in-memory dashboards and widgets server: the editor
 * with Langy beside it and its API / MCP tab, Skip to a new widget, the widget menu and its
 * copies, Undo after every change, and where each widget says it came from.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useReducer } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { AnalyticsRouteReading } from "../../../model/analytics-host.ts";
import { StubAnalyticsHost, type StubAnalyticsHostOptions } from "../../../testing.tsx";
import { PICKER_QUESTIONS, pickerWidgets } from "../catalogue/index.ts";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

type Input = Record<string, unknown>;
type Widget = {
  id: string;
  dashboardId: string | null;
  name: string;
  graph: Input & { version: 1; code: string; queries: { name: string; sql: string }[] };
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
};

const BOARD = {
  id: "board-1",
  name: "Weekly review",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};
const CODE = "export default function Widget() { return null; }";
const SOURCE = { kind: "catalogue", catalogueId: "traffic" };

const traces = (): Widget => ({
  id: "w-1",
  dashboardId: BOARD.id,
  name: "Traces",
  graph: { version: 1, code: CODE, queries: [{ name: "main", sql: "SELECT 1" }], source: SOURCE },
  gridColumn: 0,
  gridRow: 0,
  colSpan: 4,
  rowSpan: 3,
});

/** One board and its widgets, answered from memory across reloads; every call is kept. */
function inMemoryServer() {
  const state = { widgets: [traces()], calls: [] as UiProcedureCall[] };
  let minted = 0;
  const find = (id: unknown) => state.widgets.find((widget) => widget.id === id)!;
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    const input = (call.input ?? {}) as Input;
    switch (call.path) {
      case "dashboards.getAll":
        return Promise.resolve([{ ...BOARD }]);
      case "dashboards.listStarred":
        return Promise.resolve([]);
      case "dashboardWidgets.list":
        return Promise.resolve(
          state.widgets.map((widget) => JSON.parse(JSON.stringify(widget)) as Widget),
        );
      case "dashboardWidgets.create": {
        minted += 1;
        const { projectId: _project, dashboardId, name, ...definition } = input;
        const widget: Widget = {
          id: `w-new-${minted}`,
          dashboardId: dashboardId as string,
          name: String(name),
          graph: { version: 1, ...definition } as Widget["graph"],
          gridColumn: 0,
          gridRow: 0,
          colSpan: 4,
          rowSpan: 3,
        };
        state.widgets.push(widget);
        return Promise.resolve({ ...widget, definition: widget.graph });
      }
      case "dashboardWidgets.update": {
        const edited = find(input.id);
        edited.name = String(input.name);
        edited.graph = { ...edited.graph, code: String(input.code) };
        return Promise.resolve({ success: true });
      }
      case "dashboardWidgets.updateLayout": {
        const { graphId, gridColumn, gridRow, colSpan, rowSpan } = input as Input & Widget;
        Object.assign(find(graphId), { gridColumn, gridRow, colSpan, rowSpan });
        return Promise.resolve({ success: true });
      }
      case "dashboardWidgets.batchUpdateLayouts": {
        for (const { graphId, ...placement } of input.layouts as (Input & { graphId: string })[]) {
          Object.assign(find(graphId), placement);
        }
        return Promise.resolve({ success: true });
      }
      case "dashboardWidgets.delete":
        state.widgets = state.widgets.filter((widget) => widget.id !== input.id);
        return Promise.resolve({ success: true });
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

type Server = ReturnType<typeof inMemoryServer>;

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = ["analytics:view", "cost:view", "traces:view"];
const LANGY_MEMBER = [...MEMBER, "langy:create"];

/** The host double, with an address that follows each query write as the router's does. */
class AddressedHost extends StubAnalyticsHost {
  readonly listeners = new Set<() => void>();
  private query: Readonly<Record<string, string | undefined>>;

  constructor(options: StubAnalyticsHostOptions) {
    super(options);
    this.query = options.route?.query ?? {};
  }

  override route(): AnalyticsRouteReading {
    return { params: super.route().params, query: this.query };
  }

  override setQuery(next: Readonly<Record<string, string | undefined>>): void {
    super.setQuery(next);
    this.query = next;
    for (const listener of this.listeners) listener();
  }
}

/** Renders the board again whenever its address changes. */
function AddressedBoard({ host }: { host: AddressedHost }) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    host.listeners.add(rerender);
    return () => void host.listeners.delete(rerender);
  }, [host]);
  return <DashboardBoardScreen />;
}

function openBoard({
  server,
  query = {},
  permissions = LANGY_MEMBER,
}: {
  server: Server;
  query?: Record<string, string>;
  permissions?: string[];
}) {
  const host = new AddressedHost({
    flags: LANGY_ON,
    permissions,
    route: { params: { dashboardId: BOARD.id }, query },
  });
  renderDashboards({
    element: (
      <>
        <AddressedBoard host={host} />
        <Toaster />
      </>
    ),
    host,
    answer: server.answer,
  });
  return host;
}

const callsTo = (server: Server, path: string) =>
  server.state.calls.filter((call) => call.path === path);

const chooseFromMenu = async (name: string) => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));
  await user.click(await screen.findByRole("menuitem", { name }));
  return user;
};

/** The editor drawer: the dialog with the API / MCP tab, beside any other open dialog. */
const editor = async () => {
  await screen.findByRole("tab", { name: "API / MCP" });
  return within(
    screen
      .getAllByRole("dialog")
      .find((dialog) => within(dialog).queryByRole("tab", { name: "API / MCP" }))!,
  );
};

afterEach(() => {
  cleanup();
  toaster.remove();
});

describe("the widget editor", () => {
  describe("when the member picks Edit code", () => {
    /** @scenario "Widget editor: Edit code opens the editor with Langy beside it" */
    it("opens the editor on that widget, with Langy beside it and nothing drafted", async () => {
      const host = openBoard({ server: inMemoryServer() });

      const user = await chooseFromMenu("Edit code");
      const drawer = await editor();

      expect(drawer.getByRole("button", { name: "Rename Traces" })).toBeInTheDocument();
      expect(host.langyAsks).toHaveLength(1);
      expect(host.langyAsks[0]?.draft).toBeUndefined();
      expect(host.langyAsks[0]?.context[0]).toMatchObject({ kind: "dashboard", label: "Traces" });
      expect(host.langyScreens.at(-1)).toEqual({ ref: BOARD.id, itemRef: "w-1" });

      await user.click(drawer.getByTestId("analytics-widget-cancel"));
      await waitFor(() => expect(host.langyScreens.at(-1)).toEqual({ ref: BOARD.id }));
    });
  });

  describe("when the member picks Edit with Langy", () => {
    /** @scenario "Widget editor: Edit with Langy drafts the edit about that widget" */
    it("opens the editor and drafts the edit about that board and widget", async () => {
      const host = openBoard({ server: inMemoryServer() });

      await chooseFromMenu("Edit with Langy");
      await editor();

      const [request] = host.langyAsks;
      expect(request?.question).toBeUndefined();
      expect(request?.draft?.startsWith('Edit "Traces" with me.')).toBe(true);
      expect(request?.about).toEqual({ ref: BOARD.id, itemRef: "w-1" });
      expect(host.langyScreens.at(-1)).toEqual({ ref: BOARD.id, itemRef: "w-1" });
    });
  });

  describe("given the editor is open with Langy", () => {
    /** @scenario "Widget editor: Langy's suggestions fit the widget's shape" */
    it("suggests what fits the widget and drafts a picked one about it", async () => {
      const host = openBoard({ server: inMemoryServer() });

      const user = await chooseFromMenu("Edit code");
      const asks = within((await editor()).getByRole("group", { name: "Ask Langy" }));
      await user.click(asks.getByRole("button", { name: "Compare with last period" }));

      const request = host.langyAsks.at(-1);
      expect(request?.draft?.startsWith('For "Traces": Compare with last period.')).toBe(true);
      expect(request?.about).toEqual({ ref: BOARD.id, itemRef: "w-1" });
    });

    /** @scenario "Widget editor: the tabs are Code, Queries and API / MCP" */
    it("has Code, Queries and API / MCP, which shows the id, the REST call and the MCP call", async () => {
      openBoard({ server: inMemoryServer() });

      const user = await chooseFromMenu("Edit code");
      const drawer = await editor();
      expect(drawer.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual([
        "Code",
        "Queries (1)",
        "API / MCP",
      ]);
      await user.click(drawer.getByRole("tab", { name: "API / MCP" }));

      const panel = drawer.getByRole("tabpanel");
      expect(panel).toHaveTextContent("w-1");
      expect(panel).toHaveTextContent("/api/v1/projects/proj-1/analytics/dashboard-widgets/w-1");
      expect(panel).toHaveTextContent("MCP tool: update_dashboard_widget");
    });
  });

  describe("given Langy is not available", () => {
    /** @scenario "Widget editor: Langy's suggestions fit the widget's shape" */
    it("shows no suggestions and asks Langy nothing", async () => {
      const host = openBoard({ server: inMemoryServer(), permissions: MEMBER });

      await chooseFromMenu("Edit code");
      const drawer = await editor();

      expect(drawer.queryByRole("group", { name: "Ask Langy" })).toBeNull();
      expect(host.langyAsks).toHaveLength(0);
    });
  });
});

describe("Skip in Add a widget", () => {
  /**
   * @scenario "Add a widget: Skip opens the editor on a new widget"
   * @scenario "Widget source: every widget made on a board records where it came from"
   */
  it("opens the editor on a new widget, which saves half wide at the bottom, made in code", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = inMemoryServer();
    const host = openBoard({ server, query: { addBlock: "open" } });

    await user.click(await screen.findByRole("button", { name: "Skip" }));
    const drawer = await editor();

    expect(host.lastQuery).toEqual({ addBlock: void 0, editWidget: "new" });
    expect(screen.queryByRole("heading", { name: "Add a widget" })).toBeNull();
    expect(drawer.getByRole("button", { name: "Rename New widget" })).toBeInTheDocument();
    expect(host.langyScreens.at(-1)).toEqual({ ref: BOARD.id, itemRef: "new" });
    await user.click(drawer.getByRole("tab", { name: "API / MCP" }));
    expect(drawer.getByRole("tabpanel")).toHaveTextContent("Save the widget first.");

    await user.click(drawer.getByTestId("analytics-widget-save"));

    await waitFor(() => expect(callsTo(server, "dashboardWidgets.updateLayout")).toHaveLength(1));
    expect(callsTo(server, "dashboardWidgets.create")[0]?.input).toMatchObject({
      dashboardId: BOARD.id,
      name: "New widget",
      source: { kind: "code" },
    });
    expect(callsTo(server, "dashboardWidgets.updateLayout")[0]?.input).toMatchObject({
      gridColumn: 0,
      gridRow: 3,
      colSpan: 4,
      rowSpan: 5,
    });
    expect(await screen.findByText("Widget added")).toBeInTheDocument();
  });
});

describe("the widget menu", () => {
  describe("given Langy is available", () => {
    /** @scenario "Widget menu: the actions follow the prototype's order" */
    it("offers every action in the prototype's order", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      openBoard({ server: inMemoryServer() });

      await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));

      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent?.trim())).toEqual([
        "Edit with Langy",
        "Edit code",
        "Copy widget id",
        "Copy API snippet",
        "Set an alert",
        "Send as a report",
        "Duplicate",
        "Delete",
      ]);
    });
  });

  describe("when the member copies the widget id, then the API snippet", () => {
    /** @scenario "Widget menu: Copy widget id and Copy API snippet copy what an agent needs" */
    it("puts each on the clipboard and says so", async () => {
      const host = openBoard({ server: inMemoryServer() });

      await chooseFromMenu("Copy widget id");
      await waitFor(() => expect(host.successes).toEqual([{ title: "Widget id copied" }]));
      expect(await navigator.clipboard.readText()).toBe("w-1");

      await chooseFromMenu("Copy API snippet");
      await waitFor(() => expect(host.successes.at(-1)).toEqual({ title: "API snippet copied" }));
      expect(await navigator.clipboard.readText()).toContain(
        "/api/v1/projects/proj-1/analytics/dashboard-widgets/w-1",
      );
    });
  });
});

describe("Undo", () => {
  describe("when the member deletes a widget and presses Undo", () => {
    /**
     * @scenario "Undo: every widget change ends in a toast with Undo"
     * @scenario "Undo: Undo puts the board back as it was, on the server"
     */
    it("makes the widget again at its old place, with its code and source", async () => {
      const server = inMemoryServer();
      openBoard({ server });

      const user = await chooseFromMenu("Delete");
      expect(await screen.findByText("Widget deleted")).toBeInTheDocument();
      expect(server.state.widgets).toHaveLength(0);
      await user.click(screen.getByRole("button", { name: "Undo" }));

      await waitFor(() =>
        expect(callsTo(server, "dashboardWidgets.batchUpdateLayouts")).toHaveLength(1),
      );
      expect(server.state.widgets).toEqual([
        expect.objectContaining({
          name: "Traces",
          graph: expect.objectContaining({ code: CODE, source: SOURCE }),
          gridColumn: 0,
          gridRow: 0,
          colSpan: 4,
          rowSpan: 3,
        }),
      ]);
    });
  });

  describe("when the member renames a widget in the editor and presses Undo", () => {
    /**
     * @scenario "Undo: every widget change ends in a toast with Undo"
     * @scenario "Undo: Undo puts the board back as it was, on the server"
     */
    it("writes the old name back", async () => {
      const server = inMemoryServer();
      openBoard({ server });

      const user = await chooseFromMenu("Edit code");
      const drawer = await editor();
      await user.click(drawer.getByRole("button", { name: "Rename Traces" }));
      const field = drawer.getByDisplayValue("Traces");
      await user.clear(field);
      await user.type(field, "Traffic{Enter}");
      await user.click(drawer.getByTestId("analytics-widget-save"));

      expect(await screen.findByText("Widget saved")).toBeInTheDocument();
      expect(server.state.widgets[0]?.name).toBe("Traffic");
      await user.click(screen.getByRole("button", { name: "Undo" }));

      await waitFor(() => expect(server.state.widgets[0]?.name).toBe("Traces"));
      expect(callsTo(server, "dashboardWidgets.update")).toHaveLength(2);
    });
  });

  describe("when the member duplicates a widget and presses Undo", () => {
    /**
     * @scenario "Undo: Undo puts the board back as it was, on the server"
     * @scenario "Widget source: every widget made on a board records where it came from"
     */
    it("records the copy with the original's source, then removes the copy", async () => {
      const server = inMemoryServer();
      openBoard({ server });

      const user = await chooseFromMenu("Duplicate");
      expect(await screen.findByText("Widget duplicated")).toBeInTheDocument();
      expect(callsTo(server, "dashboardWidgets.create")[0]?.input).toMatchObject({
        source: SOURCE,
      });
      await user.click(screen.getByRole("button", { name: "Undo" }));

      await waitFor(() => expect(server.state.widgets.map(({ id }) => id)).toEqual(["w-1"]));
    });
  });

  describe("when a change fails", () => {
    /** @scenario "Undo: every widget change ends in a toast with Undo" */
    it("offers no Undo", async () => {
      const server = inMemoryServer();
      const failing = {
        ...server,
        answer: (call: UiProcedureCall) =>
          call.path === "dashboardWidgets.delete"
            ? Promise.reject(new Error("refused"))
            : server.answer(call),
      };
      const host = openBoard({ server: failing });

      await chooseFromMenu("Delete");

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });
  });
});

describe("Add a widget", () => {
  /** @scenario "Widget source: every widget made on a board records where it came from" */
  it("records a picked widget as from the catalogue, with its catalogue widget id", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = inMemoryServer();
    openBoard({ server, query: { addBlock: "open" } });
    const question = PICKER_QUESTIONS.find(({ id }) => id === "traffic")!;
    const escaped = question.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    await user.click(await screen.findByRole("button", { name: new RegExp(escaped) }));

    await waitFor(() => expect(callsTo(server, "dashboardWidgets.create")).toHaveLength(1));
    expect(callsTo(server, "dashboardWidgets.create")[0]?.input).toMatchObject({
      source: { kind: "catalogue", catalogueId: pickerWidgets(question.id)[0]!.key },
    });
    expect(await screen.findByText("Widget added")).toBeInTheDocument();
  });
});
