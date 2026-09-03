import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * The row the judge ran and could not settle, end to end across every surface
 * that reads a verdict.
 *
 * Such a row is the most expensive kind in a run: swap-and-reconcile pays for
 * two judge calls and then keeps neither answer. The judge writes 1,300 to
 * 1,500 characters explaining the disagreement, we store it, and the page used
 * to answer with a bare dash, which reads as missing data rather than as a
 * finding. The first question a dogfooded screenshot drew was whether those
 * rows had failed to load.
 *
 * The other half of the behaviour is what an unsettled row must NOT become. It
 * shares `winnerId === null` with a tie, and four separate surfaces used to
 * read that as one thing, so the tests below pin each of them: counting these
 * rows as ties would hand the chart and the ranking a result nobody produced.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";

import { buildPairwiseComparisons } from "@langwatch/experiment-web";
import { ComparisonWinnerCell, resolveWinner } from "../comparison-winner-cell";
import { buildCsvData, buildCsvHeaders } from "@langwatch/experiment-web";
import type { BatchComparisonColumn, BatchEvaluationData } from "@langwatch/experiment-web";
import { transformBatchEvaluationData } from "@langwatch/experiment-web";
import { WinRateChart } from "../win-rate-chart";

/** What select_best_compare stores when its two passes disagree. */
const DISAGREEMENT_DETAILS =
  "Unreproducible verdict: original order picked gpt-5-mini (clearest answer); " +
  "reversed order picked gemini-2.5-flash (no unsupported detail). The verdict " +
  "did not survive being asked again with the candidate order reversed, so this " +
  "row does not establish a winner.";

const TARGETS = [
  { id: "target-a", name: "gpt-5-mini", type: "prompt" },
  { id: "target-b", name: "gemini-2.5-flash", type: "prompt" },
  { id: "cmp-1", name: "Comparison", type: "evaluator" },
];

const candidatesInput = (ids: string[]) => ({
  candidates: ids.map((id) => ({ id, output: `${id} answer` })),
  row_index: 0,
});

const createRun = (evaluations: ExperimentRunWithItems["evaluations"]): ExperimentRunWithItems => ({
  experimentId: "exp-1",
  runId: "run-1",
  projectId: "proj-1",
  targets: TARGETS,
  dataset: Array.from({ length: 2 }).flatMap((_, index) =>
    ["target-a", "target-b"].map((targetId) => ({
      index,
      targetId,
      entry: { input: `question ${index}` },
      predicted: { output: `${targetId} answer ${index}` },
    })),
  ),
  evaluations,
  timestamps: { createdAt: 1, updatedAt: 1 },
});

/** Row 0 decided, row 1 run and left unsettled. */
const RUN_WITH_ONE_UNSETTLED_ROW = createRun([
  {
    evaluator: "cmp-1",
    status: "processed",
    index: 0,
    label: "gpt-5-mini",
    details: "gpt-5-mini answers directly.",
    inputs: candidatesInput(["target-a", "target-b"]),
  },
  {
    evaluator: "cmp-1",
    status: "skipped",
    index: 1,
    label: null,
    details: DISAGREEMENT_DETAILS,
    inputs: candidatesInput(["target-a", "target-b"]),
  },
]);

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
});

