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

const { periodMock, executorMock, frameProps, navigateMock } = vi.hoisted(() => ({
  periodMock: vi.fn(),
  executorMock: vi.fn(),
  frameProps: vi.fn<(props: SandboxedChartFrameProps) => void>(),
  navigateMock: vi.fn(),
}));

vi.mock("../../../../../behavior/use-analytics-period.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAnalyticsPeriod: () => periodMock(),
}));

vi.mock("../../../behavior/use-dashboard-widget-executor.ts", () => ({
  useDashboardWidgetExecutor: (...args: unknown[]) => executorMock(...args),
}));

vi.mock("../../../behavior/use-dashboard-widget-chart-navigate.ts", () => ({
  useDashboardWidgetChartNavigate: () => navigateMock,
}));

vi.mock("../sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: (props: SandboxedChartFrameProps) => {
    frameProps(props);
    return <div data-testid="sandboxed-frame">{props.cover}</div>;
  },
}));

import type { AnalyticsHostProject } from "../../../../../model/analytics-host.ts";
import { AnalyticsHostProvider } from "../../../../../model/analytics-host.ts";
import { StubAnalyticsHost } from "../../../../../testing.tsx";
import { DashboardRefreshedAtContext } from "../../../../../ui/sections/use-dashboard-auto-refresh.ts";
import {
  DashboardWidgetFrame,
  DashboardWidgetFrameOverWindow,
} from "../dashboard-widget-frame.tsx";
import type { SandboxedChartFrameProps } from "../sandboxed-chart-frame.tsx";

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

const PROJECT: AnalyticsHostProject = {
  id: "project_1",
  slug: "project",
  name: "Checkout Agent",
  hasFirstMessage: true,
};

/** The board's widget, over a window, as a board card draws it. */
const boardWidget = ({
  project = PROJECT,
  graph = GRAPH,
  ...props
}: {
  project?: AnalyticsHostProject;
  graph?: unknown;
  onAskLangyToSetUp?: (missing: { field: string; label: string }) => void;
  onEmptyChange?: (empty: boolean) => void;
}) => (
  <AnalyticsHostProvider value={new StubAnalyticsHost({ project })}>
    <DesignSystemProvider forcedTheme="light">
      <DashboardWidgetFrameOverWindow
        id="graph_1"
        graph={graph}
        projectId="project_1"
        projectSlug="project"
        maxHeight={300}
        widgetName="Cost per trace"
        timeWindow={{ start: 1_000, end: 2_000 }}
        {...props}
      />
    </DesignSystemProvider>
  </AnalyticsHostProvider>
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

/** A query the test answers when it says so. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const loadingFace = () => document.querySelector('[data-widget-state="loading"]');

describe("given a widget on a board whose queries are running", () => {
  describe("when none of its queries has answered yet", () => {
    /** @scenario "A widget shows a loading skeleton while its first query runs" */
    it("shows a skeleton until a query answers", async () => {
      const answer = deferred<unknown>();
      const run = frameRuns(() => answer.promise);
      render(boardWidget({}));
      expect(loadingFace()).not.toBeNull();
      expect(screen.getByText("Loading")).toBeTruthy();

      const running = run();
      answer.resolve(resultWith(report({})));
      await running;

      expect(loadingFace()).toBeNull();
    });
  });

  describe("when none has answered after 5 seconds", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** @scenario "A widget that loads for long says it is still loading" */
    it("says it is still loading", () => {
      vi.useFakeTimers();
      frameRuns(() => new Promise(() => undefined));
      render(boardWidget({}));
      expect(screen.queryByText("Still loading…")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(4_999);
      });
      expect(screen.queryByText("Still loading…")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(screen.getByText("Still loading…")).toBeTruthy();
    });
  });

  describe("when a query that answered runs again", () => {
    /** @scenario "A refresh keeps the chart, with no skeleton" */
    it("shows no skeleton", async () => {
      const answers: Promise<unknown>[] = [
        Promise.resolve(resultWith(report({}))),
        new Promise(() => undefined),
      ];
      const run = frameRuns(() => answers.shift() ?? new Promise(() => undefined));
      render(boardWidget({}));
      await run();
      void lastFrameProps().executeQuery({
        queryName: "main",
        params: {},
        signal: new AbortController().signal,
      });

      expect(loadingFace()).toBeNull();
    });
  });

  describe("when the frame waits to retry a busy query", () => {
    /** @scenario "A widget waiting to retry a busy query keeps its skeleton" */
    it("keeps the skeleton while no query is open", async () => {
      const run = frameRuns(() => Promise.reject(BUSY));
      render(boardWidget({}));
      await run();

      expect(loadingFace()).not.toBeNull();
    });
  });

  describe("when it has nothing to wait for", () => {
    /** @scenario "A widget with nothing to wait for shows no skeleton" */
    it("shows no skeleton for a widget with no queries", () => {
      render(boardWidget({ graph: { ...GRAPH, queries: [] } }));

      expect(loadingFace()).toBeNull();
    });

    /** @scenario "A widget with nothing to wait for shows no skeleton" */
    it("drops the skeleton once the widget's code reports an error", () => {
      frameRuns(() => new Promise(() => undefined));
      render(boardWidget({}));
      expect(loadingFace()).not.toBeNull();

      act(() => {
        lastFrameProps().onLog({ level: "error", source: "lw.error", text: "Render error" });
      });

      expect(loadingFace()).toBeNull();
    });

    /** @scenario "A widget with nothing to wait for shows no skeleton" */
    it("keeps no skeleton when a console error follows the code's own error", () => {
      frameRuns(() => new Promise(() => undefined));
      render(boardWidget({}));

      act(() => {
        lastFrameProps().onLog({ level: "error", source: "lw.error", text: "Render error" });
      });
      act(() => {
        lastFrameProps().onLog({ level: "error", source: "console", text: "noisy" });
      });

      expect(loadingFace()).toBeNull();
    });

    /** @scenario "A widget with nothing to wait for shows no skeleton" */
    it("keeps the skeleton when the widget only logs a console error while loading", () => {
      frameRuns(() => new Promise(() => undefined));
      render(boardWidget({}));

      act(() => {
        lastFrameProps().onLog({ level: "error", source: "console", text: "noisy but alive" });
      });

      expect(loadingFace()).not.toBeNull();
    });

    /** @scenario "A widget with nothing to wait for shows no skeleton" */
    it("drops the skeleton once the frame is up with no query open", () => {
      frameRuns(() => new Promise(() => undefined));
      render(boardWidget({}));
      expect(loadingFace()).not.toBeNull();

      act(() => {
        lastFrameProps().onIdleChange?.(true);
      });

      expect(loadingFace()).toBeNull();
    });
  });

  describe("when the widget's code crashed and the member retries", () => {
    /** @scenario "A widget with nothing to wait for shows no skeleton" */
    it("shows the skeleton again while the next load is pending", async () => {
      const run = frameRuns(() => Promise.reject(BROKEN));
      render(boardWidget({}));
      await run();
      act(() => {
        lastFrameProps().onLog({ level: "error", source: "lw.error", text: "Render error" });
      });

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(loadingFace()).not.toBeNull();
    });
  });

  describe("when a query starts after the frame had nothing to wait for", () => {
    /** @scenario "A query that starts after the frame was idle brings the skeleton back" */
    it("shows the skeleton again", () => {
      frameRuns(() => new Promise(() => undefined));
      render(boardWidget({}));
      act(() => {
        lastFrameProps().onIdleChange?.(true);
      });
      expect(loadingFace()).toBeNull();

      act(() => {
        lastFrameProps().onIdleChange?.(false);
      });

      expect(loadingFace()).not.toBeNull();
    });
  });
});

