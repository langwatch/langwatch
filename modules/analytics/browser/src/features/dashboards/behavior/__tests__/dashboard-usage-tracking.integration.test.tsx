/**
 * @vitest-environment jsdom
 * Each board and widget change sends its product event once the server agrees, and a change it
 * refuses sends none. The board is opened against an in-memory server.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import type * as BrowserHostAnalytics from "@langwatch/browser-host/analytics";
import type { UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tracked = vi.hoisted(() => ({ events: [] as UiAnalyticsEvent[] }));

vi.mock("@langwatch/browser-host/analytics", async (importActual) => {
  const actual = await importActual<typeof BrowserHostAnalytics>();
  const recorder = {
    track: (event: UiAnalyticsEvent) => tracked.events.push(event),
    register: () => void 0,
    unregister: () => void 0,
    identify: () => void 0,
    group: () => void 0,
    reset: () => void 0,
  };
  return { ...actual, useUiAnalytics: () => recorder };
});

import { StubAnalyticsHost } from "../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import { useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import type { BoardTemplate } from "../../templates/index.ts";
import { useBoardFromTemplate } from "../use-board-from-template.ts";
import { useBoardWidgets } from "../use-board-widgets.ts";
import { useDashboardViewed } from "../use-dashboard-viewed.ts";
import { useFavourites } from "../use-favourites.ts";
import { useSavedDashboards } from "../use-saved-dashboards.ts";

const DASHBOARD_ID = "board-1";
const CODE = "export default function Widget() { return null; }";

const storedWidget = (sources: readonly string[] | null) => ({
  id: "widget-1",
  dashboardId: DASHBOARD_ID,
  name: "Cost",
  graph: { version: 1, code: CODE, queries: [{ name: "main", sql: "SELECT 1", sources }] },
  gridColumn: 0,
  gridRow: 0,
  colSpan: 4,
  rowSpan: 3,
});

/** Boards, widgets and stars from memory; `refuse` turns every write away. */
function inMemoryServer({ refuse = false }: { refuse?: boolean } = {}) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    const isWrite = !["boards.getAll", "boards.listStarred", "dashboardWidgets.list"].includes(
      call.path,
    );
    if (refuse && isWrite) return Promise.reject(new UiProcedureRefusal("forbidden", 403));
    switch (call.path) {
      case "boards.getAll":
      case "boards.listStarred":
        return Promise.resolve([]);
      case "dashboardWidgets.list":
        return Promise.resolve([storedWidget(["application"])]);
      case "boards.create":
        return Promise.resolve({ id: "board-2", name: "Untitled dashboard" });
      case "dashboardWidgets.create":
        return Promise.resolve({ id: `widget-${calls.length}` });
      case "boards.update":
      case "boards.delete":
      case "boards.star":
      case "boards.unstar":
      case "dashboardWidgets.update":
      case "dashboardWidgets.delete":
      case "dashboardWidgets.updateLayout":
      case "dashboardWidgets.batchUpdateLayouts":
        return Promise.resolve({ success: true });
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { calls, answer };
}

/** Mounts one hook on the board and hands back its latest answer. */
function mount<T>(hook: () => T, { refuse = false }: { refuse?: boolean } = {}) {
  const latest: { current: T | undefined } = { current: void 0 };
  function Probe() {
    latest.current = hook();
    return null;
  }
  const host = new StubAnalyticsHost({
    flags: { release_dashboards: true, release_langy_enabled: true },
  });
  renderDashboards({ element: <Probe />, host, answer: inMemoryServer({ refuse }).answer });
  return { latest: () => latest.current!, host };
}

const names = () =>
  tracked.events.map((event) => [event.boundary, event.action, event.name].join("."));

beforeEach(() => {
  tracked.events.length = 0;
});
afterEach(cleanup);

