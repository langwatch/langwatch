// @vitest-environment jsdom
/**
 * The label under each bar when two targets carry the identical name.
 *
 * `buildAxisLabels` returns one label per bar, in bar order. The chart held
 * them in a map keyed by the bar's NAME, so two targets stored under the same
 * name collapsed onto one entry and both bars drew the second label. On a real
 * run both cost bars read "…classifier (2)".
 *
 * recharts lays its chart out from measurements jsdom cannot produce, so the
 * mock captures the data and the tick formatter the component hands it and
 * applies them the way recharts does: the formatter gets the datum's `name`
 * and its position.
 *
 * @see specs/batch-evaluation-results/target-column-identity.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  chartData: [] as { name: string }[],
  tickFormatters: [] as ((value: unknown, index: number) => string)[],
}));

vi.mock("recharts", () => {
  const MockComponent = ({ children }: { children?: ReactNode }) =>
    children ?? null;
  return {
    ResponsiveContainer: MockComponent,
    BarChart: ({
      data,
      children,
    }: {
      data?: { name: string }[];
      children?: ReactNode;
    }) => {
      if (data && captured.chartData.length === 0) captured.chartData = data;
      return <div data-testid="bar-chart">{children}</div>;
    },
    XAxis: ({
      tickFormatter,
    }: {
      tickFormatter?: (value: unknown, index: number) => string;
    }) => {
      if (tickFormatter) captured.tickFormatters.push(tickFormatter);
      return null;
    },
    Bar: MockComponent,
    YAxis: MockComponent,
    CartesianGrid: MockComponent,
    Tooltip: MockComponent,
    Legend: MockComponent,
    Cell: MockComponent,
    LabelList: MockComponent,
    LineChart: MockComponent,
    Line: MockComponent,
    ScatterChart: MockComponent,
    Scatter: MockComponent,
    ReferenceLine: MockComponent,
    ReferenceArea: MockComponent,
    ZAxis: MockComponent,
  };
});

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

// The leaderboard rollout check reaches for tRPC, which has no withTRPC
// wrapper here. The leaderboard is a different chart and not under test.
vi.mock("../useShowComparisonLeaderboard", () => ({
  useShowComparisonLeaderboard: () => false,
}));

import { ComparisonCharts } from "../ComparisonCharts";
import type { ComparisonRunData } from "../types";
import { transformBatchEvaluationData } from "../types";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** A finished run with one output row per named target. */
const runWithTargets = (
  targets: { name: string; promptId?: string }[],
): ComparisonRunData => ({
  runId: "run-1",
  runName: "Run 1",
  color: "#3182ce",
  isLoading: false,
  data: transformBatchEvaluationData({
    experimentId: "exp-1",
    runId: "run-1",
    projectId: "proj-1",
    targets: targets.map((target, index) => ({
      id: `target-${index + 1}`,
      name: target.name,
      type: "prompt",
      promptId: target.promptId,
    })),
    dataset: targets.map((_, index) => ({
      index: 0,
      targetId: `target-${index + 1}`,
      entry: { input: "a question" },
      predicted: { output: `answer ${index + 1}` },
      cost: 0.001 * (index + 1),
      duration: 400,
    })),
    evaluations: [],
    timestamps: { createdAt: 1, updatedAt: 1, finishedAt: 2 },
  }),
});

/** The tick each bar draws, in bar order, the way recharts resolves them. */
const barLabels = ({
  targets,
  xAxisOption = "target",
  promptNames,
}: {
  targets: { name: string; promptId?: string }[];
  xAxisOption?: string;
  promptNames?: Record<string, string>;
}): string[] => {
  render(
    <ComparisonCharts
      comparisonData={[runWithTargets(targets)]}
      isVisible={true}
      xAxisOption={xAxisOption}
      promptNames={promptNames}
    />,
    { wrapper: Wrapper },
  );

  const format = captured.tickFormatters[0]!;
  return captured.chartData.map((datum, index) => format(datum.name, index));
};

beforeEach(() => {
  captured.chartData = [];
  captured.tickFormatters = [];
});

afterEach(() => {
  cleanup();
});

describe("given two targets stored under the same name", () => {
  describe("when the cost chart renders one bar per target", () => {
    /** @scenario "Two bars with the same target name keep their own axis labels" */
    it("gives each bar its own numbered label", () => {
      expect(
        barLabels({
          targets: [{ name: "classifier" }, { name: "classifier" }],
        }),
      ).toEqual(["classifier (1)", "classifier (2)"]);
    });
  });
});

describe("given targets with names of their own", () => {
  describe("when the cost chart renders one bar per target", () => {
    it("labels each bar with its plain name", () => {
      expect(
        barLabels({
          targets: [{ name: "classifier" }, { name: "summarizer" }],
        }),
      ).toEqual(["classifier", "summarizer"]);
    });
  });
});

describe("given two prompts whose names are the same", () => {
  describe("when the bars are grouped by prompt", () => {
    /** @scenario "Two bars grouped under one prompt name keep their own axis labels" */
    it("keeps a label per bar, though both bars carry one name", () => {
      expect(
        barLabels({
          targets: [
            { name: "first", promptId: "prompt-a" },
            { name: "second", promptId: "prompt-b" },
          ],
          xAxisOption: "prompt",
          promptNames: { "prompt-a": "classifier", "prompt-b": "classifier" },
        }),
      ).toEqual(["classifier (1)", "classifier (2)"]);
    });
  });
});