describe("given a comparison row the judge ran and could not settle", () => {
  describe("when the stored run is transformed for the page", () => {
    /** @scenario "A row the judge could not settle says so, and why" */
    it("keeps the row as a verdict of its own, carrying the judge's account", () => {
      const column = transformBatchEvaluationData(RUN_WITH_ONE_UNSETTLED_ROW)
        .comparisonColumns![0]!;

      const verdict = column.verdictsByRow[1];
      expect(verdict).toBeDefined();
      expect(verdict!.isUnsettled).toBe(true);
      expect(verdict!.winnerId).toBeNull();
      expect(verdict!.reasoning).toBe(DISAGREEMENT_DETAILS);
    });

    /** @scenario "An unsettled row stays out of the win-rate chart and the ranking" */
    it("still reports the row as one without a verdict", () => {
      const column = transformBatchEvaluationData(RUN_WITH_ONE_UNSETTLED_ROW)
        .comparisonColumns![0]!;

      expect(column.rowsWithoutVerdict).toBe(1);
    });

    /** @scenario "An unsettled row stays out of the win-rate chart and the ranking" */
    it("gives the ranking no evidence from it", () => {
      const column = transformBatchEvaluationData(RUN_WITH_ONE_UNSETTLED_ROW)
        .comparisonColumns![0]!;

      const comparisons = buildPairwiseComparisons(column);

      // The decided row is evidence, the unsettled one is not. A `winner` of
      // "tie" here would be 0.5/0.5 evidence the run never established.
      expect(comparisons).toHaveLength(2);
      expect(comparisons.map((c) => c.winner)).toEqual(["target-a", null]);
    });
  });

  describe("when a run of only unsettled rows is transformed", () => {
    /** @scenario "A row the judge could not settle says so, and why" */
    it("still builds the column, rather than showing the reader nothing", () => {
      const run = createRun([
        {
          evaluator: "cmp-1",
          status: "skipped",
          index: 0,
          label: null,
          details: DISAGREEMENT_DETAILS,
          inputs: candidatesInput(["target-a", "target-b"]),
        },
      ]);

      const columns = transformBatchEvaluationData(run).comparisonColumns ?? [];

      expect(columns).toHaveLength(1);
      expect(columns[0]!.verdictsByRow[0]?.isUnsettled).toBe(true);
    });
  });

  describe("when the row is rendered in the results table", () => {
    const unsettledVerdict = {
      rowIndex: 1,
      winnerId: null,
      reasoning: DISAGREEMENT_DETAILS,
      winnerOutput: null,
      candidateIds: ["target-a", "target-b"],
      isUnsettled: true,
    };

    const column: BatchComparisonColumn = {
      evaluatorId: "cmp-1",
      name: "Comparison",
      variants: [
        { id: "target-a", name: "gpt-5-mini" },
        { id: "target-b", name: "gemini-2.5-flash" },
      ],
      verdictsByRow: { 1: unsettledVerdict },
    };

    /** @scenario "A row the judge could not settle says so, and why" */
    it("says the judge reached no verdict and shows why", () => {
      render(
        <Wrapper>
          <ComparisonWinnerCell column={column} verdict={unsettledVerdict} />
        </Wrapper>,
      );

      expect(screen.getByText("No verdict")).toBeDefined();
      expect(screen.getByTestId("comparison-winner-reasoning").textContent).toContain(
        "did not survive being asked again",
      );
    });

    /** @scenario "A row the judge could not settle says so, and why" */
    it("does not label the row a tie", () => {
      render(
        <Wrapper>
          <ComparisonWinnerCell column={column} verdict={unsettledVerdict} />
        </Wrapper>,
      );

      expect(screen.queryByText("Tie")).toBeNull();
      expect(screen.queryByTestId("comparison-winner-badge-tie")).toBeNull();
      expect(screen.getByTestId("comparison-winner-badge-no-verdict")).toBeDefined();
    });

    /** @scenario "A row the judge could not settle says so, and why" */
    it("does not wear the tie's colour either", () => {
      const unsettled = resolveWinner({ column, verdict: unsettledVerdict });
      const tie = resolveWinner({
        column,
        verdict: { ...unsettledVerdict, isUnsettled: undefined },
      });
      const decided = resolveWinner({
        column,
        verdict: {
          ...unsettledVerdict,
          isUnsettled: undefined,
          winnerId: "target-a",
        },
      });

      // Telling the two apart in the data model is only half the job.
      // Dogfooding this change showed both rendering the same near-white gray,
      // which puts the reader back where they started: one of the two states
      // this PR exists to separate, separated everywhere except on the page.
      expect(unsettled.colorPalette).toBe("orange");
      expect(tie.colorPalette).toBe("gray");
      expect(decided.colorPalette).toBe("green");
      expect(unsettled.colorPalette).not.toBe(tie.colorPalette);
    });

    /** @scenario "A row the judge could not settle says so, and why" */
    it("still shows a bare dash for a row the judge never ran", () => {
      render(
        <Wrapper>
          <ComparisonWinnerCell column={column} verdict={undefined} />
        </Wrapper>,
      );

      expect(screen.getByTestId("comparison-winner-none").textContent).toBe("-");
    });
  });
});