describe("given a member making and deleting boards", () => {
  /** @scenario "Telemetry: making a board sends dashboards.created.dashboard with where it came from" */
  it("sends a blank board's creation once the server made it", async () => {
    const { latest, host } = mount(useSavedDashboards);

    act(() => latest().createBoard());

    await waitFor(() => expect(host.navigations).toHaveLength(1));
    expect(tracked.events).toEqual([
      {
        boundary: "dashboards",
        name: "dashboard",
        action: "created",
        attributes: { createdFrom: "blank" },
      },
    ]);
  });

  /** @scenario "Telemetry: making a board sends dashboards.created.dashboard with where it came from" */
  it("sends a template's board with its template once every widget has landed", async () => {
    const template: BoardTemplate = {
      id: "agent-flight-deck",
      name: "Small deck",
      description: "One widget.",
      widgets: [
        {
          key: "left",
          name: "Left",
          definition: { version: 1, code: CODE, queries: [{ name: "main", sql: "SELECT 1" }] },
          layout: { gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 3 },
        },
      ],
    };
    const { latest, host } = mount(useBoardFromTemplate);

    await act(() => latest().createFromTemplate({ template, existingNames: [] }));

    expect(host.failures).toEqual([]);
    expect(tracked.events.map(({ attributes }) => attributes)).toEqual([
      { createdFrom: "template", templateId: "agent-flight-deck" },
    ]);
  });

  /** @scenario "Telemetry: making a board sends dashboards.created.dashboard with where it came from" */
  it("sends nothing for a template's board the server refuses", async () => {
    const template = { id: "agent-flight-deck", name: "Deck", description: "", widgets: [] };
    const { latest, host } = mount(useBoardFromTemplate, { refuse: true });

    await act(() =>
      latest().createFromTemplate({ template: template as BoardTemplate, existingNames: [] }),
    );

    expect(host.failures).toHaveLength(1);
    expect(tracked.events).toEqual([]);
  });

  /** @scenario "Telemetry: deleting a board sends dashboards.deleted.dashboard" */
  it("sends a deletion once the server agrees, and none when it refuses", async () => {
    const agreed = mount(useSavedDashboards);
    const onDeleted = vi.fn();
    act(() => agreed.latest().deleteBoard({ dashboardId: DASHBOARD_ID, onDeleted }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(names()).toEqual(["dashboards.deleted.dashboard"]);

    cleanup();
    tracked.events.length = 0;
    const refused = mount(useSavedDashboards, { refuse: true });
    act(() => refused.latest().deleteBoard({ dashboardId: DASHBOARD_ID, onDeleted }));
    await waitFor(() => expect(refused.host.failures).toHaveLength(1));
    expect(tracked.events).toEqual([]);
  });
});

describe("given a member changing a board's widgets", () => {
  async function loadedWidgets(options: { refuse?: boolean } = {}) {
    const mounted = mount(() => useBoardWidgets({ dashboardId: DASHBOARD_ID }), options);
    await waitFor(() => expect(mounted.latest().widgets).toHaveLength(1));
    return mounted;
  }

  /** @scenario "Telemetry: adding, saving and deleting a widget each send their own event" */
  it("sends where an added widget came from", async () => {
    const { latest } = await loadedWidgets();
    const widget = latest().widgets[0] as BoardWidget;

    await act(() => latest().duplicateWidget(widget));
    await act(() =>
      latest().addWidget({
        name: "Mine",
        code: CODE,
        queries: [{ name: "main", sql: "SELECT 2" }],
      }),
    );

    expect(tracked.events.map(({ attributes }) => attributes)).toEqual([
      { addedFrom: "duplicate", widgetCount: 1 },
      { addedFrom: "editor", widgetCount: 1 },
    ]);
    expect(names()).toEqual(["dashboards.added.widget", "dashboards.added.widget"]);
  });

  /** @scenario "Telemetry: adding, saving and deleting a widget each send their own event" */
  /** @scenario "Telemetry: changing whether a widget counts Langy traces sends dashboards.toggled.langy_traces" */
  it("sends an edit, and a Langy toggle only when the save changes Langy's traces", async () => {
    const { latest } = await loadedWidgets();
    const widget = latest().widgets[0] as BoardWidget;

    await act(() =>
      latest().saveWidget({
        widget,
        draft: {
          name: "Cost",
          code: CODE,
          queries: [{ name: "main", sql: "SELECT 1", sources: ["application", "langy"] }],
        },
      }),
    );
    await act(() =>
      latest().saveWidget({
        widget,
        draft: {
          name: "Cost, renamed",
          code: CODE,
          queries: [{ name: "main", sql: "SELECT 1", sources: ["application"] }],
        },
      }),
    );

    expect(names()).toEqual([
      "dashboards.edited.widget",
      "dashboards.toggled.langy_traces",
      "dashboards.edited.widget",
    ]);
    expect(tracked.events[1]?.attributes).toEqual({ included: true });
  });

  /** @scenario "Telemetry: adding, saving and deleting a widget each send their own event" */
  it("sends a deletion once the server agrees", async () => {
    const { latest } = await loadedWidgets();

    await act(() => latest().removeWidget(latest().widgets[0] as BoardWidget));

    expect(names()).toEqual(["dashboards.deleted.widget"]);
  });

  /** @scenario "Telemetry: adding, saving and deleting a widget each send their own event" */
  it("sends nothing for a change the server refuses", async () => {
    const { latest } = await loadedWidgets({ refuse: true });
    const widget = latest().widgets[0] as BoardWidget;

    await act(() => latest().duplicateWidget(widget));
    await act(() => latest().removeWidget(widget));

    expect(tracked.events).toEqual([]);
  });
});

describe("given a member starring a board", () => {
  /** @scenario "Telemetry: starring a board sends dashboards.favourited.dashboard" */
  it("sends the star once the server agrees", async () => {
    const { latest } = mount(useFavourites);
    await waitFor(() => expect(latest().isLoading).toBe(false));

    act(() => latest().toggleStar({ kind: "board", dashboardId: DASHBOARD_ID }));

    await waitFor(() => expect(names()).toEqual(["dashboards.favourited.dashboard"]));
    expect(tracked.events[0]?.attributes).toEqual({ starred: true });
  });
});

describe("given a member asking Langy from a board", () => {
  /** @scenario "Telemetry: asking Langy from a board sends dashboards.asked.langy" */
  it("sends whether the ask was a question or a draft", () => {
    const { latest } = mount(useLangyAsk);

    act(() => latest().ask({ draft: "Explain this board", context: [] }));
    act(() => latest().ask({ question: "Why did cost go up?", context: [] }));

    expect(tracked.events.map(({ attributes }) => attributes)).toEqual([
      { askKind: "draft" },
      { askKind: "question" },
    ]);
  });
});

describe("given a member opening a board", () => {
  /** @scenario "Telemetry: opening a board sends dashboards.viewed.dashboard" */
  it("sends nothing while the widgets load, and one view once they are known", () => {
    let props: Parameters<typeof useDashboardViewed>[0] = {
      dashboardId: DASHBOARD_ID,
      dashboardKind: "stored",
      widgetCount: 0,
      isLoaded: false,
    };
    const { latest } = mount(() => {
      useDashboardViewed(props);
      return null;
    });
    expect(latest()).toBeNull();
    expect(tracked.events).toEqual([]);

    props = { ...props, widgetCount: 3, isLoaded: true };
    cleanup();
    mount(() => useDashboardViewed(props));
    expect(tracked.events.map(({ attributes }) => attributes)).toEqual([
      { dashboardKind: "stored", widgetCount: 3 },
    ]);
  });
});
