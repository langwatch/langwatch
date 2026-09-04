/**
 * @vitest-environment jsdom
 *
 * The period a placed dashboard widget runs its queries against.
 *
 * `LangWatchQLDashboardWidget` reads the dashboard's own period control
 * (`usePeriodSelector`) rather than owning one — one control moves every
 * card, which is what makes the cards comparable. This pins that
 * `DashboardWidgetFrame` reads the SAME control and re-derives its
 * window when it changes, rather than the playground editor's fixed
 * "last 24 hours from mount" default the underlying executor hook falls
 * back to when no override is given.
 *
 * `useDashboardWidgetExecutor` itself is mocked to a spy: the claim here is
 * which `timeWindow` the widget HANDS the executor, not what the executor
 * does with it (that belongs to useDashboardWidgetExecutor's own tests).
 *
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { periodMock, executorMock } = vi.hoisted(() => ({
  periodMock: vi.fn(),
  executorMock: vi.fn(),
}));

vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => periodMock(),
}));

vi.mock("../useDashboardWidgetExecutor", () => ({
  useDashboardWidgetExecutor: (...args: unknown[]) => executorMock(...args),
}));

const { frameProps } = vi.hoisted(() => ({
  frameProps: vi.fn(),
}));

vi.mock("../SandboxedChartFrame", () => ({
  SandboxedChartFrame: (props: unknown) => {
    frameProps(props);
    return <div data-testid="sandboxed-frame" />;
  },
}));

import { DashboardRefreshedAtContext } from "~/components/analytics/useDashboardAutoRefresh";
import { DashboardWidgetFrame } from "../DashboardWidgetFrame";
import type { SandboxedChartFrameProps } from "../SandboxedChartFrame";

const lastFrameProps = (): SandboxedChartFrameProps =>
  frameProps.mock.calls.at(-1)?.[0] as SandboxedChartFrameProps;

const GRAPH = {
  version: 1,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "main", sql: "SELECT 1" }],
};

const period = (startMs: number, endMs: number) => ({
  period: { startDate: new Date(startMs), endDate: new Date(endMs) },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a placed dashboard widget", () => {
  /** @scenario "A placed dashboard widget follows the dashboard's period control" */
  it("hands the executor the dashboard's own period as its time window", () => {
    periodMock.mockReturnValue(period(1_000, 2_000));
    executorMock.mockReturnValue({
      executeQuery: vi.fn(),
      params: {
        timeWindow: { start: 1_000, end: 2_000 },
        granularitySeconds: 3600,
      },
    });

    render(
      <ChakraProvider value={defaultSystem}>
        <DashboardWidgetFrame
          id="graph_1"
          graph={GRAPH}
          projectId="project_1"
          maxHeight={300}
        />
      </ChakraProvider>,
    );

    expect(executorMock).toHaveBeenCalledWith("project_1", GRAPH.queries, {
      timeWindow: { start: 1_000, end: 2_000 },
    });
  });

  /** @scenario "A placed dashboard widget follows the dashboard's period control" */
  it("re-derives the window when the dashboard's period changes", () => {
    periodMock.mockReturnValue(period(1_000, 2_000));
    executorMock.mockReturnValue({
      executeQuery: vi.fn(),
      params: {
        timeWindow: { start: 1_000, end: 2_000 },
        granularitySeconds: 3600,
      },
    });

    const { rerender } = render(
      <ChakraProvider value={defaultSystem}>
        <DashboardWidgetFrame
          id="graph_1"
          graph={GRAPH}
          projectId="project_1"
          maxHeight={300}
        />
      </ChakraProvider>,
    );

    periodMock.mockReturnValue(period(5_000, 9_000));
    rerender(
      <ChakraProvider value={defaultSystem}>
        <DashboardWidgetFrame
          id="graph_1"
          graph={GRAPH}
          projectId="project_1"
          maxHeight={300}
        />
      </ChakraProvider>,
    );

    expect(executorMock).toHaveBeenLastCalledWith("project_1", GRAPH.queries, {
      timeWindow: { start: 5_000, end: 9_000 },
    });
  });
});

describe("a dashboard that refreshes on a schedule", () => {
  /** @scenario "Every chart on the dashboard refreshes on a schedule" */
  it("hands each refresh tick to the frame as a dashboard context change", () => {
    periodMock.mockReturnValue(period(1_000, 2_000));
    executorMock.mockReturnValue({
      executeQuery: vi.fn(),
      params: {
        timeWindow: { start: 1_000, end: 2_000 },
        granularitySeconds: 3600,
      },
    });

    const ui = (refreshedAt: number | undefined) => (
      <ChakraProvider value={defaultSystem}>
        <DashboardRefreshedAtContext.Provider value={refreshedAt}>
          <DashboardWidgetFrame
            id="graph_1"
            graph={GRAPH}
            projectId="project_1"
            projectSlug="project"
            maxHeight={300}
          />
        </DashboardRefreshedAtContext.Provider>
      </ChakraProvider>
    );

    const { rerender } = render(ui(undefined));
    expect(lastFrameProps().dashboardContext.refreshedAt).toBeUndefined();
    const before = lastFrameProps().dashboardContext;

    rerender(ui(123_456));
    const after = lastFrameProps().dashboardContext;
    expect(after.refreshedAt).toBe(123_456);
    expect(after).not.toBe(before);
  });
});

describe("a widget whose code reports an error", () => {
  /** @scenario "A widget's own error is shown, not dropped" */
  it("shows a warning on the card instead of dropping the report", () => {
    periodMock.mockReturnValue(period(1_000, 2_000));
    executorMock.mockReturnValue({
      executeQuery: vi.fn(),
      params: {
        timeWindow: { start: 1_000, end: 2_000 },
        granularitySeconds: 3600,
      },
    });

    render(
      <ChakraProvider value={defaultSystem}>
        <DashboardWidgetFrame
          id="graph_1"
          graph={GRAPH}
          projectId="project_1"
          projectSlug="project"
          maxHeight={300}
        />
      </ChakraProvider>,
    );
    expect(screen.queryByTestId("frame-diagnostic-badge")).toBeNull();

    act(() => {
      lastFrameProps().onLog({
        level: "error",
        source: "lw.error",
        text: "Render error: cannot read x of undefined",
      });
    });
    expect(screen.getByTestId("frame-diagnostic-badge")).toBeTruthy();
    // The frame itself is left alone: same mock instance, no remount.
    expect(screen.getByTestId("sandboxed-frame")).toBeTruthy();
  });
});
