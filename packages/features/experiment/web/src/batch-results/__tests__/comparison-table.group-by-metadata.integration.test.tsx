import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * Issue #4632 — group ComparisonTable rows by a dataset-entry metadata
 * field. User-perspective integration tests; see
 * specs/experiments/group-results-by-metadata.feature for scenarios.
 *
 * The picker and the table are two components: `GroupRowsButton` sits in
 * the results toolbar and owns the selection, `ComparisonTable` renders
 * whatever `groupBy` it is handed. Tests about the dropdown therefore
 * render both through the `GroupableComparison` harness below; tests
 * about rendering drive the table directly with a `groupBy` prop.
 *
 * URL persistence is verified at the BatchEvaluationResults level + in
 * the browser.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { GroupRowsButton } from "../batch-evaluation-results-table";
import { ComparisonTable } from "../comparison-table";
import type { ComparisonRunData } from "@langwatch/experiment-web";
import { useResultsGrouping } from "@langwatch/experiment-web";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const RUN_COLORS = ["#3182ce", "#dd6b20"] as const;

const buildRun = ({
  runIndex,
  rowMetadata,
  scoresByRow,
}: {
  runIndex: number;
  rowMetadata: Array<Record<string, string>>;
  scoresByRow: number[];
}): ComparisonRunData => {
  const runId = `run-${runIndex + 1}`;
  const targetId = `target-${runIndex + 1}`;
  return {
    runId,
    runName: `Run ${runIndex + 1}`,
    color: RUN_COLORS[runIndex] ?? "#3182ce",
    isLoading: false,
    data: {
      runId,
      experimentId: "exp-1",
      projectId: "p-1",
      createdAt: Date.now() - (2 - runIndex) * 60_000,
      datasetColumns: [
        { name: "input", hasImages: false },
        { name: "city", hasImages: false },
        { name: "difficulty", hasImages: false },
      ],
      targetColumns: [
        {
          id: targetId,
          name: `Target ${runIndex + 1}`,
          type: "prompt" as const,
          outputFields: ["output"],
        },
      ],
      evaluatorIds: ["accuracy"],
      evaluatorNames: { accuracy: "Accuracy" },
      rows: rowMetadata.map((meta, rowIdx) => ({
        index: rowIdx,
        datasetEntry: { input: `q${rowIdx}`, ...meta },
        targets: {
          [targetId]: {
            targetId,
            output: { output: `answer ${rowIdx}` },
            cost: 0.001,
            duration: 500,
            error: null,
            traceId: null,
            evaluatorResults: [
              {
                evaluatorId: "accuracy",
                evaluatorName: "Accuracy",
                status: "processed" as const,
                score: scoresByRow[rowIdx] ?? 0,
                passed: (scoresByRow[rowIdx] ?? 0) >= 0.5,
              },
            ],
          },
        },
      })),
    },
  };
};

const BERLIN_LISBON_ROWS = [
  { city: "Berlin", difficulty: "easy" },
  { city: "Berlin", difficulty: "hard" },
  { city: "Lisbon", difficulty: "easy" },
  { city: "Lisbon", difficulty: "hard" },
];

const TWO_RUN_FIXTURE: ComparisonRunData[] = [
  buildRun({
    runIndex: 0,
    rowMetadata: BERLIN_LISBON_ROWS,
    scoresByRow: [0.9, 0.8, 0.5, 0.4],
  }),
  buildRun({
    runIndex: 1,
    rowMetadata: BERLIN_LISBON_ROWS,
    scoresByRow: [0.7, 0.6, 0.3, 0.2],
  }),
];

type TableProps = React.ComponentProps<typeof ComparisonTable>;

const renderTable = (props: Partial<TableProps> = {}) =>
  render(
    <ComparisonTable comparisonData={TWO_RUN_FIXTURE} disableVirtualization {...props} />,
    { wrapper: Wrapper },
  );

/**
 * The same wiring BatchEvaluationResults does — discover the keys, hand
 * them to the toolbar button, hand the button's selection to the table —
 * minus the router and tRPC that only the URL half needs.
 */
