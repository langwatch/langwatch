/**
 * @vitest-environment jsdom
 * A board where two or more widgets ended on a resource limit says so once, above the grid.
 * Only the sandboxed frame is stood in for; the failure travels the real executor and frame.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Agent health",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};

const widget = ({ id, name, gridRow }: { id: string; name: string; gridRow: number }) => ({
  id,
  dashboardId: BOARD.id,
  name,
  graph: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "main", sql: `SELECT count() AS n FROM traces -- ${id}` }],
  },
  gridColumn: 0,
  gridRow,
  colSpan: 4,
  rowSpan: 3,
});
const WIDGETS = [
  widget({ id: "w-1", name: "Volume", gridRow: 0 }),
  widget({ id: "w-2", name: "Cost per trace", gridRow: 3 }),
  widget({ id: "w-3", name: "Who uses it", gridRow: 6 }),
];

const BANNER = "limit-failed-widgets-banner";
const LIMIT_WORDS =
  "LangWatch limits the memory and time a widget's query may use. This is not a problem with your data.";
/** Each card says these only when its failure's code reached it; a lost code reads as unknown. */
const TIME_LIMIT_WORDS = "The query ran past the time a widget may take.";
const UNKNOWN_COLUMN_WORDS = "Check the column names against the dataset's columns.";

/** The status the server answers each code with. */
const HTTP_STATUS = {
  query_memory_exceeded: 422,
  query_timeout: 504,
  lwql_unknown_identifier: 400,
} as const;

/** The error code each widget id answers with; a widget not listed answers with rows. */
type Failures = Record<string, keyof typeof HTTP_STATUS>;

function boardServer(failures: Failures) {
  return (call: UiProcedureCall): Promise<unknown> => {
    switch (call.path) {
      case "boards.getAll":
        return Promise.resolve([{ ...BOARD }]);
      case "boards.listStarred":
        return Promise.resolve([]);
      case "dashboardWidgets.list":
        return Promise.resolve(WIDGETS.map((each) => structuredClone(each)));
      case "analytics.lwql.query": {
        const { sql } = call.input as { sql: string };
        const id = WIDGETS.find((each) => sql.endsWith(`-- ${each.id}`))?.id ?? "";
        const code = failures[id];
        return code
          ? Promise.reject(new UiProcedureRefusal(code, HTTP_STATUS[code]))
          : Promise.resolve(lwqlResult({ rows: [{ n: 1 }] }));
      }
      default:
        return NO_PROCEDURES(call);
    }
  };
}

/** Runs the query of every frame on screen not in `skip`, the way the widget's code would. */
async function answerFrames({ skip = [] }: { skip?: readonly HTMLElement[] } = {}) {
  for (const frame of await screen.findAllByTestId("sandboxed-frame")) {
    if (skip.includes(frame)) continue;
    const props = frames.get(frame);
    if (!props) throw new Error("a frame never rendered");
    await act(async () => {
      await props
        .executeQuery({ queryName: "main", params: {}, signal: new AbortController().signal })
        .catch(() => undefined);
    });
  }
}

async function openBoard(failures: Failures) {
  renderDashboards({
    element: (
      <>
        <SavedDashboardsSection openPath={BOARD.id} />
        <DashboardBoardScreen />
      </>
    ),
    host: new StubAnalyticsHost({
      flags: { release_dashboards: true },
      permissions: [...ANALYTICS_MEMBER_PERMISSIONS],
      route: { params: { dashboardId: BOARD.id }, query: {} },
    }),
    answer: boardServer(failures),
  });
  await answerFrames();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given a board of three widgets", () => {
  describe("when two end on a limit failure", () => {
    /** @scenario "Two widgets that failed on a limit are told once above the board" */
    it("says two of three hit a limit, with no action", async () => {
      await openBoard({ "w-2": "query_memory_exceeded", "w-3": "query_timeout" });

      const banner = await screen.findByTestId(BANNER);
      expect(banner).toHaveTextContent("2 of 3 widgets hit a limit");
      expect(banner).toHaveTextContent(LIMIT_WORDS);
      expect(banner.querySelector("button")).toBeNull();
    });
  });

  describe("when one ends on a limit failure", () => {
    /** @scenario "One widget that failed on a limit leaves the board without the line" */
    it("shows no warning", async () => {
      await openBoard({ "w-2": "query_timeout" });

      expect(await screen.findByText("Couldn't load")).toBeTruthy();
      expect(screen.getByText(TIME_LIMIT_WORDS)).toBeTruthy();
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  describe("when all three end on a limit failure", () => {
    /** @scenario "Every widget failing on a limit says all hit a limit" */
    it("says all three hit a limit", async () => {
      await openBoard({
        "w-1": "query_timeout",
        "w-2": "query_memory_exceeded",
        "w-3": "query_timeout",
      });

      const banner = await screen.findByTestId(BANNER);
      expect(banner).toHaveTextContent("All 3 widgets hit a limit");
      expect(banner).toHaveTextContent(LIMIT_WORDS);
    });
  });

  describe("when failures are not limits", () => {
    /** @scenario "Failures that are not limits are not counted" */
    it("shows no warning for two other failures or for one limit and one other", async () => {
      await openBoard({ "w-2": "lwql_unknown_identifier", "w-3": "lwql_unknown_identifier" });
      expect(await screen.findAllByText(UNKNOWN_COLUMN_WORDS)).toHaveLength(2);
      expect(screen.queryByTestId(BANNER)).toBeNull();
      cleanup();

      await openBoard({ "w-2": "query_timeout", "w-3": "lwql_unknown_identifier" });
      expect(await screen.findByText(TIME_LIMIT_WORDS)).toBeTruthy();
      expect(screen.getByText(UNKNOWN_COLUMN_WORDS)).toBeTruthy();
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  describe("when a limit-failed widget recovers", () => {
    /** @scenario "The warning goes when a widget recovers" */
    it("drops the warning once one of two retries and loads", async () => {
      const failures: Failures = { "w-2": "query_timeout", "w-3": "query_timeout" };
      await openBoard(failures);
      expect(await screen.findByTestId(BANNER)).toBeTruthy();

      // Retry remounts only its own frame; answering the rest would hide a Retry that did nothing.
      const before = screen.getAllByTestId("sandboxed-frame");
      delete failures["w-2"];
      fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0] as HTMLElement);
      await answerFrames({ skip: before });

      expect(
        screen.getAllByTestId("sandboxed-frame").filter((f) => !before.includes(f)),
      ).toHaveLength(1);
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });
});
