// @vitest-environment jsdom
/**
 * Tests for WinRateChart.
 *
 * Focused regression coverage for #5528's win-rate-chart follow-up: two
 * variants sharing a display name (e.g. the same prompt handle run twice with
 * different configs) must render as two distinguishable bars, not two bars
 * with the identical label.
 *
 * recharts renders its axis tick text via internal layout (not as React
 * children), so asserting on rendered SVG text is brittle under jsdom and
 * the project's global recharts mock (test-setup.ts) doesn't reproduce it.
 * Instead, this locally mocks `BarChart` to surface the `data` prop it
 * receives — the same prop the real chart derives its bars and axis labels
 * from — so the test verifies WinRateChart's actual labeling logic without
 * depending on recharts' rendering internals.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WinRateChart } from "../WinRateChart";
import type { BatchComparisonColumn } from "../types";

vi.mock("recharts", () => {
  const MockComponent = ({ children }: { children?: React.ReactNode }) =>
    children ?? null;
  return {
    ResponsiveContainer: MockComponent,
    // Surfaces the chart's computed data (one entry per bar, in render
    // order) as text so the test can assert on it without depending on
    // recharts' internal SVG tick rendering.
    BarChart: ({ data }: { data: Array<{ name: string }> }) => (
      <div data-testid="bar-chart-data">
        {data.map((d) => d.name).join(", ")}
      </div>
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

const createColumn = (
  overrides: Partial<BatchComparisonColumn> = {},
): BatchComparisonColumn => ({
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

      expect(screen.getByTestId("bar-chart-data").textContent).toBe(
        "gpt-5-mini, gpt-4o, Tie",
      );
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