const GroupableComparison = ({
  comparisonData,
}: {
  comparisonData: ComparisonRunData[];
}) => {
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const { availableKeys } = useResultsGrouping({
    source: "dataset-entry",
    comparisonData,
  });
  return (
    <>
      <GroupRowsButton
        availableKeys={availableKeys}
        value={groupBy}
        onChange={setGroupBy}
      />
      <ComparisonTable
        comparisonData={comparisonData}
        disableVirtualization
        groupBy={groupBy}
      />
    </>
  );
};

const renderGroupable = (comparisonData = TWO_RUN_FIXTURE) =>
  render(<GroupableComparison comparisonData={comparisonData} />, {
    wrapper: Wrapper,
  });

describe("ComparisonTable group-by dataset-entry metadata (issue #4632)", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a 2-run comparison whose rows carry city + difficulty metadata", () => {
    describe("when the user opens the Group rows by dropdown", () => {
      /** @scenario "The Group rows by dropdown lists every metadata key from the dataset" */
      it("lists every metadata key discovered from the dataset entries", async () => {
        const user = userEvent.setup();
        renderGroupable();

        await user.click(screen.getByTestId("group-by-row-button"));

        const dropdown = screen.getByTestId("group-by-row-dropdown");
        expect(
          within(dropdown).getByTestId("group-by-row-option-none"),
        ).toBeInTheDocument();
        expect(
          within(dropdown).getByTestId("group-by-row-option-city"),
        ).toBeInTheDocument();
        expect(
          within(dropdown).getByTestId("group-by-row-option-difficulty"),
        ).toBeInTheDocument();
      });

      /** @scenario "Dropdown only offers keys present on the current runs' dataset entries" */
      it("does not list the input column as a grouping option", async () => {
        const user = userEvent.setup();
        renderGroupable();
        await user.click(screen.getByTestId("group-by-row-button"));
        const dropdown = screen.getByTestId("group-by-row-dropdown");
        // 'input' is a column but a row-unique payload, not a slicing dimension.
        // Discovery must include only fields with repeat values across rows.
        expect(
          within(dropdown).queryByTestId("group-by-row-option-input"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the user picks city as the grouping field", () => {
      const renderGroupedByCity = () =>
        renderTable({ groupBy: "city" } as Partial<TableProps>);

      /** @scenario "Rows group under metadata-value headers" */
      it("renders one header per distinct city value", () => {
        renderGroupedByCity();
        expect(screen.getByTestId("group-header-Berlin")).toBeInTheDocument();
        expect(screen.getByTestId("group-header-Lisbon")).toBeInTheDocument();
      });

      it("places rows with the same city under that city's section", () => {
        renderGroupedByCity();
        const berlinSection = screen.getByTestId("group-section-Berlin");
        // Berlin rows have inputs q0 and q1 in our fixture.
        expect(within(berlinSection).getByText("q0")).toBeInTheDocument();
        expect(within(berlinSection).getByText("q1")).toBeInTheDocument();
        expect(within(berlinSection).queryByText("q2")).not.toBeInTheDocument();
      });

      /** @scenario "Group headers show row count and per-run mean evaluator scores" */
      it("shows the row count on each group header", () => {
        renderGroupedByCity();
        expect(screen.getByTestId("group-count-Berlin")).toHaveTextContent("2");
        expect(screen.getByTestId("group-count-Lisbon")).toHaveTextContent("2");
      });

      it("shows the mean Accuracy per run on each group header", () => {
        renderGroupedByCity();
        // Berlin means:  run-1 = (0.9 + 0.8)/2 = 0.85
        //                run-2 = (0.7 + 0.6)/2 = 0.65
        expect(screen.getByTestId("group-mean-Berlin-run-1-accuracy")).toHaveTextContent(
          /0\.85/,
        );
        expect(screen.getByTestId("group-mean-Berlin-run-2-accuracy")).toHaveTextContent(
          /0\.65/,
        );
        // Lisbon means: run-1 = (0.5 + 0.4)/2 = 0.45
        //               run-2 = (0.3 + 0.2)/2 = 0.25
        expect(screen.getByTestId("group-mean-Lisbon-run-1-accuracy")).toHaveTextContent(
          /0\.45/,
        );
        expect(screen.getByTestId("group-mean-Lisbon-run-2-accuracy")).toHaveTextContent(
          /0\.25/,
        );
      });
    });

    describe("when the user collapses a group", () => {
      /** @scenario "Groups can be collapsed and expanded" */
      it("hides rows under that group but keeps the header visible", async () => {
        const user = userEvent.setup();
        renderTable({ groupBy: "city" } as Partial<TableProps>);

        // Sanity: rows visible before collapse.
        expect(
          within(screen.getByTestId("group-section-Berlin")).getByText("q0"),
        ).toBeInTheDocument();

        await user.click(screen.getByTestId("group-header-toggle-Berlin"));

        // Header stays.
        expect(screen.getByTestId("group-header-Berlin")).toBeInTheDocument();
        // Data rows under it disappear.
        expect(
          within(screen.getByTestId("group-section-Berlin")).queryByText("q0"),
        ).not.toBeInTheDocument();
        expect(
          within(screen.getByTestId("group-section-Berlin")).queryByText("q1"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the user picks No grouping after grouping by city", () => {
      /** @scenario "Choosing No grouping restores the flat row order" */
      it("drops every group header and returns the rows to one flat list", async () => {
        const user = userEvent.setup();
        // Picker plus table: the toolbar holds the selection, so picking an
        // option is the whole interaction. The URL half of this scenario
        // belongs to BatchEvaluationResults, which owns that contract.
        renderGroupable();

        await user.click(screen.getByTestId("group-by-row-button"));
        await user.click(screen.getByTestId("group-by-row-option-city"));
        expect(screen.getByTestId("group-header-Berlin")).toBeInTheDocument();

        await user.click(screen.getByTestId("group-by-row-button"));
        await user.click(screen.getByTestId("group-by-row-option-none"));

        expect(screen.queryByTestId("group-header-Berlin")).not.toBeInTheDocument();
        expect(screen.queryByTestId("group-header-Lisbon")).not.toBeInTheDocument();
        // Every row is still present, just no longer sectioned.
        for (const input of ["q0", "q1", "q2", "q3"]) {
          expect(screen.getByText(input)).toBeInTheDocument();
        }
      });
    });
  });

  describe("given rows whose city is missing on some entries", () => {
    const PARTIAL_ROWS: Array<Record<string, string>> = [
      { city: "Berlin", difficulty: "easy" },
      { difficulty: "easy" }, // city missing
      { city: "Lisbon", difficulty: "hard" },
    ];

    const PARTIAL_FIXTURE: ComparisonRunData[] = [
      buildRun({
        runIndex: 0,
        rowMetadata: PARTIAL_ROWS,
        scoresByRow: [0.9, 0.7, 0.5],
      }),
    ];

    describe("when the user groups by city", () => {
      /** @scenario "Rows with no value for the selected field fall into an Unspecified group" */
      it("collects missing-city rows under an Unspecified header at the end", () => {
        render(
          <ComparisonTable
            comparisonData={PARTIAL_FIXTURE}
            disableVirtualization
            groupBy="city"
          />,
          { wrapper: Wrapper },
        );

        // Exclude `group-header-toggle-*` (subcomponents of the header
        // row) so we only collect the section header rows themselves.
        const headers = screen
          .getAllByTestId(/^group-header-/)
          .filter(
            (el) => !el.getAttribute("data-testid")?.startsWith("group-header-toggle-"),
          );
        const ids = headers.map((h) => h.getAttribute("data-testid"));
        expect(ids).toContain("group-header-Unspecified");
        // Unspecified comes last so users notice it as the catch-all.
        expect(ids[ids.length - 1]).toBe("group-header-Unspecified");
      });
    });
  });
});
