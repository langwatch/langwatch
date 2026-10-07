// @vitest-environment jsdom
/**
 * A placed dashboard widget follows the period, hands refresh ticks to its frame, shows its
 * code's own errors, and draws what its queries' completeness reports say in place of the chart.
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */
import type { QueryCompleteness } from "@langwatch/analytics-contract";
import type { ChartQueryError } from "@langwatch/analytics-contract/chart-frame-protocol";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { periodMock, executorMock, frameProps } = vi.hoisted(() => ({
  periodMock: vi.fn(),
  executorMock: vi.fn(),
  frameProps: vi.fn<(props: SandboxedChartFrameProps) => void>(),
}));

vi.mock("../../../behavior/use-analytics-period.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAnalyticsPeriod: () => periodMock(),
}));

vi.mock("../../../behavior/use-dashboard-widget-executor.ts", () => ({
  useDashboardWidgetExecutor: (...args: unknown[]) => executorMock(...args),
}));

vi.mock("../../../behavior/use-dashboard-widget-chart-navigate.ts", () => ({
  useDashboardWidgetChartNavigate: () => vi.fn(),
}));

vi.mock("../sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: (props: SandboxedChartFrameProps) => {
    frameProps(props);
    return <div data-testid="sandboxed-frame" />;
  },
}));

import {
  DashboardWidgetFrame,
  DashboardWidgetFrameOverWindow,
} from "../dashboard-widget-frame.tsx";
import type { SandboxedChartFrameProps } from "../sandboxed-chart-frame.tsx";
import { DashboardRefreshedAtContext } from "../use-dashboard-auto-refresh.ts";

function lastFrameProps(): SandboxedChartFrameProps {
  const props = frameProps.mock.calls.at(-1)?.[0];
  if (!props) throw new Error("the frame never rendered");
  return props;
}

const GRAPH = {
  version: 1,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "main", sql: "SELECT 1" }],
};

const period = ({ startMs, endMs }: { startMs: number; endMs: number }) => ({
  period: {
    startDate: { epochMilliseconds: startMs },
    endDate: { epochMilliseconds: endMs },
  },
});

const widget = (refreshedAt?: number) => (
  <DesignSystemProvider forcedTheme="light">
    <DashboardRefreshedAtContext.Provider value={refreshedAt}>
      <DashboardWidgetFrame
        id="graph_1"
        graph={GRAPH}
        projectId="project_1"
        projectSlug="project"
        maxHeight={300}
      />
    </DashboardRefreshedAtContext.Provider>
  </DesignSystemProvider>
);