describe("given a win-rate chart over decided and unsettled rows", () => {
  /** @scenario "An unsettled row stays out of the win-rate chart and the ranking" */
  it("counts no ties from the unsettled rows", () => {
    const column = transformBatchEvaluationData(RUN_WITH_ONE_UNSETTLED_ROW).comparisonColumns![0]!;

    render(
      <Wrapper>
        <WinRateChart column={column} chartHeight={160} />
      </Wrapper>,
    );

    const chartData = JSON.parse(
      screen.getByTestId("bar-chart").getAttribute("data-chart") ?? "[]",
    ) as Array<{ name: string; wins: number }>;

    const tieBar = chartData.find((entry) => entry.name === "Tie");
    expect(tieBar?.wins ?? 0).toBe(0);
    expect(chartData.find((entry) => entry.name === "gpt-5-mini")?.wins).toBe(1);
  });
});

describe("given a CSV export of a run with an unsettled row", () => {
  const columnFrom = (run: ExperimentRunWithItems) =>
    transformBatchEvaluationData(run).comparisonColumns![0]!;

  const dataWith = (column: BatchComparisonColumn): BatchEvaluationData => ({
    ...transformBatchEvaluationData(RUN_WITH_ONE_UNSETTLED_ROW),
    comparisonColumns: [column],
  });

  const exportedRow = ({
    data,
    rowIndex,
  }: {
    data: BatchEvaluationData;
    rowIndex: number;
  }): Record<string, string> => {
    const headers = buildCsvHeaders(data);
    const { rows } = buildCsvData(data);
    const values = rows[rowIndex] ?? [];
    return Object.fromEntries(headers.map((header, position) => [header, values[position] ?? ""]));
  };

  /** @scenario "An unsettled row exports its explanation" */
  it("names the outcome for what it is, and carries the reasoning", () => {
    const row = exportedRow({
      data: dataWith(columnFrom(RUN_WITH_ONE_UNSETTLED_ROW)),
      rowIndex: 1,
    });

    // Not `tie`, and not the SDK's `inconclusive` either: the stored row
    // cannot tell an unreproducible verdict from a row too thin to judge, so
    // the cell says only what is certain and the reasoning says the rest.
    expect(row.comparison_winner).toBe("no_verdict");
    expect(row.comparison_candidates).toBe("gpt-5-mini, gemini-2.5-flash");
    expect(row.comparison_reasoning).toContain("did not survive being asked again");
  });

  /** @scenario "An unsettled row exports its explanation" */
  it("leaves three empty cells for a row the judge never ran", () => {
    const column = columnFrom(RUN_WITH_ONE_UNSETTLED_ROW);
    const row = exportedRow({
      data: dataWith({ ...column, verdictsByRow: {} }),
      rowIndex: 1,
    });

    expect(row.comparison_winner).toBe("");
    expect(row.comparison_candidates).toBe("");
    expect(row.comparison_reasoning).toBe("");
  });
});

// recharts measures its own layout, which jsdom cannot do, so the mock
// surfaces the data the component computed instead of drawing it.
vi.mock("recharts", () => {
  const MockComponent = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    ResponsiveContainer: MockComponent,
    BarChart: ({ data, children }: { data?: unknown; children?: ReactNode }) => (
      <div data-testid="bar-chart" data-chart={JSON.stringify(data ?? [])}>
        {children}
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