describe("given an empty widget on a board", () => {
  describe("when its project never received a trace and its query found no traffic", () => {
    /** @scenario "A widget in a project that never sent a trace says how to send one" */
    it("says how to send traces, and Set up tracing opens the traces page", async () => {
      const run = frameRuns(() =>
        Promise.resolve(resultWith(report({ state: "no_traffic", total: 0 }))),
      );
      render(boardWidget({ project: { ...PROJECT, hasFirstMessage: false } }));
      await run();

      expect(screen.getByText("No traces in this period")).toBeTruthy();
      expect(
        screen.getByText("Send traces with the LangWatch SDK to fill this widget."),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Set up tracing" }));
      expect(navigateMock).toHaveBeenCalledWith({ target: "traces", params: {} });
    });
  });

  describe("when its project has received traces and its query found no traffic", () => {
    /** @scenario "A quiet period offers no setup" */
    it("says the period is empty and offers no setup", async () => {
      const run = frameRuns(() =>
        Promise.resolve(resultWith(report({ state: "no_traffic", total: 0 }))),
      );
      render(boardWidget({}));
      await run();

      expect(screen.getByText("No traces in this period")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Set up tracing" })).toBeNull();
    });
  });

  describe("when its query needs the user id no trace carries", () => {
    /** @scenario "The setup view says how to send the field it needs" */
    it("names the field and the metadata key that sends it", async () => {
      const run = frameRuns(() =>
        Promise.resolve(
          resultWith(
            report({
              state: "missing",
              fields: [{ field: "UserId", label: "user", present: 0 }],
            }),
          ),
        ),
      );
      render(boardWidget({}));
      await run();

      expect(screen.getByText("Needs user")).toBeTruthy();
      expect(
        screen.getByText("Send user_id in the trace metadata with the LangWatch SDK."),
      ).toBeTruthy();
    });
  });
});

describe("given a widget whose card wants to know when it is empty", () => {
  const emptyAfter = async (answer: () => Promise<unknown>) => {
    const onEmptyChange = vi.fn();
    const run = frameRuns(answer);
    render(boardWidget({ onEmptyChange }));
    await run();
    return onEmptyChange.mock.calls.at(-1)?.[0];
  };

  /** @scenario "The frame tells its card when the widget shows no data" */
  it("says empty for no traffic, the setup view, or a query with no rows", async () => {
    expect(
      await emptyAfter(() => Promise.resolve(resultWith(report({ state: "no_traffic" })))),
    ).toBe(true);
    cleanup();
    expect(await emptyAfter(() => Promise.resolve(resultWith(MISSING_COST)))).toBe(true);
    cleanup();
    expect(await emptyAfter(() => Promise.resolve(resultWith(report({}))))).toBe(true);
  });

  /** @scenario "The frame tells its card when the widget shows no data" */
  it("says not empty for a widget with rows, or still loading", async () => {
    const withRows = { ...resultWith(report({})), rows: [{ n: 1 }] };
    expect(await emptyAfter(() => Promise.resolve(withRows))).toBe(false);
    cleanup();

    const onEmptyChange = vi.fn();
    frameRuns(() => new Promise(() => undefined));
    render(boardWidget({ onEmptyChange }));
    expect(onEmptyChange).toHaveBeenLastCalledWith(false);
  });
});
