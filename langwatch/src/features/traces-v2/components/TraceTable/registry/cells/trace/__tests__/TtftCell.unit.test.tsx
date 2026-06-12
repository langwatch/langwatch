/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { TraceListItem } from "../../../../../../types/trace";
import {
  TraceStatisticsProvider,
  useTraceStatistics,
} from "../../../../traceStatisticsContext";
import type { CellRenderContext } from "../../../types";
import { TtftCell } from "../TtftCell";

function makeTrace(overrides: Partial<TraceListItem> = {}): TraceListItem {
  return {
    traceId: `trace-${Math.random().toString(36).slice(2)}`,
    timestamp: 1700000000000,
    name: "test-trace",
    serviceName: "test-service",
    durationMs: 1000,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    status: "success" as TraceListItem["status"],
    spanCount: 1,
    input: null,
    output: null,
    origin: "application",
    evaluations: [],
    events: [],
    ...overrides,
  };
}

function makeCellContext(row: TraceListItem): CellRenderContext<TraceListItem> {
  return {
    row,
    density: {} as CellRenderContext<TraceListItem>["density"],
    densityMode: "compact",
    isExpanded: false,
    isSelected: false,
    isFocused: false,
    actions: {},
    enabledAddonIds: [],
  };
}

function renderWithProvider({
  traces,
  children,
}: {
  traces: TraceListItem[];
  children: ReactNode;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceStatisticsProvider traces={traces}>
        {children}
      </TraceStatisticsProvider>
    </ChakraProvider>,
  );
}

afterEach(cleanup);

/** Probe that prints the computed statistics so tests can assert on them. */
function StatsProbe() {
  const stats = useTraceStatistics();
  return (
    <div data-testid="stats">
      {`duration:${stats.p95DurationMs.toFixed(1)};hasData:${stats.hasData};ttft:${stats.p95TtftMs.toFixed(1)};hasTtftData:${stats.hasTtftData}`}
    </div>
  );
}

describe("TraceStatisticsProvider", () => {
  describe("given a page where durations and TTFTs differ", () => {
    describe("when statistics are computed", () => {
      /** @scenario TTFT cell bar scales to the visible page's TTFT p95 */
      it("computes the TTFT p95 from ttft values only, independent of durations", () => {
        const traces = [
          makeTrace({ durationMs: 10_000, ttft: 100 }),
          makeTrace({ durationMs: 20_000, ttft: 200 }),
          makeTrace({ durationMs: 30_000, ttft: 300 }),
        ];
        const { getByTestId } = renderWithProvider({
          traces,
          children: <StatsProbe />,
        });
        const text = getByTestId("stats").textContent!;
        // p95 of [100, 200, 300] = 290; durations would give 29000.
        expect(text).toContain("ttft:290.0");
        expect(text).toContain("hasTtftData:true");
        expect(text).toContain("duration:29000.0");
      });
    });
  });

  describe("given a page where no trace has a TTFT", () => {
    describe("when statistics are computed", () => {
      it("reports hasTtftData false while duration stats stay available", () => {
        const traces = [
          makeTrace({ durationMs: 1000 }),
          makeTrace({ durationMs: 2000 }),
        ];
        const { getByTestId } = renderWithProvider({
          traces,
          children: <StatsProbe />,
        });
        const text = getByTestId("stats").textContent!;
        expect(text).toContain("hasTtftData:false");
        expect(text).toContain("hasData:true");
      });
    });
  });

  describe("given traces with TTFT but zero durations", () => {
    describe("when statistics are computed", () => {
      it("still computes TTFT stats", () => {
        const traces = [
          makeTrace({ durationMs: 0, ttft: 400 }),
          makeTrace({ durationMs: 0, ttft: 600 }),
        ];
        const { getByTestId } = renderWithProvider({
          traces,
          children: <StatsProbe />,
        });
        const text = getByTestId("stats").textContent!;
        expect(text).toContain("hasData:false");
        expect(text).toContain("hasTtftData:true");
      });
    });
  });
});

describe("TtftCell", () => {
  describe("given a trace with a TTFT value", () => {
    describe("when the cell renders", () => {
      /** @scenario TTFT cell bar scales to the visible page's TTFT p95 */
      it("shows the formatted TTFT with an inline bar", () => {
        const row = makeTrace({ ttft: 800 });
        const { container } = renderWithProvider({
          traces: [row, makeTrace({ ttft: 1600 })],
          children: <>{TtftCell.render(makeCellContext(row))}</>,
        });
        expect(container.textContent).toContain("800ms");
        // The latency bar track renders alongside the value.
        expect(container.querySelectorAll("div[class]").length).toBeGreaterThan(
          1,
        );
      });

      it("renders the comfortable density variant with the value", () => {
        const row = makeTrace({ ttft: 2300 });
        const { container } = renderWithProvider({
          traces: [row],
          children: <>{TtftCell.renderComfortable!(makeCellContext(row))}</>,
        });
        expect(container.textContent).toContain("2.3s");
      });
    });
  });

  describe("given a trace without a TTFT value", () => {
    describe("when the cell renders", () => {
      /** @scenario TTFT cell without a value shows no bar */
      it("shows a dash and no bar", () => {
        const row = makeTrace();
        const { container } = renderWithProvider({
          traces: [row],
          children: <>{TtftCell.render(makeCellContext(row))}</>,
        });
        expect(container.textContent).toContain("—");
        expect(container.textContent).not.toContain("ms");
      });
    });
  });
});
