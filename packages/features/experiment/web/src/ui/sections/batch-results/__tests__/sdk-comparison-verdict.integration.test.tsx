import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * A comparison logged by the code-first SDKs must reach the experiment results
 * page with no server-side and no frontend change.
 *
 * The SDK reports an n-way verdict through the batch protocol the experiment
 * already speaks: a row-level evaluation with NO `target_id`, whose `label` is
 * the winning target's name and whose `inputs.candidates` name everyone who
 * was judged. Nothing about that shape is workbench-specific, so the claim is
 * that `transformBatchEvaluationData` detects it, the table gives it a Winner
 * column, and the win-rate chart tallies it, exactly as it does for a run the
 * platform executed itself.
 *
 * The claim is worth pinning because the failure mode is silent: a comparison
 * that isn't detected does not error, it simply renders as nothing, and the
 * customer is left with verdicts they paid for and cannot see.
 *
 * This is an integration test rather than a unit test because the components
 * are rendered: the proof is what the page shows, not what the detector
 * returns.
 *
 * The last block covers reading a verdict the cell is too small to hold: the
 * Winner cell expands over the table, and the ways back out of that overlay
 * are part of the verdict being readable at all.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { BatchEvaluationResultsTable } from "../batch-evaluation-results-table";
import { ComparisonWinnerCell } from "../comparison-winner-cell";
import type {
  BatchComparisonColumn,
  BatchComparisonVerdict,
} from "@langwatch/experiment-web";
import { transformBatchEvaluationData } from "@langwatch/experiment-web";
import { WinRateChart } from "../win-rate-chart";

