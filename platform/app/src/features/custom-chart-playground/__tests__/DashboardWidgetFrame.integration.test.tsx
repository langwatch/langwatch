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
import { cleanup, render } from "@testing-library/react";
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

vi.mock("../SandboxedChartFrame", () => ({
  SandboxedChartFrame: () => <div data-testid="sandboxed-frame" />,
}));

import { DashboardWidgetFrame } from "../DashboardWidgetFrame";

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
      params: { timeWindow: { start: 1_000, end: 2_000 }, granularitySeconds: 3600 },
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

    expect(executorMock).toHaveBeenCalledWith(
      "project_1",
      GRAPH.queries,
      { timeWindow: { start: 1_000, end: 2_000 } },
    );
  });

  /** @scenario "A placed dashboard widget follows the dashboard's period control" */
  it("re-derives the window when the dashboard's period changes", () => {
    periodMock.mockReturnValue(period(1_000, 2_000));
    executorMock.mockReturnValue({
      executeQuery: vi.fn(),
      params: { timeWindow: { start: 1_000, end: 2_000 }, granularitySeconds: 3600 },
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

    expect(executorMock).toHaveBeenLastCalledWith(
      "project_1",
      GRAPH.queries,
      { timeWindow: { start: 5_000, end: 9_000 } },
    );
  });
});
