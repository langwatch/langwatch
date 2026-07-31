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
    it("explains where to reopen it from instead of throwing", () => {
      expect(() => renderDrawer({})).not.toThrow();

      expect(screen.getByText("Nothing to show yet")).toBeDefined();
      expect(screen.queryByText("Judge: Pass")).toBeNull();
    });
  });

  describe("given no row has both a judge verdict and an agreed annotation", () => {
    it("says there is nothing to compare rather than drawing a matrix of zeroes", () => {
      renderDrawer({ coverage: coverageWith([]), rows: [makeRow(0)] });

      expect(screen.getByText("Nothing to show yet")).toBeDefined();
      expect(screen.queryByText("Judge: Pass")).toBeNull();
    });
  });

  describe("given resolved judge/reviewer pairs", () => {
    it("draws the matrix", () => {
      renderDrawer({
        coverage: coverageWith([
          { rowIndex: 0, predicted: true, actual: true },
          { rowIndex: 1, predicted: true, actual: false },
          { rowIndex: 2, predicted: false, actual: true },
          { rowIndex: 3, predicted: false, actual: false },
        ]),
        rows: [makeRow(0), makeRow(1), makeRow(2), makeRow(3)],
      });

      expect(screen.getByText("Judge: Pass")).toBeDefined();
      expect(screen.getByText("Judge: Fail")).toBeDefined();
      expect(screen.queryByText("Nothing to show yet")).toBeNull();
    });
  });

  describe("given the annotation lookup was capped", () => {
    it("keeps the annotated count as the numerator in the coverage line", () => {
      renderDrawer({
        coverage: {
          ...coverageWith([{ rowIndex: 0, predicted: true, actual: true }]),
          totalRows: 50,
          annotatedRows: 8,
          truncated: true,
        },
        rows: [makeRow(0)],
      });

      expect(
        screen.getByText(/8 of the 50 rows checked are annotated/),
      ).toBeDefined();
    });
  });
});
