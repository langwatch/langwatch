/**
 * @vitest-environment jsdom
 * Each board and widget change sends its product event once the server agrees, and a change it
 * refuses sends none. The board is opened against an in-memory server.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import { UiAnalytics, type UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { UiHostServicesContextProvider } from "@langwatch/browser-host/capabilities";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import { useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import { boardSubject, SUGGESTED_QUESTIONS } from "../../langy/model/board-langy.ts";
import { BoardLangy } from "../../langy/ui/sections/board-langy.tsx";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import type { BoardTemplate } from "../../templates/index.ts";
import { BlockPickerDialog } from "../../ui/sections/block-picker-dialog.tsx";
import { useBoardFromTemplate } from "../use-board-from-template.ts";
import { useBoardWidgets } from "../use-board-widgets.ts";
import { useDashboardViewed } from "../use-dashboard-viewed.ts";
import { useFavourites } from "../use-favourites.ts";
import { useSavedDashboards } from "../use-saved-dashboards.ts";

/** The analytics destination the shell installs, recording instead of sending. */
class RecordingUiAnalytics extends UiAnalytics {
  readonly events: UiAnalyticsEvent[] = [];

  track(event: UiAnalyticsEvent): void {
    this.events.push(event);
  }

  identify(): void {}

  group(): void {}

  reset(): void {}
}

const tracked = new RecordingUiAnalytics();

/** Puts the recording destination above the element, through the real host-service seam. */
function withTracking(element: ReactElement) {
  const services = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    analytics: tracked,
  };
  return <UiHostServicesContextProvider value={services}>{element}</UiHostServicesContextProvider>;
}

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
  renderDashboards({
    element: withTracking(<Probe />),
    host,
    answer: inMemoryServer({ refuse }).answer,
  });
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
  const board = boardSubject({ board: { id: DASHBOARD_ID, name: "Weekly" }, widgets: [] });
  const period: BoardPeriod = {
    periodStart: Date.UTC(2026, 9, 1),
    periodEnd: Date.UTC(2026, 9, 2),
    granularitySeconds: 3600,
  };

  /** @scenario "Telemetry: asking Langy from a board sends langy.asked.question with where it was asked" */
  it("sends one ask when the member puts a suggested question to Langy", async () => {
    const user = userEvent.setup();
    renderDashboards({
      element: withTracking(
        <BoardLangy board={board} period={period} withSuggestions onOpenPicker={() => void 0} />,
      ),
      host: new StubAnalyticsHost({
        flags: { release_dashboards: true, release_langy_enabled: true },
        permissions: [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"],
      }),
      answer: inMemoryServer().answer,
    });

    await user.click(screen.getByRole("button", { name: SUGGESTED_QUESTIONS[0] }));

    expect(names()).toEqual(["langy.asked.question"]);
    expect(tracked.events[0]?.attributes).toEqual({ surface: "ask_bar" });
  });

  /** @scenario "Telemetry: asking Langy from a board sends langy.asked.question with where it was asked" */
  it.each([
    ["a typed question", "cost by model"],
    ["an empty ask, which the member still pressed", ""],
  ])("sends one add_widget ask for %s in Add a widget", async (_case, typed) => {
    const user = userEvent.setup();
    renderDashboards({
      element: (
        <BlockPickerDialog
          board={board}
          period={period}
          onAddWidgets={() => Promise.resolve(true)}
          onSkip={() => void 0}
          onClose={() => void 0}
        />
      ),
      host: new StubAnalyticsHost({
        flags: { release_dashboards: true, release_langy_enabled: true },
        permissions: [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"],
      }),
      answer: inMemoryServer().answer,
    });

    const search = await screen.findByRole("searchbox", { name: "What do you want to know?" });
    if (typed !== "") await user.type(search, typed);
    await user.click(screen.getByRole("button", { name: "Ask Langy" }));

    expect(names()).toEqual(["langy.asked.question"]);
    expect(tracked.events[0]?.attributes).toEqual({ surface: "add_widget" });
  });

  /** @scenario "Telemetry: a draft the app seeds in Langy sends no ask" */
  it("sends nothing for a draft or question the app seeds by itself", () => {
    const { latest } = mount(useLangyAsk);

    act(() => latest().ask({ draft: "Explain this widget", context: [] }));
    act(() => latest().ask({ question: "Build this widget", context: [] }));

    expect(tracked.events).toEqual([]);
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
