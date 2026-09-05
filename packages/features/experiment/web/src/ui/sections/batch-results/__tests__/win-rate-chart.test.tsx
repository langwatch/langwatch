import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * Tests for WinRateChart.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchComparisonColumn } from "@langwatch/experiment-web";
import { WinRateChart } from "../win-rate-chart";

vi.mock("recharts", () => {
  const MockComponent = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return {
    ResponsiveContainer: MockComponent,
    // Surfaces the chart's computed data (one entry per bar, in render
    // order) as text so the test can assert on it without depending on
    // recharts' internal SVG tick rendering.
    BarChart: ({ data }: { data: Array<{ name: string }> }) => (
      <div data-testid="bar-chart-data">{data.map((d) => d.name).join(", ")}</div>
    ),
    Bar: MockComponent,
    XAxis: MockComponent,
    YAxis: MockComponent,
    CartesianGrid: MockComponent,
    Tooltip: MockComponent,
    Cell: MockComponent,
    LabelList: MockComponent,
  };
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
});

const createColumn = (overrides: Partial<BatchComparisonColumn> = {}): BatchComparisonColumn => ({
  evaluatorId: "comparison-1",
  name: "Comparison",
  variants: [
    { id: "target-1", name: "gpt-5-mini" },
    { id: "target-2", name: "gpt-4o" },
  ],
  verdictsByRow: {
    0: { rowIndex: 0, winnerId: "target-1" },
    1: { rowIndex: 1, winnerId: "target-2" },
  },
  ...overrides,
});

describe("WinRateChart", () => {
  describe("given variants with distinct names", () => {
    it("labels each bar with its own name", () => {
      render(<WinRateChart column={createColumn()} chartHeight={160} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("bar-chart-data").textContent).toBe("gpt-5-mini, gpt-4o, Tie");
    });
  });

  // buildVariantIdentifiers (orchestrator.ts) already gives two variants
  // sharing a prompt handle distinct candidate ids and separate win tallies —
  // this is purely a labeling gap: two bars rendered with the identical name.
  describe("given two variants that share the same display name", () => {
    it("disambiguates the bar labels instead of rendering two identical labels", () => {
      const column = createColumn({
        variants: [
          { id: "target-1", name: "gpt-5-mini" },
          { id: "target-2", name: "gpt-5-mini" },
        ],
      });

      render(<WinRateChart column={column} chartHeight={160} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("bar-chart-data").textContent).toBe(
        "gpt-5-mini (1), gpt-5-mini (2), Tie",
      );
    });
  });
});
