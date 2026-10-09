/**
 * @vitest-environment jsdom
 * The widget flow on a board, against an in-memory widgets server: the editor with Langy
 * beside it, its API / MCP tab, "I'll build it myself", the widget menu, Undo after every
 * change, and where each widget says it came from.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { LANGY_DOCK_WIDTH_PX } from "@langwatch/langy-contract";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useReducer } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { AnalyticsRouteReading } from "../../../model/analytics-host.ts";
import {
  ANALYTICS_MEMBER_PERMISSIONS,
  StubAnalyticsHost,
  type StubAnalyticsHostOptions,
} from "../../../testing.tsx";
import { PICKER_QUESTIONS, pickerWidgets } from "../catalogue/index.ts";
import { WIDGET_AGENT_DOCS_URL, widgetCreatePrompt } from "../model/widget-api.ts";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

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
  ...HOME_BOARD,
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

/**
 * One board and its widgets, answered from memory across reloads; every call is kept. A path
 * in `held` waits for its gate to open; a path in `refused` fails, as a server refusing would.
 */
function inMemoryServer() {
  const state = {
    widgets: [traces()],
    calls: [] as UiProcedureCall[],
    held: new Map<string, Promise<void>>(),
    refused: new Set<string>(),
  };
  let minted = 0;
  const find = (id: unknown) => state.widgets.find((widget) => widget.id === id)!;
  const answer = async (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    await state.held.get(call.path);
    if (state.refused.has(call.path)) throw new Error(`refused ${call.path}`);
    return respond(call);
  };
  const respond = (call: UiProcedureCall): Promise<unknown> => {
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
const MEMBER = [...ANALYTICS_MEMBER_PERMISSIONS];
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

/**
 * The Undo buttons on toasts still offered. A dismissed toast leaves on an exit animation
 * jsdom never ends, so its own state is what says it was taken back.
 */
const offeredUndos = () =>
  screen
    .queryAllByRole("button", { name: "Undo" })
    .filter(
      (button) => button.closest('[data-part="root"]')?.getAttribute("data-state") !== "closed",
    );

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
    /** @scenario "Widget editor: Edit with Langy sends Langy its starting prompt about that widget" */
    it("opens the editor and sends Langy the edit, with that widget attached", async () => {
      const host = openBoard({ server: inMemoryServer() });

      await chooseFromMenu("Edit with Langy");
      await editor();

      const [request] = host.langyAsks;
      expect(request?.draft).toBeUndefined();
      expect(
        request?.question?.startsWith('Edit my "Traces" widget on my "Weekly review" dashboard'),
      ).toBe(true);
      expect(request?.question).toContain("Ask me what I want the widget to show");
      expect(request?.context[0]?.ref).toContain('widget "Traces" (id w-1)');
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

  describe("given Langy is docked beside the board", () => {
    /** @scenario "Widget editor: the editor and Langy sit side by side" */
    it("opens the editor from the left and stops it short of Langy's dock", async () => {
      openBoard({ server: inMemoryServer() });

      await chooseFromMenu("Edit code");
      await editor();
      const drawer = screen
        .getAllByRole("dialog")
        .find((dialog) => within(dialog).queryByRole("tab", { name: "API / MCP" }))!;

      // jsdom resolves the drawer's `calc(100vw - dock)` against its own viewport width.
      expect(getComputedStyle(drawer).maxWidth).toBe(
        `${window.innerWidth - (LANGY_DOCK_WIDTH_PX + 24)}px`,
      );
    });

    /** @scenario "Widget editor: the editor and Langy sit side by side" */
    it("keeps the full drawer width when there is no Langy to sit beside", async () => {
      openBoard({ server: inMemoryServer(), permissions: MEMBER });

      await chooseFromMenu("Edit code");
      await editor();
      const drawer = screen
        .getAllByRole("dialog")
        .find((dialog) => within(dialog).queryByRole("tab", { name: "API / MCP" }))!;

      expect(getComputedStyle(drawer).maxWidth).not.toContain("100vw");
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

describe("I'll build it myself in Add a widget", () => {
  /**
   * @scenario "Add a widget: I'll build it myself opens the editor on a new widget"
   * @scenario "Widget editor: API / MCP on a new widget shows how my agent creates it"
   * @scenario "Widget editor: building a new widget with Langy sends Langy a starting prompt"
   * @scenario "Widget source: every widget made on a board records where it came from"
   */
  it("opens the editor on a new widget, which saves half wide at the bottom, made in code", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = inMemoryServer();
    const host = openBoard({ server, query: { addBlock: "open" } });

    await user.click(await screen.findByRole("button", { name: "I'll build it myself" }));
    const drawer = await editor();

    expect(host.lastQuery).toEqual({ addBlock: void 0, editWidget: "new" });
    expect(screen.queryByRole("heading", { name: "Add a widget" })).toBeNull();
    expect(drawer.getByRole("button", { name: "Rename New widget" })).toBeInTheDocument();
    expect(host.langyScreens.at(-1)).toEqual({ ref: BOARD.id, itemRef: "new" });
    expect(host.langyAsks).toHaveLength(1);
    expect(host.langyAsks[0]?.draft).toBeUndefined();
    expect(host.langyAsks[0]?.question).toContain(
      'I am building a new widget on my "Weekly review" dashboard, which already shows: Traces.',
    );
    expect(host.langyAsks[0]?.question).toContain("Ask me what I want this widget to show");
    expect(host.langyAsks[0]?.context[0]?.ref).toContain('new widget "New widget", not saved yet');
    await user.click(drawer.getByRole("tab", { name: "API / MCP" }));
    const panel = drawer.getByRole("tabpanel");
    expect(panel).toHaveTextContent(widgetCreatePrompt({ dashboardId: BOARD.id }));
    expect(panel).not.toHaveTextContent("Save the widget first");
    expect(within(panel).getByRole("link", { name: "Read the docs" })).toHaveAttribute(
      "href",
      WIDGET_AGENT_DOCS_URL,
    );

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

describe("Picking a widget in Add a widget", () => {
  const traffic = PICKER_QUESTIONS.find(({ id }) => id === "traffic")!;
  const pick = async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(
      await screen.findByRole("button", {
        name: (accessible) => accessible.startsWith(traffic.question),
      }),
    );
  };

  /** @scenario "Add a widget: a picked widget shows on the board at once" */
  it("closes the picker and shows the widget before the server has stored it", async () => {
    const server = inMemoryServer();
    let land: () => void = () => void 0;
    server.state.held.set("dashboardWidgets.create", new Promise((open) => (land = open)));
    const host = openBoard({ server, query: { addBlock: "open" } });

    await pick();

    expect(host.lastQuery).toEqual({ addBlock: void 0 });
    expect(await screen.findAllByText(pickerWidgets(traffic.id)[0]!.name)).not.toHaveLength(0);
    expect(server.state.widgets).toHaveLength(1);
    expect(host.langyAsks).toEqual([]);
    land();

    expect(await screen.findByText("Widget added")).toBeInTheDocument();
    expect(server.state.widgets).toHaveLength(2);
    await waitFor(() => expect(host.langyAsks).toHaveLength(1));
  });

  /** @scenario "Add a widget: a picked widget shows on the board at once" */
  it("takes the widget off again and seeds nothing when the server refuses it", async () => {
    const server = inMemoryServer();
    server.state.refused.add("dashboardWidgets.create");
    const host = openBoard({ server, query: { addBlock: "open" } });

    await pick();

    await waitFor(() =>
      expect(host.failures).toEqual([
        expect.objectContaining({ fallbackTitle: "Couldn't add the widget" }),
      ]),
    );
    await waitFor(() =>
      expect(screen.queryAllByText(pickerWidgets(traffic.id)[0]!.name)).toHaveLength(0),
    );
    expect(host.langyAsks).toEqual([]);
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
      await waitFor(() => expect(server.state.widgets).toHaveLength(0));
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

  describe("when the member deletes a widget while the server is still answering", () => {
    /** @scenario "Delete: a widget leaves the board at once, with Undo" */
    it("hides it and offers Undo before the delete lands, then Undo waits and restores it", async () => {
      const server = inMemoryServer();
      let land: () => void = () => void 0;
      server.state.held.set("dashboardWidgets.delete", new Promise((open) => (land = open)));
      openBoard({ server });

      const user = await chooseFromMenu("Delete");

      expect(await screen.findByText("Widget deleted")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Actions for Traces" })).toBeNull();
      expect(server.state.widgets).toHaveLength(1);
      await user.click(screen.getByRole("button", { name: "Undo" }));
      land();

      await waitFor(() =>
        expect(callsTo(server, "dashboardWidgets.batchUpdateLayouts")).toHaveLength(1),
      );
      expect(server.state.widgets).toEqual([expect.objectContaining({ name: "Traces" })]);
    });
  });

  describe("when the server refuses a delete", () => {
    /** @scenario "Delete: a refused delete puts the widget back and says so" */
    it("brings the widget back, withdraws the Undo and reports the failure", async () => {
      const server = inMemoryServer();
      server.state.refused.add("dashboardWidgets.delete");
      const host = openBoard({ server });

      await chooseFromMenu("Delete");

      await waitFor(() =>
        expect(host.failures).toEqual([
          expect.objectContaining({ fallbackTitle: "Couldn't delete the widget" }),
        ]),
      );
      expect(await screen.findByRole("button", { name: "Actions for Traces" })).toBeInTheDocument();
      await waitFor(() => expect(offeredUndos()).toEqual([]));
      expect(server.state.widgets).toHaveLength(1);
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
      await waitFor(() => expect(offeredUndos()).toEqual([]));
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
