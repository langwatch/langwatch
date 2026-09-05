/**
 * @vitest-environment jsdom
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { StubAnalyticsHost, AnalyticsTestHarness } from "../../../testing";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";

vi.mock("../custom-graph", () => ({
  CustomGraph: () => <div data-testid="builder-graph" />,
}));

vi.mock("../langwatch-ql-dashboard-widget", () => ({
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

import { WORKBENCH_SQL_CHART_KIND } from "../../../model/chart-kinds";

import { DraggableGraphCard } from "../draggable-graph-card";

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
      onSizeChange={vi.fn()}
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

    /**
     * THE ALERT BELL IS GONE, and this scenario says so rather than pretending. `platform/app`
     * asserted the bell was offered on a builder card; the two call sites behind it opened the
     * automations drawer, whose registry entry was deleted when that family moved.
     */
    it("offers no way to author an alert", () => {
      renderCard({ kind: "builder" });

      expect(screen.queryByRole("button", { name: /alert/i })).not.toBeInTheDocument();
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
});
