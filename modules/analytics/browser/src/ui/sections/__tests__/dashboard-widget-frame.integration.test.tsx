// @vitest-environment jsdom
/**
 * A placed dashboard widget reads the dashboard's own period control, hands refresh
 * ticks to its frame, and shows its code's own errors on the card.
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { periodMock, executorMock, frameProps } = vi.hoisted(() => ({
  periodMock: vi.fn(),
  executorMock: vi.fn(),
  frameProps: vi.fn<(props: SandboxedChartFrameProps) => void>(),
}));

vi.mock("@langwatch/analytics-browser-kit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePeriodSelector: () => periodMock(),
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

import { DashboardWidgetFrame } from "../dashboard-widget-frame.tsx";
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
