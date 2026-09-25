/**
 * @vitest-environment jsdom
 * The alert bell is deliberately excluded from both surfaces (neither has a
 * `series` to threshold) — this test pins that exclusion staying in place.
 */

import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../custom-graph.tsx", () => ({
  CustomGraph: () => <div data-testid="builder-graph" />,
}));

vi.mock("../langwatch-ql-dashboard-widget.tsx", () => ({
  LangWatchQLDashboardWidget: ({
    chartId,
    granularitySeconds,
  }: {
    chartId: string;
    granularitySeconds?: number;
  }) => (
    <div
      data-testid="workbench-widget"
      data-chart-id={chartId}
      data-granularity={granularitySeconds ?? "unset"}
    />
  ),
}));

// The card and its menu read tRPC hooks at render (rename/save, "Add to
// dashboard"), and the dashboard's period comes from the page's selector.
// None of these scenarios exercise them, so both are stubbed rather than
// provided — the claim here is which body a card draws.
vi.mock("../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({
      dashboardWidgets: { list: { invalidate: vi.fn() } },
      graphs: { getAll: { invalidate: vi.fn() } },
    }),
    dashboards: {
      getOrCreateFirst: { useQuery: () => ({ data: undefined }) },
    },
    dashboardWidgets: {
      assignDashboard: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      update: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("@langwatch/analytics-browser-kit", () => ({
  usePeriodSelector: () => ({
    period: { startDate: new Date(0), endDate: new Date(1) },
  }),
}));

vi.mock("../dashboard-widget-in-place-editor.tsx", () => ({
  DashboardWidgetInPlaceEditor: () => null,
}));

vi.mock("../dashboard-widget-frame.tsx", () => ({
  DashboardWidgetFrame: ({ id, graph }: { id: string; graph: unknown }) => (
    <div data-testid="dashboard-widget" data-id={id} data-graph={JSON.stringify(graph)} />
  ),
}));

import {
  DASHBOARD_SRCDOC_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
} from "../../../model/chart-kinds.ts";
import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";
import { DraggableGraphCard } from "../draggable-graph-card.tsx";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <AnalyticsTestHarness host={new StubAnalyticsHost()}>{children}</AnalyticsTestHarness>
);

const BUILDER_PAYLOAD = {
  graphType: "line",
  series: [{ name: "p95 latency", key: "latency", aggregation: "p95" }],
  includePrevious: false,
  timeScale: "full",
};

function renderCard({
  kind,
  granularitySeconds,
}: {
  kind?: string | null;
  granularitySeconds?: LangWatchQLGranularityStep | null;
} = {}) {
  return render(
    <DraggableGraphCard
      graph={{
        id: "graph_1",
        name: "p95 latency",
        graph: BUILDER_PAYLOAD,
        filters: {},
        gridColumn: 0,
        gridRow: 0,
        colSpan: 1,
        rowSpan: 1,
        ...(kind === undefined ? {} : { kind }),
        ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
        trigger: null,
      }}
      projectSlug="proj"
      projectId="project_1"
      onDelete={vi.fn()}
      isDeleting={false}
    />,
    { wrapper: Wrapper },
  );
}

afterEach(() => {
  cleanup();
});

describe("a dashboard grid card", () => {
  describe("given a builder graph", () => {
    /** @scenario "A builder card keeps the builder renderer and its alert bell" */
    it("draws the builder renderer", () => {
      renderCard({ kind: "builder" });

      expect(screen.getByTestId("builder-graph")).toBeInTheDocument();
      expect(screen.queryByTestId("workbench-widget")).not.toBeInTheDocument();
    });

    it("offers the alert bell", () => {
      renderCard({ kind: "builder" });

      expect(screen.getByRole("button", { name: /Add alert/ })).toBeInTheDocument();
    });

    it("draws the builder renderer for a row carrying no kind at all", () => {
      // Rows predate the discriminator; absent has to keep reading as builder,
      // or every chart saved before this column existed stops rendering.
      renderCard();

      expect(screen.getByTestId("builder-graph")).toBeInTheDocument();
    });
  });

  describe("given a saved workbench chart", () => {
    /** @scenario "A placed workbench card draws the widget, not the builder" */
    it("draws the widget rather than the builder renderer", () => {
      renderCard({ kind: WORKBENCH_SQL_CHART_KIND });

      expect(screen.getByTestId("workbench-widget")).toBeInTheDocument();
      expect(screen.queryByTestId("builder-graph")).not.toBeInTheDocument();
    });

    /** @scenario "A workbench card is not offered an alert it cannot evaluate" */
    it("offers no alert bell", () => {
      renderCard({ kind: WORKBENCH_SQL_CHART_KIND });

      expect(screen.queryByRole("button", { name: /Add alert/ })).not.toBeInTheDocument();
    });

    it("passes the stored step through to the widget", () => {
      renderCard({
        kind: WORKBENCH_SQL_CHART_KIND,
        granularitySeconds: 3600,
      });

      expect(screen.getByTestId("workbench-widget")).toHaveAttribute("data-granularity", "3600");
    });

    it("passes no step when the row carries none, leaving the widget its default", () => {
      // A null must not arrive as a step: the widget's own default is what a
      // card with nothing stored should run at.
      renderCard({
        kind: WORKBENCH_SQL_CHART_KIND,
        granularitySeconds: null,
      });

      expect(screen.getByTestId("workbench-widget")).toHaveAttribute("data-granularity", "unset");
    });
  });

  describe("given a dashboard widget", () => {
    const DASHBOARD_WIDGET_PAYLOAD = {
      version: 1,
      code: "export default function Widget() { return null; }",
      queries: [{ name: "main", sql: "SELECT 1" }],
    };

    /** @scenario "A dashboard widget card draws the sandboxed widget, not the builder" */
    it("draws the sandboxed dashboard widget frame rather than the builder renderer", () => {
      render(
        <DraggableGraphCard
          graph={{
            id: "graph_1",
            name: "Error rate",
            graph: DASHBOARD_WIDGET_PAYLOAD,
            filters: {},
            gridColumn: 0,
            gridRow: 0,
            colSpan: 1,
            rowSpan: 1,
            kind: DASHBOARD_SRCDOC_CHART_KIND,
            trigger: null,
          }}
          projectSlug="proj"
          projectId="project_1"
          onDelete={vi.fn()}
          isDeleting={false}
        />,
        { wrapper: Wrapper },
      );

      const widget = screen.getByTestId("dashboard-widget");
      expect(widget).toBeInTheDocument();
      expect(widget).toHaveAttribute("data-id", "graph_1");
      expect(JSON.parse(widget.getAttribute("data-graph") ?? "null")).toEqual(
        DASHBOARD_WIDGET_PAYLOAD,
      );
      expect(screen.queryByTestId("builder-graph")).not.toBeInTheDocument();
      expect(screen.queryByTestId("workbench-widget")).not.toBeInTheDocument();
    });

    /** @scenario "A dashboard widget card is not offered an alert it cannot evaluate" */
    it("offers no alert bell", () => {
      render(
        <DraggableGraphCard
          graph={{
            id: "graph_1",
            name: "Error rate",
            graph: DASHBOARD_WIDGET_PAYLOAD,
            filters: {},
            gridColumn: 0,
            gridRow: 0,
            colSpan: 1,
            rowSpan: 1,
            kind: DASHBOARD_SRCDOC_CHART_KIND,
            trigger: null,
          }}
          projectSlug="proj"
          projectId="project_1"
          onDelete={vi.fn()}
          isDeleting={false}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByRole("button", { name: /Add alert/ })).not.toBeInTheDocument();
    });
  });
});
