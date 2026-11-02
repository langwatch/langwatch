/**
 * @vitest-environment jsdom
 * The guard rails of a board: its data goes to LWQL and never to the legacy analytics
 * procedures, and one widget whose query fails leaves every other widget drawing its own.
 * Only the sandboxed frame is stood in for, since jsdom cannot run it.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { analyticsTrpc } from "@langwatch/analytics-contract";
import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { dashboardTrpc, graphTrpc, savedViewTrpc } from "@langwatch/dashboard-contract";
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { lwqlResult } from "../../../__tests__/lwql-fixtures.ts";
import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import type { SandboxedChartFrameProps } from "../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx";
import { curatedBoardById } from "../model/curated-boards.ts";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

/** Every procedure the legacy analytics pages read and write, from their own contracts. */
const LEGACY_PROCEDURES = [analyticsTrpc, graphTrpc, dashboardTrpc, savedViewTrpc].flatMap(
  ({ namespace, members }) => Object.keys(members).map((name) => `${namespace}.${name}`),
);
/** The board's own reads: its list, its stars and its widgets, none of them data. */
// The card also reads the projects the member may name, to show a query's project names.
const BOARD_PROCEDURES = /^(boards|dashboardWidgets|analytics\.lwql\.readableProjects)\.?/;

const FLAGS = { release_dashboards: true };
const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Weekly review",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};
const FAILING_SQL = "SELECT count() AS n FROM traces WHERE broken";

const widget = ({
  id,
  name,
  sql,
  gridRow,
}: {
  id: string;
  name: string;
  sql: string;
  gridRow: number;
}) => ({
  id,
  dashboardId: BOARD.id,
  name,
  graph: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "main", sql }],
  },
  gridColumn: 0,
  gridRow,
  colSpan: 4,
  rowSpan: 3,
});
const TRACES = widget({
  id: "w-1",
  name: "Traces",
  sql: "SELECT count() AS n FROM traces",
  gridRow: 0,
});
const COST = widget({
  id: "w-2",
  name: "Cost",
  sql: "SELECT sum(TotalCost) FROM traces",
  gridRow: 3,
});

/** A stored board and a query door that fails one statement; every call is kept. */
function boardServer({ widgets }: { widgets: ReturnType<typeof widget>[] }) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    switch (call.path) {
      case "boards.getAll":
        return Promise.resolve([{ ...BOARD }]);
      case "boards.listStarred":
        return Promise.resolve([]);
      case "dashboardWidgets.list":
        return Promise.resolve(widgets.map((each) => structuredClone(each)));
      case "analytics.lwql.query":
        return (call.input as { sql: string }).sql === FAILING_SQL
          ? Promise.reject(new Error("The query engine is unavailable."))
          : Promise.resolve(lwqlResult());
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { calls, answer };
}

/** Runs every frame's query on the page, as each widget's code would on load; keeps the results. */
async function everyFrameRuns({
  queryNameOf = () => "main",
}: { queryNameOf?: (props: SandboxedChartFrameProps) => string | undefined } = {}) {
  const results = new Map<string, unknown>();
  for (const frame of screen.getAllByTestId("sandboxed-frame")) {
    const props = frames.get(frame);
    if (!props) throw new Error("a frame never rendered");
    const queryName = queryNameOf(props);
    if (!queryName) continue;
    await act(async () => {
      const result = await props
        .executeQuery({ queryName, params: {}, signal: new AbortController().signal })
        .catch((error: unknown) => error);
      results.set(props.dashboardContext.widgetId ?? props.code, result);
    });
  }
  return results;
}

function openStoredBoard({ widgets }: { widgets: ReturnType<typeof widget>[] }) {
  const server = boardServer({ widgets });
  const host = new StubAnalyticsHost({
    flags: FLAGS,
    permissions: [...ANALYTICS_MEMBER_PERMISSIONS],
    route: { params: { dashboardId: BOARD.id }, query: {} },
  });
  renderDashboards({
    element: (
      <>
        <SavedDashboardsSection openPath={BOARD.id} />
        <DashboardBoardScreen />
      </>
    ),
    host,
    answer: server.answer,
  });
  return server;
}

