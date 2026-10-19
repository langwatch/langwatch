/**
 * @vitest-environment jsdom
 * The alert bell is deliberately excluded from a workbench chart (it has no
 * `series` to threshold); this test pins that exclusion staying in place.
 */

import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../custom-graph.tsx", () => ({
  CustomGraph: () => <div data-testid="builder-graph" />,
}));

vi.mock("../../../features/dashboard-widget/ui/sections/langwatch-ql-dashboard-widget.tsx", () => ({
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

import { WORKBENCH_SQL_CHART_KIND } from "../../../model/chart-kinds.ts";
import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";
import { DraggableGraphCard } from "../draggable-graph-card.tsx";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <AnalyticsTestHarness host={new StubAnalyticsHost()}>{children}</AnalyticsTestHarness>
);

const BUILDER_PAYLOAD = {
  graphId: "custom",
  graphType: "line",
  series: [
    {
      name: "p95 latency",
      metric: "performance.completion_time",
      colorSet: "greenTones",
      aggregation: "p95",
    },
  ],
  includePrevious: false,
  timeScale: "full",
};

function renderCard({
  kind,
  granularitySeconds,
  payload = BUILDER_PAYLOAD,
}: {
  kind?: string | null;
  granularitySeconds?: LangWatchQLGranularityStep | null;
  payload?: Record<string, unknown>;
} = {}) {
  return render(
    <DraggableGraphCard
      graph={{
        id: "graph_1",
        name: "p95 latency",
        graph: payload,
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

    /** @scenario "A builder card keeps the builder renderer and its alert bell" */
    it("offers the alert bell", () => {
      renderCard({ kind: "builder" });

      expect(screen.getByRole("button", { name: /Add automation/ })).toBeInTheDocument();
    });

    it("says so rather than drawing a builder graph it cannot read", () => {
      renderCard({ kind: "builder", payload: { graphType: "line", series: [{ key: "latency" }] } });

      expect(screen.queryByTestId("builder-graph")).not.toBeInTheDocument();
      expect(screen.getByText(/cannot draw/)).toBeInTheDocument();
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

      expect(screen.queryByRole("button", { name: /Add automation/ })).not.toBeInTheDocument();
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
});
