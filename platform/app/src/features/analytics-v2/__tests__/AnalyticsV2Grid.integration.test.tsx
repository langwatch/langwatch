/**
 * @vitest-environment jsdom
 *
 * The Analytics v2 grid with the REAL `DashboardWidgetFrame`: proves a period
 * change reaches the query boundary of all nine widgets. Only the leaves are
 * stubbed — the query executor (records what each widget would query, and for
 * which window) and the sandboxed iframe (records the time window the chart
 * code would read) — so the path period selector -> frame -> executor ->
 * chart context is the production one.
 *
 * @see specs/analytics/analytics-v2.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsV2Grid } from "../AnalyticsV2Grid";
import { ANALYTICS_V2_WIDGETS } from "../widgets";

const state = vi.hoisted(() => ({
  period: {
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2026-01-02T00:00:00.000Z"),
  },
  executorCalls: [] as {
    queries: unknown;
    timeWindow: { start: number; end: number } | undefined;
  }[],
  chartWindows: new Map<string, { start: number; end: number }>(),
}));

vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => ({
    period: state.period,
    mode: "relative" as const,
    isDefault: true,
  }),
}));

vi.mock("~/components/ui/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));

vi.mock("~/components/analytics/useDashboardAutoRefresh", () => ({
  useDashboardRefreshedAt: () => undefined,
}));

vi.mock(
  "~/features/custom-chart-playground/useDashboardWidgetChartNavigate",
  () => ({ useDashboardWidgetChartNavigate: () => () => undefined }),
);

vi.mock(
  "~/features/custom-chart-playground/useDashboardWidgetExecutor",
  () => ({
    useDashboardWidgetExecutor: (
      _projectId: string,
      queries: unknown,
      overrides?: { timeWindow?: { start: number; end: number } },
    ) => {
      state.executorCalls.push({ queries, timeWindow: overrides?.timeWindow });
      return {
        executeQuery: vi.fn(),
        params: {
          timeWindow: overrides?.timeWindow ?? { start: 0, end: 0 },
          granularitySeconds: 3600,
        },
      };
    },
  }),
);

vi.mock("~/features/custom-chart-playground/SandboxedChartFrame", () => ({
  SandboxedChartFrame: (props: {
    dashboardContext: {
      widgetId: string;
      timeWindow: { start: number; end: number };
    };
  }) => {
    state.chartWindows.set(
      props.dashboardContext.widgetId,
      props.dashboardContext.timeWindow,
    );
    return <div data-testid="chart-frame" />;
  },
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const FEBRUARY = {
  startDate: new Date("2026-02-01T00:00:00.000Z"),
  endDate: new Date("2026-02-02T00:00:00.000Z"),
};

describe("the Analytics v2 grid with the real widget frame", () => {
  beforeEach(() => {
    state.period = {
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-01-02T00:00:00.000Z"),
    };
    state.executorCalls = [];
    state.chartWindows = new Map();
  });
  afterEach(cleanup);

  describe("when the member picks a different period", () => {
    /** @scenario "Changing the period re-queries every chart" */
    it("hands every one of the nine widgets' queries the new time window", () => {
      const { rerender } = render(
        <AnalyticsV2Grid projectId="project_1" projectSlug="acme" />,
        { wrapper: Wrapper },
      );

      state.period = FEBRUARY;
      state.executorCalls = [];
      rerender(<AnalyticsV2Grid projectId="project_1" projectSlug="acme" />);

      const expected = {
        start: FEBRUARY.startDate.getTime(),
        end: FEBRUARY.endDate.getTime(),
      };
      expect(state.executorCalls).toHaveLength(9);
      for (const widget of ANALYTICS_V2_WIDGETS) {
        // The frame schema-parses the definition, so its queries arrive as an
        // equal copy, not the same array.
        const call = state.executorCalls.find(
          (c) =>
            JSON.stringify(c.queries) ===
            JSON.stringify(widget.definition.queries),
        );
        expect(call?.timeWindow).toEqual(expected);
        expect(state.chartWindows.get(widget.id)).toEqual(expected);
      }
    });
  });
});