beforeEach(() => {
  periodMock.mockReturnValue(period({ startMs: 1_000, endMs: 2_000 }));
  executorMock.mockReturnValue({
    executeQuery: vi.fn(),
    params: { timeWindow: { start: 1_000, end: 2_000 }, granularitySeconds: 3600 },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given a placed dashboard widget", () => {
  describe("when it mounts", () => {
    /** @scenario "A placed dashboard widget follows the dashboard's period control" */
    it("hands the executor the dashboard's own period as its time window", () => {
      render(widget());

      expect(executorMock).toHaveBeenCalledWith("project_1", GRAPH.queries, {
        timeWindow: { start: 1_000, end: 2_000 },
      });
    });
  });

  describe("when the dashboard's period changes", () => {
    /** @scenario "A placed dashboard widget follows the dashboard's period control" */
    it("re-derives the window from the new period", () => {
      const { rerender } = render(widget());

      periodMock.mockReturnValue(period({ startMs: 5_000, endMs: 9_000 }));
      rerender(widget());

      expect(executorMock).toHaveBeenLastCalledWith("project_1", GRAPH.queries, {
        timeWindow: { start: 5_000, end: 9_000 },
      });
    });
  });

  describe("when the dashboard refreshes on its schedule", () => {
    it("hands each refresh tick to the frame as a dashboard context change", () => {
      const { rerender } = render(widget(undefined));
      const before = lastFrameProps().dashboardContext;
      expect(before.refreshedAt).toBeUndefined();

      rerender(widget(123_456));
      const after = lastFrameProps().dashboardContext;
      expect(after.refreshedAt).toBe(123_456);
      expect(after).not.toBe(before);
    });
  });

  describe("when the widget's code reports an error", () => {
    /** @scenario "A widget's own error is shown, not dropped" */
    it("shows a warning on the card and leaves the frame mounted", () => {
      render(widget());
      expect(screen.queryByTestId("frame-diagnostic-badge")).toBeNull();

      act(() => {
        lastFrameProps().onLog({
          level: "error",
          source: "lw.error",
          text: "Render error: cannot read x of undefined",
        });
      });

      expect(screen.getByTestId("frame-diagnostic-badge")).toBeTruthy();
      expect(screen.getByTestId("sandboxed-frame")).toBeTruthy();
    });
  });
});

const report = (overrides: Partial<QueryCompleteness>): QueryCompleteness => ({
  state: "complete",
  unit: "traces",
  total: 10,
  fields: [],
  ...overrides,
});
const MISSING_COST = report({
  state: "missing",
  fields: [{ field: "TotalCost", label: "total cost", present: 0 }],
});
const BROKEN: ChartQueryError = {
  code: "lwql_unknown_identifier",
  title: "Unknown column",
  message: "The query reads a column that does not exist.",
};
const BUSY: ChartQueryError = { ...BROKEN, code: "lwql_busy", retryable: true };

const resultWith = (completeness?: QueryCompleteness) => ({
  columns: [],
  rows: [],
  statistics: {},
  diagnostics: [],
  followsTimeWindow: true,
  followsGranularity: false,
  ...(completeness ? { completeness } : {}),
});

/** The board's widget, over a window, as a board card draws it. */
const boardWidget = (props: {
  onAskLangyToSetUp?: (missing: { field: string; label: string }) => void;
}) => (
  <DesignSystemProvider forcedTheme="light">
    <DashboardWidgetFrameOverWindow
      id="graph_1"
      graph={GRAPH}
      projectId="project_1"
      projectSlug="project"
      maxHeight={300}
      widgetName="Cost per trace"
      timeWindow={{ start: 1_000, end: 2_000 }}
      {...props}
    />
  </DesignSystemProvider>
);

/** The frame runs its query once; the executor answers with `answer`. */
function frameRuns(answer: () => Promise<unknown>) {
  const executeQuery = vi.fn(answer);
  executorMock.mockReturnValue({
    executeQuery,
    params: { timeWindow: { start: 1_000, end: 2_000 }, granularitySeconds: 3600 },
  });
  return async () => {
    await act(async () => {
      await lastFrameProps()
        .executeQuery({ queryName: "main", params: {}, signal: new AbortController().signal })
        .catch(() => undefined);
    });
  };
}

describe("given a widget on a board", () => {
  describe("when its query found no traffic", () => {
    /** @scenario "A widget whose query found no traffic says so" */
    it("says so in place of the chart", async () => {
      const run = frameRuns(() =>
        Promise.resolve(resultWith(report({ state: "no_traffic", total: 0 }))),
      );
      render(boardWidget({}));
      await run();

      expect(screen.getByText("No traces in this period")).toBeTruthy();
    });
  });

  describe("when its query needs a field no trace carries", () => {
    /** @scenario "A widget whose query needs a field no trace carries shows the setup view" */
    it("names the field and hands it to Langy", async () => {
      const onAskLangyToSetUp = vi.fn();
      const run = frameRuns(() => Promise.resolve(resultWith(MISSING_COST)));
      render(boardWidget({ onAskLangyToSetUp }));
      await run();

      expect(screen.getByText("Needs total cost")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Ask Langy to help" }));
      expect(onAskLangyToSetUp).toHaveBeenCalledWith({ field: "TotalCost", label: "total cost" });
    });

    /** @scenario "The setup view has no Langy button where the board offers no Langy" */
    it("offers no Langy button when the board has no hand-off", async () => {
      const run = frameRuns(() => Promise.resolve(resultWith(MISSING_COST)));
      render(boardWidget({}));
      await run();

      expect(screen.getByText("Needs total cost")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Ask Langy to help" })).toBeNull();
    });
  });

  describe("when its query fails for good before it ever answered", () => {
    /** @scenario "A widget whose query fails names itself and offers Retry" */
    it("names the widget, gives the reason, and Retry starts it over", async () => {
      const run = frameRuns(() => Promise.reject(BROKEN));
      render(boardWidget({}));
      await run();

      expect(screen.getByText("Couldn't load Cost per trace")).toBeTruthy();
      expect(screen.getByText(BROKEN.message)).toBeTruthy();
      const rendersBefore = frameProps.mock.calls.length;

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(screen.queryByTestId("widget-state-face")).toBeNull();
      expect(frameProps.mock.calls.length).toBeGreaterThan(rendersBefore);
    });
  });

  describe("when its query is refused as busy", () => {
    /** @scenario "A failure the frame will retry does not fail the card yet" */
    it("keeps the widget's own face while the frame retries", async () => {
      const run = frameRuns(() => Promise.reject(BUSY));
      render(boardWidget({}));
      await run();

      expect(screen.queryByTestId("widget-state-face")).toBeNull();
    });
  });

  describe("when a later run of a query that answered fails", () => {
    /** @scenario "A failed refresh keeps the chart on the card" */
    it("keeps the widget's own face", async () => {
      const answers = [Promise.resolve(resultWith(report({}))), Promise.reject(BROKEN)];
      answers[1]?.catch(() => undefined);
      const run = frameRuns(() => answers.shift() ?? Promise.reject(BROKEN));
      render(boardWidget({}));
      await run();
      await run();

      expect(screen.queryByTestId("widget-state-face")).toBeNull();
    });
  });

  describe("when the frame drops a query it no longer needs", () => {
    it("does not count the aborted run as a failure", async () => {
      executorMock.mockReturnValue({
        executeQuery: vi.fn(() => Promise.reject(BROKEN)),
        params: { timeWindow: { start: 1_000, end: 2_000 }, granularitySeconds: 3600 },
      });
      render(boardWidget({}));
      const aborted = new AbortController();
      aborted.abort();

      await act(async () => {
        await lastFrameProps()
          .executeQuery({ queryName: "main", params: {}, signal: aborted.signal })
          .catch(() => undefined);
      });

      expect(screen.queryByTestId("widget-state-face")).toBeNull();
    });
  });
});