// recharts renders its bars through internal layout, so under jsdom there is
// nothing in the DOM to assert on. Surfacing the `data` prop, the exact input
// the real chart derives its bars, axis labels and tie bar from, tests the
// chart's own tally rather than recharts' rendering.
vi.mock("recharts", () => {
  const MockComponent = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    ResponsiveContainer: MockComponent,
    BarChart: ({ data }: { data: Array<{ name: string; wins: number }> }) => (
      <div data-testid="bar-chart-data">
        {JSON.stringify(data.map(({ name, wins }) => ({ name, wins })))}
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

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
});

/**
 * The SDK registers a target under the name the customer passed and reuses
 * that same string as its id, so a verdict naming the winner by name also
 * names it by id. Type is "custom": the customer's own code produced the
 * output, not a platform prompt or agent.
 */
const TARGET_NAMES = ["gpt-5-mini", "claude-sonnet-5", "gemini-flash"] as const;

const TARGETS = TARGET_NAMES.map((name) => ({
  id: name,
  name,
  type: "custom",
}));

const ROW_INPUTS = [
  "How do I reset my password?",
  "Where can I download my invoice?",
  "Can I change the email on my account?",
  "Why was my card declined?",
  "How do I cancel my subscription?",
];

/** One dataset entry per target per row, what a code-first loop records. */
const DATASET = ROW_INPUTS.flatMap((input, index) =>
  TARGET_NAMES.map((name) => ({
    index,
    targetId: name,
    entry: { input },
    predicted: { output: `${name} answer for row ${index}` },
    duration: 500,
  })),
);

/**
 * The comparison evaluator id and display name the SDK reports under.
 *
 * `detectComparisonColumns` admits a processed evaluation on either of two
 * independent grounds: its `evaluator` or `name` contains "comparison",
 * "pairwise" or "select_best", OR its `label` is "tie" / resolves to a target
 * the run registered. A SKIPPED evaluation has no label to resolve, so it is
 * counted into `rowsWithoutVerdict` on the name grounds alone: rename both
 * fields to something unrecognized and every winner still renders while rows
 * the judge declined stop being counted.
 */
const COMPARISON_EVALUATOR = "langevals/select_best_compare";
const COMPARISON_NAME = "comparison";

const ROW_0_REASONING =
  "gpt-5-mini gives the exact reset link and nothing else; the others bury it in preamble.";
const ROW_3_REASONING =
  "Both answers state the same policy with the same caveats. Nothing separates them.";
const ROW_4_SKIP_REASON =
  "The judge reversed its pick when the candidate order was swapped, so no verdict was recorded.";

/**
 * A row-level comparison verdict, exactly as the SDK reports it: no
 * `target_id` key at all, the winner named by target name in `label`, the
 * judge's reasoning in `details`, and every candidate it saw in
 * `inputs.candidates`.
 */
const verdict = ({
  index,
  label,
  details,
  score,
  status = "processed",
  candidates,
}: {
  index: number;
  label?: string;
  details: string;
  score?: number;
  status?: ExperimentRunWithItems["evaluations"][number]["status"];
  candidates: readonly string[];
}): ExperimentRunWithItems["evaluations"][number] => ({
  evaluator: COMPARISON_EVALUATOR,
  name: COMPARISON_NAME,
  status,
  index,
  score,
  label,
  details,
  inputs: { candidates: candidates.map((id) => ({ id })) },
});

/**
 * Five rows with a deliberate spread: gpt-5-mini wins twice, claude-sonnet-5
 * once, gemini-flash never, one row is a genuine tie, and one row the judge
 * ran on and declined to call. Candidate order differs per row because the
 * SDK shuffles it seeded on the row index to blunt position bias.
 */
const COMPARISON_VERDICTS: ExperimentRunWithItems["evaluations"] = [
  verdict({
    index: 0,
    label: "gpt-5-mini",
    score: 1,
    details: ROW_0_REASONING,
    candidates: ["gpt-5-mini", "claude-sonnet-5", "gemini-flash"],
  }),
  verdict({
    index: 1,
    label: "claude-sonnet-5",
    score: 1,
    details: "claude-sonnet-5 names the invoices page; gpt-5-mini guesses.",
    candidates: ["gemini-flash", "gpt-5-mini", "claude-sonnet-5"],
  }),
  verdict({
    index: 2,
    label: "gpt-5-mini",
    score: 1,
    details: "Only gpt-5-mini mentions the confirmation email.",
    candidates: ["claude-sonnet-5", "gemini-flash", "gpt-5-mini"],
  }),
  verdict({
    index: 3,
    label: "tie",
    score: 0.5,
    details: ROW_3_REASONING,
    candidates: ["gpt-5-mini", "gemini-flash", "claude-sonnet-5"],
  }),
  verdict({
    index: 4,
    status: "skipped",
    details: ROW_4_SKIP_REASON,
    candidates: ["gemini-flash", "claude-sonnet-5", "gpt-5-mini"],
  }),
];

/** A per-target scalar evaluator, the ordinary company a comparison keeps. */
const SCALAR_EVALUATIONS: ExperimentRunWithItems["evaluations"] = ROW_INPUTS.flatMap(
  (_, index) =>
    TARGET_NAMES.map((name) => ({
      evaluator: "exact_match",
      name: "Exact Match",
      targetId: name,
      status: "processed" as const,
      index,
      score: 0.75,
      passed: true,
    })),
);

const SDK_RUN: ExperimentRunWithItems = {
  experimentId: "experiment-support-bot",
  runId: "run-sdk-1",
  projectId: "project-1",
  targets: TARGETS,
  dataset: DATASET,
  evaluations: [...SCALAR_EVALUATIONS, ...COMPARISON_VERDICTS],
  timestamps: { createdAt: 1_700_000_000_000, updatedAt: 1_700_000_060_000 },
};

const comparisonColumnsOf = (run: ExperimentRunWithItems) =>
  transformBatchEvaluationData(run).comparisonColumns ?? [];

/** The run's single comparison column. Throws rather than returning undefined,
 * so a run that renders no comparison at all says so instead of failing later
 * on a property of nothing. */
const comparisonColumnOf = (run: ExperimentRunWithItems) => {
  const columns = comparisonColumnsOf(run);
  if (columns.length !== 1) {
    throw new Error(
      `the results page detected ${columns.length} comparison columns, wanted 1`,
    );
  }
  return columns[0]!;
};

describe("an n-way comparison logged by the code-first SDK", () => {
  describe("given a run whose verdicts belong to the row rather than to a target", () => {
    describe("when the stored run is transformed for the results page", () => {
      it("detects one comparison column carrying every candidate the judge saw", () => {
        const columns = comparisonColumnsOf(SDK_RUN);

        expect(columns).toHaveLength(1);
        const column = columns[0]!;
        expect(column.evaluatorId).toBe(COMPARISON_EVALUATOR);
        expect(column.name).toBe(COMPARISON_NAME);
        // Judge order, taken from the candidates of the first row the judge
        // called. Later rows shuffle, and a variant list that reshuffled with
        // them would reorder the chart between reruns.
        expect(column.variants).toEqual([
          { id: "gpt-5-mini", name: "gpt-5-mini" },
          { id: "claude-sonnet-5", name: "claude-sonnet-5" },
          { id: "gemini-flash", name: "gemini-flash" },
        ]);
      });

      it("carries the winner and the judge's reasoning for every row it called", () => {
        const column = comparisonColumnOf(SDK_RUN);

        expect(column.verdictsByRow[0]).toMatchObject({
          winnerId: "gpt-5-mini",
          reasoning: ROW_0_REASONING,
          winnerOutput: "gpt-5-mini answer for row 0",
        });
        expect(column.verdictsByRow[1]?.winnerId).toBe("claude-sonnet-5");
        expect(column.verdictsByRow[2]?.winnerId).toBe("gpt-5-mini");
        // A genuine tie: no winner, and flagged as a real verdict rather than
        // a label nothing could resolve.
        expect(column.verdictsByRow[3]).toMatchObject({
          winnerId: null,
          isUnresolved: false,
          reasoning: ROW_3_REASONING,
        });
      });

      // THE CRUX. A comparison grades no single target, so the SDK attaches it
      // to the row and sends no `target_id` at all. Every other evaluation in a
      // run has one, so if detection required it the whole feature would render
      // nothing. This asserts the fixture really omits it, then that the
      // verdicts survive anyway.
      it("admits a verdict that names no target at all", () => {
        for (const evaluation of COMPARISON_VERDICTS) {
          expect("targetId" in evaluation).toBe(false);
        }

        const column = comparisonColumnOf(SDK_RUN);

        expect(Object.keys(column.verdictsByRow)).toEqual(["0", "1", "2", "3", "4"]);
      });

      it("counts a row the judge could not settle as neither a tie nor a win for anyone", () => {
        const column = comparisonColumnOf(SDK_RUN);
        const verdicts = Object.values(column.verdictsByRow);

        // Row 4 is carried, marked for what it is, and keeps the judge's
        // account of why it reached nothing. That text is the most expensive
        // on the page: an unsettled row is two judge calls and no answer.
        expect(column.verdictsByRow[4]).toMatchObject({
          winnerId: null,
          isUnsettled: true,
          reasoning: ROW_4_SKIP_REASON,
        });
        // Carried is not counted: it is still reported as a row without a
        // verdict.
        expect(column.rowsWithoutVerdict).toBe(1);
        // Exactly one row is a tie: row 3. Row 4 shares its null winner and
        // must not be read as a second one.
        expect(
          verdicts.filter((v) => v.winnerId === null && !v.isUnsettled),
        ).toHaveLength(1);
        expect(verdicts.filter((v) => v.winnerId !== null)).toHaveLength(3);
      });
    });

    describe("when the results table renders that run", () => {
      const renderTable = () =>
        render(
          <BatchEvaluationResultsTable
            data={transformBatchEvaluationData(SDK_RUN)}
            isLoading={false}
            disableVirtualization
          />,
          { wrapper: Wrapper },
        );

      /** @scenario "The verdict reaches the results page" */
      it("names the winning target on each row and shows the judge's reasoning", () => {
        renderTable();

        // The Winner column exists, headed by the judge's display name.
        expect(screen.getByText(COMPARISON_NAME)).toBeDefined();

        // The winner is named by the target name the customer registered, not
        // by a slot letter or an internal id.
        expect(screen.getAllByText("Winner: gpt-5-mini")).toHaveLength(2);
        expect(screen.getAllByText("Winner: claude-sonnet-5")).toHaveLength(1);
        // The candidate that never won is never announced as a winner.
        expect(screen.queryByText("Winner: gemini-flash")).toBeNull();
        expect(
          screen.queryAllByTestId("comparison-winner-badge-gemini-flash"),
        ).toHaveLength(0);

        // The tie reads as a tie, and the row the judge ran and could not
        // settle reads as its own outcome rather than as a tie or a win.
        expect(screen.getAllByTestId("comparison-winner-badge-tie")).toHaveLength(1);
        expect(screen.getAllByTestId("comparison-winner-badge-no-verdict")).toHaveLength(
          1,
        );
        // A bare dash is reserved for a row the judge never ran, and every row
        // of this run was judged.
        expect(screen.queryAllByTestId("comparison-winner-none")).toHaveLength(0);

        // "Why" is on the page, not one drill-down away, and that includes the
        // reason a row reached no verdict.
        expect(screen.getByText(ROW_0_REASONING)).toBeDefined();
        expect(screen.getByText(ROW_3_REASONING)).toBeDefined();
        expect(screen.getByText(ROW_4_SKIP_REASON)).toBeDefined();
        // And "what was right" alongside it: the winning candidate's own
        // output, repeated into the Winner cell so the reader does not have to
        // scroll back across the target columns to find which answer won.
        const winnerOutputs = screen
          .getAllByTestId("comparison-winner-output")
          .map((node) => node.textContent);
        expect(winnerOutputs).toEqual([
          "gpt-5-mini answer for row 0",
          "claude-sonnet-5 answer for row 1",
          "gpt-5-mini answer for row 2",
        ]);
      });

      it("leaves the comparison out of the per-target evaluator chips", () => {
        renderTable();

        // Ordinary evaluators still chip up per target, so an absent
        // comparison chip below means suppressed, not chips-off.
        expect(screen.getAllByText("Exact Match").length).toBeGreaterThan(0);

        // The judge's name appears once, as the Winner column header. A
        // per-target chip would repeat it on every row, and read as a second,
        // contradictory result for a target that may well have lost.
        expect(screen.getAllByText(COMPARISON_NAME)).toHaveLength(1);
        // Nor does its score leak out as a bare number: `1.00` is what the
        // generic chip would render for a verdict, and it means nothing to a
        // reader who cannot see which candidate it refers to.
        expect(screen.queryByText("1.00")).toBeNull();
        expect(screen.queryByText("0.50")).toBeNull();
      });
    });

    describe("when the win-rate chart renders that run", () => {
      it("charts every candidate plus ties, including the candidate that never won", () => {
        const column = comparisonColumnOf(SDK_RUN);

        render(<WinRateChart column={column} chartHeight={200} />, {
          wrapper: Wrapper,
        });

        expect(
          JSON.parse(screen.getByTestId("bar-chart-data").textContent ?? "[]"),
        ).toEqual([
          { name: "gpt-5-mini", wins: 2 },
          { name: "claude-sonnet-5", wins: 1 },
          // Still charted, at zero. Dropping a candidate that lost every row
          // would hide the very comparison the customer ran.
          { name: "gemini-flash", wins: 0 },
          // One tie, from row 3. The skipped row is not a tie.
          { name: "Tie", wins: 1 },
        ]);
      });
    });
  });
});

/**
 * Reasoning long enough to trip the cell's overflow heuristic, which collapses
 * anything past a few hundred characters and offers the fade overlay instead.
 */
const OVERFLOWING_REASONING = Array.from(
  { length: 8 },
  (_, pass) =>
    `Pass ${pass + 1}: gpt-5-mini gives the reset link and stops, while the ` +
    `other two spend a paragraph restating the question before they get to it.`,
).join(" ");

const OVERFLOWING_COLUMN: BatchComparisonColumn = {
  evaluatorId: COMPARISON_EVALUATOR,
  name: COMPARISON_NAME,
  variants: TARGET_NAMES.map((name) => ({ id: name, name })),
  verdictsByRow: {},
};

const OVERFLOWING_VERDICT: BatchComparisonVerdict = {
  rowIndex: 0,
  winnerId: "gpt-5-mini",
  reasoning: OVERFLOWING_REASONING,
  winnerOutput: "gpt-5-mini answer for row 0",
};

const CLOSE_HINT = "click outside or press Escape to close";

describe("a verdict too long to fit its cell", () => {
  /** Renders the cell and clicks the fade overlay to open it over the table. */
  const expandVerdict = async () => {
    const user = userEvent.setup();

    render(
      <ComparisonWinnerCell column={OVERFLOWING_COLUMN} verdict={OVERFLOWING_VERDICT} />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByTestId("comparison-winner-expand"));

    return user;
  };

  describe("given the reader has expanded it over the table", () => {
    it("names both ways back out", async () => {
      await expandVerdict();

      expect(screen.getByText(CLOSE_HINT)).toBeDefined();
    });

    // The backdrop is a fixed, full-viewport box that swallows every pointer
    // event, so leaving it behind does more than ignore a keystroke: the
    // toolbar above the table stops responding until the reader happens to
    // click the backdrop itself.
    describe("when Escape is pressed", () => {
      /** @scenario "Dismissing an expanded verdict" */
      it("takes the backdrop out of the page along with the overlay", async () => {
        const user = await expandVerdict();
        expect(screen.getByTestId("comparison-winner-backdrop")).toBeDefined();

        await user.keyboard("{Escape}");

        expect(screen.queryByTestId("comparison-winner-backdrop")).toBeNull();
        expect(screen.queryByText(CLOSE_HINT)).toBeNull();
      });
    });

    describe("when the backdrop is clicked", () => {
      it("takes the backdrop out of the page along with the overlay", async () => {
        const user = await expandVerdict();

        await user.click(screen.getByTestId("comparison-winner-backdrop"));

        expect(screen.queryByTestId("comparison-winner-backdrop")).toBeNull();
        expect(screen.queryByText(CLOSE_HINT)).toBeNull();
      });
    });
  });
});
