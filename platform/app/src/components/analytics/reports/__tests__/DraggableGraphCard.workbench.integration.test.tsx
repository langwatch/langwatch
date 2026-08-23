/**
 * @vitest-environment jsdom
 *
 * Which body a card draws, and which header controls it offers.
 *
 * The routing is decided by one field — `kind` — and both directions of getting
 * it wrong are silent. A workbench row sent to `CustomGraph` hands a builder
 * renderer a saved SQL statement in place of the series payload it expects; a
 * builder row sent to the widget asks the saved-chart procedures for a row they
 * will not find. Neither shows up as a type error, because `graph` is `unknown`
 * on the way through.
 *
 * The alert bell is the same shape of mistake with a longer fuse. The alert path
 * reads a builder payload's `series` to name what it thresholds, and a saved
 * statement has no series to read — so a bell offered on a workbench card
 * authors an alert the threshold dispatcher can never evaluate. It is excluded
 * on purpose, and this pins that it stays excluded.
 *
 * Both children are mocked to markers: the claim is *which* component receives
 * the row, and mounting the real Vega and tRPC stacks to prove it would test the
 * harness instead.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LangWatchQLGranularityStep } from "~/server/analytics/lwql/timeWindow";

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock("~/utils/compat/next-router", () => {
  const router = { query: {}, asPath: "/", push: vi.fn(), replace: vi.fn() };
  return { useRouter: () => router, default: router };
});

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: undefined,
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("~/components/analytics/CustomGraph", () => ({
  CustomGraph: () => <div data-testid="builder-graph" />,
}));

vi.mock(
  "~/features/analytics-query/components/LangWatchQLDashboardWidget",
  () => ({
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
  }),
);

import { WORKBENCH_SQL_CHART_KIND } from "~/server/analytics/chartKinds";

import { DraggableGraphCard } from "../DraggableGraphCard";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
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

    it("offers the alert bell", () => {
      renderCard({ kind: "builder" });

      expect(
        screen.getByRole("button", { name: /Add alert/ }),
      ).toBeInTheDocument();
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

      expect(
        screen.queryByRole("button", { name: /Add alert/ }),
      ).not.toBeInTheDocument();
    });

    it("passes the stored step through to the widget", () => {
      renderCard({
        kind: WORKBENCH_SQL_CHART_KIND,
        granularitySeconds: 3600,
      });

      expect(screen.getByTestId("workbench-widget")).toHaveAttribute(
        "data-granularity",
        "3600",
      );
    });

    it("passes no step when the row carries none, leaving the widget its default", () => {
      // A null must not arrive as a step: the widget's own default is what a
      // card with nothing stored should run at.
      renderCard({
        kind: WORKBENCH_SQL_CHART_KIND,
        granularitySeconds: null,
      });

      expect(screen.getByTestId("workbench-widget")).toHaveAttribute(
        "data-granularity",
        "unset",
      );
    });
  });
});
