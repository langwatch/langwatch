/**
 * @vitest-environment jsdom
 * The origins a board leaves out, as the query door receives them: the widgets of a stored
 * board, of a From LangWatch board, and the editor's preview all run with Langy's left out.
 * Only the sandboxed frame is stood in for, since jsdom cannot run it.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { frames } = vi.hoisted(() => ({
  frames: new WeakMap<Element, SandboxedChartFrameProps>(),
}));

vi.mock("../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: (props: SandboxedChartFrameProps) => (
    <div
      data-testid="sandboxed-frame"
      ref={(element) => {
        if (element) frames.set(element, props);
      }}
    />
  ),
}));

import {
  AnalyticsHostProvider,
  type AnalyticsRouteReading,
} from "../../../model/analytics-host.ts";
import {
  ANALYTICS_MEMBER_PERMISSIONS,
  StubAnalyticsHost,
  type StubAnalyticsHostOptions,
} from "../../../testing.tsx";
import type { SandboxedChartFrameProps } from "../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx";
import { curatedBoardById } from "../model/curated-boards.ts";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const FLAGS = { release_dashboards: true, release_langy_enabled: true };
const PROJECT = {
  id: HOME_BOARD.projectId,
  slug: "test-project",
  name: "Test Project",
  hasFirstMessage: true,
};
const MEMBER = [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"];
const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Weekly review",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};
const WIDGET = {
  id: "w-1",
  dashboardId: BOARD.id,
  name: "Traces",
  graph: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "main", sql: "SELECT count() AS n FROM traces" }],
  },
  gridColumn: 0,
  gridRow: 0,
  colSpan: 4,
  rowSpan: 3,
};

/** One stored board with one widget, and a query door that answers no rows; calls are kept. */
function boardServer() {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    switch (call.path) {
      case "dashboards.getAll":
        return Promise.resolve([{ ...BOARD }]);
      case "dashboards.listStarred":
        return Promise.resolve([]);
      case "dashboardWidgets.list":
        return Promise.resolve([structuredClone(WIDGET)]);
      case "analytics.lwql.query":
        return Promise.resolve({
          columns: [{ name: "n", type: "UInt64" }],
          rows: [],
          statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
          diagnostics: [],
          followsTimeWindow: false,
          followsGranularity: false,
        });
      default:
        return NO_PROCEDURES(call);
    }
  };
  /** What each run sent the query door. */
  const runs = () =>
    calls.flatMap(({ path, input }) =>
      path === "analytics.lwql.query" ? [input as { sql: string; excludeOrigins?: unknown }] : [],
    );
  return { answer, runs };
}

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

/**
 * Renders the board again whenever its address changes, under a host that is a new object
 * each time, as the router's is: a compiled screen reads the address again only for a new host.
 */
function AddressedBoard({ host }: { host: AddressedHost }) {
  const [atAddress, setAtAddress] = useState(host);
  useEffect(() => {
    const readdress = () => setAtAddress(new Proxy(host, {}));
    host.listeners.add(readdress);
    return () => void host.listeners.delete(readdress);
  }, [host]);
  return (
    <AnalyticsHostProvider value={atAddress}>
      <DashboardBoardScreen />
    </AnalyticsHostProvider>
  );
}

/** Runs one of a frame's queries, as the widget's code would on load. */
async function frameRuns({ frame, queryName }: { frame: Element; queryName: string }) {
  const props = frames.get(frame);
  if (!props) throw new Error("the frame never rendered");
  await act(async () => {
    await props.executeQuery({ queryName, params: {}, signal: new AbortController().signal });
  });
}

afterEach(cleanup);

/** Opens the stored board in the project in view, a personal one when asked. */
function openBoard({ isPersonal = false }: { isPersonal?: boolean } = {}) {
  const server = boardServer();
  const host = new AddressedHost({
    flags: FLAGS,
    permissions: MEMBER,
    project: { ...PROJECT, isPersonal },
    route: { params: { dashboardId: BOARD.id }, query: {} },
  });
  renderDashboards({ element: <AddressedBoard host={host} />, host, answer: server.answer });
  return server;
}

describe("given a member opens a stored board", () => {
  describe("when a widget's card runs its query", () => {
    /** @scenario "AC193 Langy: the origins a board leaves out are a list a board parameter can set later" */
    it("names the origins the board leaves out as a list, langy by default", async () => {
      const server = openBoard();

      await frameRuns({ frame: await screen.findByTestId("sandboxed-frame"), queryName: "main" });

      expect(server.runs()).toEqual([
        expect.objectContaining({ sql: WIDGET.graph.queries[0]?.sql, excludeOrigins: ["langy"] }),
      ]);
    });
  });

  describe("when the member opens the widget's editor", () => {
    /** @scenario "AC190 Langy: every widget on a board leaves out Langy's conversations by default" */
    it("runs the preview with the origins the card leaves out", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = openBoard();
      const card = await screen.findByTestId("sandboxed-frame");

      await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit code" }));
      await screen.findByRole("tab", { name: "API / MCP" });
      const drawer = screen
        .getAllByRole("dialog")
        .find((dialog) => within(dialog).queryByRole("tab", { name: "API / MCP" }));
      if (!drawer) throw new Error("the editor did not open");
      const preview = await within(drawer).findByTestId("sandboxed-frame");
      await frameRuns({ frame: card, queryName: "main" });
      await frameRuns({ frame: preview, queryName: "main" });

      expect(preview).not.toBe(card);
      expect(server.runs().map((run) => run.excludeOrigins)).toEqual([["langy"], ["langy"]]);
    });
  });
});

describe("given a member opens a stored board in their personal project", () => {
  describe("when a widget's card runs its query", () => {
    /** @scenario "AC198 Langy: a board in a personal project shows Langy's conversations" */
    it("leaves out no origin, so the widget counts Langy's conversations too", async () => {
      const server = openBoard({ isPersonal: true });

      await frameRuns({ frame: await screen.findByTestId("sandboxed-frame"), queryName: "main" });

      expect(server.runs()).toEqual([
        expect.objectContaining({ sql: WIDGET.graph.queries[0]?.sql, excludeOrigins: [] }),
      ]);
    });
  });
});

describe("given a member opens a From LangWatch board", () => {
  /** @scenario "AC190 Langy: every widget on a board leaves out Langy's conversations by default" */
  it("runs every widget's query with Langy's origin left out", async () => {
    const server = boardServer();
    const host = new StubAnalyticsHost({
      flags: FLAGS,
      permissions: MEMBER,
      route: { params: { templateId: "release" }, query: {} },
    });
    const widgets = curatedBoardById("release")?.widgets ?? [];
    renderDashboards({ element: <CuratedBoardScreen />, host, answer: server.answer });
    await screen.findByRole("heading", { name: "Release check" });

    for (const frame of screen.getAllByTestId("sandboxed-frame")) {
      const widget = widgets.find(({ definition }) => definition.code === frames.get(frame)?.code);
      const queryName = widget?.definition.queries[0]?.name;
      if (queryName) await frameRuns({ frame, queryName });
    }

    expect(server.runs().length).toBe(widgets.length);
    expect(server.runs().length).toBeGreaterThan(0);
    expect(server.runs().map((run) => run.excludeOrigins)).toEqual(widgets.map(() => ["langy"]));
  });
});