afterEach(cleanup);

describe("given a member opens a stored board with widgets", () => {
  describe("when every widget loads its data", () => {
    let calls: UiProcedureCall[] = [];
    beforeEach(async () => {
      calls = openStoredBoard({ widgets: [TRACES, COST] }).calls;
      await screen.findAllByTestId("sandboxed-frame");
      await everyFrameRuns();
    });

    /** @scenario "AC19 Every dashboard data request goes to LWQL and none to legacy analytics" */
    it("sends no request to a legacy analytics procedure", () => {
      expect(
        calls.map(({ path }) => path).filter((path) => LEGACY_PROCEDURES.includes(path)),
      ).toEqual([]);
    });

    /** @scenario "AC19 Every dashboard data request goes to LWQL and none to legacy analytics" */
    it("sends every data request to the LWQL query procedure, one per widget", () => {
      expect(calls.map(({ path }) => path).filter((path) => !BOARD_PROCEDURES.test(path))).toEqual([
        "analytics.lwql.query",
        "analytics.lwql.query",
      ]);
    });
  });
});

describe("given a member opens a From LangWatch board", () => {
  describe("when every widget loads its data", () => {
    /** @scenario "AC19 Every dashboard data request goes to LWQL and none to legacy analytics" */
    it("sends every data request to the LWQL query procedure and none to legacy analytics", async () => {
      const server = boardServer({ widgets: [] });
      const host = new StubAnalyticsHost({
        flags: FLAGS,
        permissions: [...ANALYTICS_MEMBER_PERMISSIONS],
        route: { params: { templateId: "release" }, query: {} },
      });
      renderDashboards({ element: <CuratedBoardScreen />, host, answer: server.answer });
      const widgets = curatedBoardById("release")?.widgets ?? [];
      await screen.findByRole("heading", { name: "Release check" });
      await everyFrameRuns({
        queryNameOf: ({ code }) =>
          widgets.find(({ definition }) => definition.code === code)?.definition.queries[0]?.name,
      });
      const queried = widgets.filter(({ definition }) => definition.queries.length > 0);

      expect(
        server.calls.map(({ path }) => path).filter((path) => !BOARD_PROCEDURES.test(path)),
      ).toEqual(queried.map(() => "analytics.lwql.query"));
    });
  });
});

describe("given a board where one widget's LWQL query fails", () => {
  const failingCost = {
    ...COST,
    graph: { ...COST.graph, queries: [{ name: "main", sql: FAILING_SQL }] },
  };
  let results = new Map<string, unknown>();
  beforeEach(async () => {
    openStoredBoard({ widgets: [TRACES, failingCost] });
    await screen.findAllByTestId("sandboxed-frame");
    results = await everyFrameRuns();
  });

  const failingFace = () =>
    screen.getByText("Couldn't load Cost").closest("[data-testid='widget-state-face']");

  describe("when the member views the board", () => {
    /** @scenario "AC23 A failing query does not take the board down" */
    it("shows that widget's error state by name", () => {
      expect(screen.getByText("Couldn't load Cost")).toBeInTheDocument();
    });

    /** @scenario "AC23 A failing query does not take the board down" */
    it("offers Retry on that widget", () => {
      expect(
        within(failingFace() as HTMLElement).getByRole("button", { name: "Retry" }),
      ).toBeInTheDocument();
    });

    /** @scenario "AC23 A failing query does not take the board down" */
    it("shows neither the empty state nor the call-to-action state on it", () => {
      expect(within(failingFace() as HTMLElement).queryByText(/in this period|^Needs /)).toBeNull();
    });

    /** @scenario "AC23 A failing query does not take the board down" */
    it("covers no other widget with a state face", () => {
      expect(screen.getAllByTestId("widget-state-face")).toHaveLength(1);
    });

    /** @scenario "AC23 A failing query does not take the board down" */
    it("still hands the other widget its own rows", () => {
      expect(results.get(TRACES.id)).toMatchObject({ rows: lwqlResult().rows });
    });
  });
});
