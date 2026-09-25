/**
 * @vitest-environment jsdom
 */

/**
 * The grid with the real DashboardWidgetFrame and stubbed leaves (executor,
 * sandboxed frame): proves a period change reaches all nine widgets' queries.
 * @see modules/analytics/specs/analytics-v2.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_V2_WIDGETS } from "../model/analytics-v2-widgets.ts";
import { AnalyticsV2Grid } from "../ui/sections/analytics-v2-grid.tsx";

const instant = (iso: string) => ({ epochMilliseconds: new Date(iso).getTime() });

const state = vi.hoisted(() => ({
  period: {
    startDate: { epochMilliseconds: new Date("2026-01-01T00:00:00.000Z").getTime() },
    endDate: { epochMilliseconds: new Date("2026-01-02T00:00:00.000Z").getTime() },
  },
  executorCalls: [] as {
    queries: unknown;
    timeWindow: { start: number; end: number } | undefined;
  }[],
  chartWindows: new Map<string, { start: number; end: number }>(),
}));

vi.mock("@langwatch/analytics-browser-kit", () => ({
  usePeriodSelector: () => ({
    period: state.period,
    mode: "relative" as const,
    isDefault: true,
  }),
}));

vi.mock("@langwatch/design-system/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));

vi.mock("../../../ui/sections/use-dashboard-auto-refresh.ts", () => ({
  useDashboardRefreshedAt: () => undefined,
}));

vi.mock("../../../behavior/use-dashboard-widget-chart-navigate.ts", () => ({
  useDashboardWidgetChartNavigate: () => () => undefined,
}));

vi.mock("../../../behavior/use-dashboard-widget-executor.ts", () => ({
  useDashboardWidgetExecutor: (
    _projectId: string,
    queries: unknown,
    overrides?: { timeWindow?: { start: number; end: number } },
  ) => {
    state.executorCalls.push({ queries, timeWindow: overrides?.timeWindow });
    return {
      executeQuery: vi.fn(),
      runStandalone: vi.fn(),
      lastRuns: {},
      params: {
        timeWindow: overrides?.timeWindow ?? { start: 0, end: 0 },
        granularitySeconds: 3600,
      },
    };
  },
}));

vi.mock("../../../ui/sections/sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: (props: {
    dashboardContext: {
      widgetId: string;
      timeWindow: { start: number; end: number };
    };
  }) => {
    state.chartWindows.set(props.dashboardContext.widgetId, props.dashboardContext.timeWindow);
    return <div data-testid="chart-frame" />;
  },
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const FEBRUARY = {
  startDate: instant("2026-02-01T00:00:00.000Z"),
  endDate: instant("2026-02-02T00:00:00.000Z"),
};

describe("the Analytics v2 grid with the real widget frame", () => {
  beforeEach(() => {
    state.period = {
      startDate: instant("2026-01-01T00:00:00.000Z"),
      endDate: instant("2026-01-02T00:00:00.000Z"),
    };
    state.executorCalls = [];
    state.chartWindows = new Map();
  });
  afterEach(cleanup);

  describe("when the member picks a different period", () => {
    /** @scenario "Changing the period re-queries every chart" */
    it("hands every one of the nine widgets' queries the new time window", () => {
      const { rerender } = render(<AnalyticsV2Grid projectId="project_1" projectSlug="acme" />, {
        wrapper: Wrapper,
      });

      state.period = FEBRUARY;
      state.executorCalls = [];
      rerender(<AnalyticsV2Grid projectId="project_1" projectSlug="acme" />);

      const expected = {
        start: FEBRUARY.startDate.epochMilliseconds,
        end: FEBRUARY.endDate.epochMilliseconds,
      };
      expect(state.executorCalls).toHaveLength(9);
      for (const widget of ANALYTICS_V2_WIDGETS) {
        // The frame schema-parses the definition, so its queries arrive as an
        // equal copy, not the same array.
        const call = state.executorCalls.find(
          (c) => JSON.stringify(c.queries) === JSON.stringify(widget.definition.queries),
        );
        expect(call?.timeWindow).toEqual(expected);
        expect(state.chartWindows.get(widget.id)).toEqual(expected);
      }
    });
  });
});
