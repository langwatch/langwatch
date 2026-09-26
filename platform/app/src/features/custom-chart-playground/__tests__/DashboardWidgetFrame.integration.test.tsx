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
import { useWidgetRenderReceiptStore } from "../renderReceipt/widgetRenderReceiptStore";
import type { SandboxedChartFrameProps } from "../SandboxedChartFrame";

const lastFrameProps = (): SandboxedChartFrameProps =>
  frameProps.mock.calls.at(-1)?.[0] as SandboxedChartFrameProps;

const GRAPH = {
  version: 1,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "main", sql: "SELECT 1" }],
};

const period = ({ startMs, endMs }: { startMs: number; endMs: number }) => ({
  period: { startDate: new Date(startMs), endDate: new Date(endMs) },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given a placed dashboard widget", () => {
  describe("when it mounts", () => {
    /** @scenario "A placed dashboard widget follows the dashboard's period control" */
    it("hands the executor the dashboard's own period as its time window", () => {
      periodMock.mockReturnValue(period({ startMs: 1_000, endMs: 2_000 }));
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

      expect(executorMock).toHaveBeenCalledWith("project_1", GRAPH.queries, {
        timeWindow: { start: 1_000, end: 2_000 },
      });
    });
  });

  describe("when the dashboard's period changes", () => {
    /** @scenario "A placed dashboard widget follows the dashboard's period control" */
    it("re-derives the window from the new period", () => {
      periodMock.mockReturnValue(period({ startMs: 1_000, endMs: 2_000 }));
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
            projectSlug="project"
            maxHeight={300}
          />
        </ChakraProvider>,
      );

      periodMock.mockReturnValue(period({ startMs: 5_000, endMs: 9_000 }));
      rerender(
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

      expect(executorMock).toHaveBeenLastCalledWith(
        "project_1",
        GRAPH.queries,
        {
          timeWindow: { start: 5_000, end: 9_000 },
        },
      );
    });
  });
});

describe("a dashboard that refreshes on a schedule", () => {
  /** @scenario "Every chart on the dashboard refreshes on a schedule" */
  it("hands each refresh tick to the frame as a dashboard context change", () => {
    periodMock.mockReturnValue(period({ startMs: 1_000, endMs: 2_000 }));
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
    periodMock.mockReturnValue(period({ startMs: 1_000, endMs: 2_000 }));
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

describe("a widget that reports what it rendered", () => {
  const receiptExecutor = () => ({
    executeQuery: vi.fn(),
    params: {
      timeWindow: { start: 1_000, end: 2_000 },
      granularitySeconds: 3600,
    },
  });

  afterEach(() => {
    useWidgetRenderReceiptStore.getState().clear();
  });

  /** @scenario "The dashboard page keeps the latest receipt per widget" */
  it("publishes the frame's receipt to the store with its host context", () => {
    periodMock.mockReturnValue(period({ startMs: 1_000, endMs: 2_000 }));
    executorMock.mockReturnValue(receiptExecutor());

    render(
      <ChakraProvider value={defaultSystem}>
        <DashboardWidgetFrame
          id="graph_1"
          graph={GRAPH}
          projectId="project_1"
          projectSlug="project"
          maxHeight={300}
          dashboardId="dash_1"
          widgetName="Cost by model"
        />
      </ChakraProvider>,
    );

    act(() => {
      lastFrameProps().onRenderReceipt?.({
        status: "ok",
        markup: '<div id="lw-root"><svg /></div>',
        isMarkupTruncated: false,
        height: 240,
      });
    });

    const receipt = useWidgetRenderReceiptStore.getState().receipts.graph_1;
    expect(receipt).toBeDefined();
    expect(receipt?.widgetId).toBe("graph_1");
    expect(receipt?.widgetName).toBe("Cost by model");
    expect(receipt?.dashboardId).toBe("dash_1");
    expect(receipt?.theme).toBe("light");
    expect(receipt?.timeWindow).toEqual({ start: 1_000, end: 2_000 });
    expect(receipt?.status).toBe("ok");
    expect(typeof receipt?.capturedAt).toBe("number");
  });

  /** @scenario "The dashboard page keeps the latest receipt per widget" */
  it("drops the receipt when the card leaves the grid", () => {
    periodMock.mockReturnValue(period({ startMs: 1_000, endMs: 2_000 }));
    executorMock.mockReturnValue(receiptExecutor());

    const { unmount } = render(
      <ChakraProvider value={defaultSystem}>
        <DashboardWidgetFrame
          id="graph_1"
          graph={GRAPH}
          projectId="project_1"
          projectSlug="project"
          maxHeight={300}
          dashboardId="dash_1"
        />
      </ChakraProvider>,
    );

    act(() => {
      lastFrameProps().onRenderReceipt?.({
        status: "ok",
        markup: "<div/>",
        isMarkupTruncated: false,
        height: 100,
      });
    });
    expect(
      useWidgetRenderReceiptStore.getState().receipts.graph_1,
    ).toBeDefined();

    unmount();
    expect(
      useWidgetRenderReceiptStore.getState().receipts.graph_1,
    ).toBeUndefined();
  });

  /** @scenario "The dashboard page clears a receipt when the frame stops responding" */
  it("clears the receipt when the frame's watchdog tears it down", () => {
    periodMock.mockReturnValue(period({ startMs: 1_000, endMs: 2_000 }));
    executorMock.mockReturnValue(receiptExecutor());

    render(
      <ChakraProvider value={defaultSystem}>
        <DashboardWidgetFrame
          id="graph_1"
          graph={GRAPH}
          projectId="project_1"
          projectSlug="project"
          maxHeight={300}
          dashboardId="dash_1"
        />
      </ChakraProvider>,
    );

    act(() => {
      lastFrameProps().onRenderReceipt?.({
        status: "ok",
        markup: "<div/>",
        isMarkupTruncated: false,
        height: 100,
      });
    });
    expect(
      useWidgetRenderReceiptStore.getState().receipts.graph_1,
    ).toBeDefined();

    // The watchdog tore the frame down: the "stopped responding" panel is on
    // screen, so the last "ok" receipt is stale and must not be readable.
    act(() => {
      lastFrameProps().onFrameRunningChange?.(false);
    });
    expect(
      useWidgetRenderReceiptStore.getState().receipts.graph_1,
    ).toBeUndefined();
  });

  /** @scenario "The dashboard page clears stale receipts when the frame cannot be rendered" */
  it("clears the receipt when the graph definition becomes invalid", () => {
    periodMock.mockReturnValue(period({ startMs: 1_000, endMs: 2_000 }));
    executorMock.mockReturnValue(receiptExecutor());

    const { rerender } = render(
      <ChakraProvider value={defaultSystem}>
        <DashboardWidgetFrame
          id="graph_1"
          graph={GRAPH}
          projectId="project_1"
          projectSlug="project"
          maxHeight={300}
          dashboardId="dash_1"
        />
      </ChakraProvider>,
    );

    act(() => {
      lastFrameProps().onRenderReceipt?.({
        status: "ok",
        markup: "<div/>",
        isMarkupTruncated: false,
        height: 100,
      });
    });
    expect(
      useWidgetRenderReceiptStore.getState().receipts.graph_1,
    ).toBeDefined();

    rerender(
      <ChakraProvider value={defaultSystem}>
        <DashboardWidgetFrame
          id="graph_1"
          graph={null as any}
          projectId="project_1"
          projectSlug="project"
          maxHeight={300}
          dashboardId="dash_1"
        />
      </ChakraProvider>,
    );

    expect(
      useWidgetRenderReceiptStore.getState().receipts.graph_1,
    ).toBeUndefined();
  });
});
