/**
 * @vitest-environment jsdom
 *
 * The drawer is URL-routed, so `?drawer.open=confusionMatrix&...` survives a
 * reload or a pasted link while its data — carried in complexProps, a
 * module-level store — does not. These render the component through the
 * absent-data paths rather than asserting on strings, because the bug being
 * pinned was a crash: iterating an undefined `pairs`.
 *
 * @see specs/experiments/judge-annotation-confusion-matrix.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfusionMatrixDrawer } from "../../ConfusionMatrixDrawer";
import type { JudgeAnnotationCoverage } from "../buildJudgeAnnotationPairs";
import type { BatchResultRow } from "../types";

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

const TARGET_ID = "target-1";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const makeRow = (index: number): BatchResultRow => ({
  index,
  datasetEntry: {},
  targets: {
    [TARGET_ID]: {
      targetId: TARGET_ID,
      output: { output: `output ${index}` },
      cost: 0,
      duration: 0,
      error: null,
      traceId: `trace-${index}`,
      evaluatorResults: [],
    },
  },
});

const coverageWith = (
  pairs: JudgeAnnotationCoverage["pairs"],
): JudgeAnnotationCoverage => ({
  pairs,
  totalRows: 6,
  runRows: 6,
  annotatedRows: pairs.length,
  conflictingRows: 0,
});

const renderDrawer = (
  props: Partial<React.ComponentProps<typeof ConfusionMatrixDrawer>>,
) =>
  render(
    <ConfusionMatrixDrawer
      evaluatorId="eval-1"
      evaluatorName="Exact Match"
      targetId={TARGET_ID}
      {...props}
    />,
    { wrapper: Wrapper },
  );

describe("ConfusionMatrixDrawer", () => {
  afterEach(cleanup);

  describe("given the drawer was restored from a link, so complexProps are gone", () => {
    /** @scenario The expanded view opened from a link explains itself instead of breaking */
    it("explains where to reopen it from instead of throwing", () => {
      expect(() => renderDrawer({})).not.toThrow();

      expect(screen.getByText("Nothing to show yet")).toBeDefined();
      expect(screen.queryByText("Judge: Pass")).toBeNull();
    });
  });

  describe("given no row has both a judge verdict and an agreed annotation", () => {
    /** @scenario A run with no comparable rows says so rather than showing an empty matrix */
    it("says there is nothing to compare rather than drawing a matrix of zeroes", () => {
      renderDrawer({ coverage: coverageWith([]), rows: [makeRow(0)] });

      expect(screen.getByText("Nothing to show yet")).toBeDefined();
      expect(screen.queryByText("Judge: Pass")).toBeNull();
    });
  });

  describe("given resolved judge/reviewer pairs", () => {
    const fullMatrix = {
      coverage: coverageWith([
        { rowIndex: 0, predicted: true, actual: true },
        {
          rowIndex: 1,
          predicted: true,
          actual: false,
          comment: "Wrong refund",
        },
        { rowIndex: 2, predicted: false, actual: true },
        { rowIndex: 3, predicted: false, actual: false },
      ]),
      rows: [makeRow(0), makeRow(1), makeRow(2), makeRow(3)],
    };

    it("draws the matrix", () => {
      renderDrawer(fullMatrix);

      expect(screen.getByText("Judge: Pass")).toBeDefined();
      expect(screen.getByText("Judge: Fail")).toBeDefined();
      expect(screen.queryByText("Nothing to show yet")).toBeNull();
    });

    /** @scenario The reader is told the annotated rows may not be representative */
    it("warns that the annotated rows may not stand in for the run", () => {
      renderDrawer(fullMatrix);

      expect(
        screen.getByText(/Figures describe the annotated rows only/),
      ).toBeDefined();
      expect(screen.getByText(/will not reflect the full run/)).toBeDefined();
    });

    /** @scenario Agreement is shown against the level chance alone would reach */
    it("plots observed accuracy against the chance floor", () => {
      renderDrawer(fullMatrix);

      expect(screen.getByText("Is this better than chance?")).toBeDefined();
      // 1 TP / 1 FP / 1 FN / 1 TN: both raters split 50/50, so chance
      // agreement is exactly 50%, and observed accuracy happens to sit on
      // it, which the bar's caption must state rather than hide.
      expect(screen.getByText(/chance 50% · observed 50%/)).toBeDefined();
      expect(screen.getByText("at or below chance")).toBeDefined();
    });

    /** @scenario A run with no reviewer disagreements says nothing about them */
    it("says nothing about reviewer disagreement when there was none", () => {
      renderDrawer(fullMatrix);

      expect(screen.queryByText(/where reviewers disagreed/)).toBeNull();
    });

    describe("when a matrix cell is clicked", () => {
      /** @scenario Clicking a matrix cell drills into the underlying rows */
      it("lists that cell's rows with the reviewer's comment", async () => {
        const user = userEvent.setup();
        renderDrawer(fullMatrix);

        // The cell's caption is "False Positive · 25%", so match its start.
        await user.click(
          screen.getByText(/^False Positive ·/).closest("button")!,
        );

        // Row 1 is the only judge-pass/reviewer-thumbs-down pair, so the
        // drill-down must show it and nothing else.
        expect(
          screen.getByText(
            /False Positive: judge said Pass, reviewer said 👎 \(1 row\)/,
          ),
        ).toBeDefined();
        expect(screen.getByText("Row 2")).toBeDefined();
        expect(screen.getByText("output 1")).toBeDefined();
        expect(screen.getByText(/Reviewer: Wrong refund/)).toBeDefined();
        expect(screen.queryByText("Row 1")).toBeNull();
      });
    });
  });

  describe("given rows were excluded for conflicting reviewer annotations", () => {
    const withConflicts = (conflictingRows: number) => ({
      coverage: {
        ...coverageWith([
          { rowIndex: 0, predicted: true, actual: true },
          { rowIndex: 1, predicted: true, actual: false },
          { rowIndex: 2, predicted: false, actual: true },
          { rowIndex: 3, predicted: false, actual: false },
        ]),
        annotatedRows: 4 + conflictingRows,
        conflictingRows,
      },
      rows: [makeRow(0), makeRow(1), makeRow(2), makeRow(3)],
    });

    /** @scenario Excluding reviewer disagreements is admitted to, not just done */
    it("says the excluded rows may be flattering the agreement figures", () => {
      renderDrawer(withConflicts(3));

      expect(
        screen.getByText(
          /The 3 rows where reviewers disagreed with each other are left out of every figure below/,
        ),
      ).toBeDefined();
      expect(
        screen.getByText(/agreement may read higher here than it would/),
      ).toBeDefined();
    });

    /** @scenario Excluding reviewer disagreements is admitted to, not just done */
    it("says it in the singular for a lone excluded row", () => {
      renderDrawer(withConflicts(1));

      expect(
        screen.getByText(
          /The 1 row where reviewers disagreed with each other is left out of every figure below/,
        ),
      ).toBeDefined();
    });
  });

  describe("given the annotation lookup was capped", () => {
    const cappedCoverage = {
      coverage: {
        ...coverageWith([{ rowIndex: 0, predicted: true, actual: true }]),
        totalRows: 125,
        runRows: 2000,
        annotatedRows: 90,
        truncated: true,
      },
      rows: [makeRow(0)],
    };

    it("keeps the annotated count as the numerator in the coverage line", () => {
      renderDrawer(cappedCoverage);

      expect(
        screen.getByText(/90 of the 125 rows checked are annotated/),
      ).toBeDefined();
    });

    /** @scenario A capped lookup reports the run's size, not the slice's */
    it("names the run's own size so the slice does not read as full coverage", () => {
      renderDrawer(cappedCoverage);

      // 90 of 125 reads as most of the run. It is 4.5% of it.
      expect(screen.getByText(/out of 2000 in the run/)).toBeDefined();
    });
  });
});
