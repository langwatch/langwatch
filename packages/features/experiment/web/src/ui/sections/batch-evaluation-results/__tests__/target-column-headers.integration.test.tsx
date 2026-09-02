// @vitest-environment jsdom
/**
 * The name each target column shows in its header.
 *
 * A board can hold two targets stored under the identical name, for example
 * the same prompt added twice with a different configuration. The workbench
 * separates them with a "(1)" / "(2)" suffix added at display time. The
 * results page printed the raw stored name, so both columns read the same and
 * there was no way to tell which output belonged to which target.
 *
 * The run data goes through `transformBatchEvaluationData` here rather than
 * being handed to the table as a literal, so the assertion covers the whole
 * chain the page uses.
 *
 * @see specs/batch-evaluation-results/target-column-identity.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import {
  BatchEvaluationResultsTable,
  transformBatchEvaluationData,
} from "@langwatch/experiment-web";

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

// TraceIdPeek (rendered transitively) calls useFeatureFlag → tRPC, which has
// no withTRPC wrapper in these tests.
vi.mock("@langwatch/workflow-web/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** A finished run over one dataset row, with one output per named target. */
const runWithTargetNames = (names: string[]): ExperimentRunWithItems => ({
  experimentId: "exp-1",
  runId: "run-1",
  projectId: "proj-1",
  targets: names.map((name, index) => ({
    id: `target-${index + 1}`,
    name,
    type: "prompt",
  })),
  dataset: names.map((_, index) => ({
    index: 0,
    targetId: `target-${index + 1}`,
    entry: { input: "a question" },
    predicted: { output: `answer ${index + 1}` },
    cost: 0.001,
    duration: 400,
  })),
  evaluations: [],
  timestamps: { createdAt: 1, updatedAt: 1, finishedAt: 2 },
});

const renderTableFor = (names: string[]) => {
  render(
    <BatchEvaluationResultsTable
      data={transformBatchEvaluationData(runWithTargetNames(names))}
      disableVirtualization
    />,
    { wrapper: Wrapper },
  );
};

/** The same run twice, which is what puts the table in comparison mode. */
const renderComparisonFor = (names: string[]) => {
  const runs = ["run-1", "run-2"].map((runId) => ({
    runId,
    runName: runId,
    color: "#3182ce",
    isLoading: false,
    data: {
      ...transformBatchEvaluationData(runWithTargetNames(names)),
      runId,
    },
  }));

  render(
    <BatchEvaluationResultsTable
      data={runs[0]!.data}
      comparisonData={runs}
      disableVirtualization
    />,
    { wrapper: Wrapper },
  );
};

afterEach(() => {
  cleanup();
});

describe("given two targets stored under the same name", () => {
  describe("when the results table renders", () => {
    /** @scenario "Two target columns with the same name get separate headers" */
    it("numbers each header the way the workbench does", () => {
      renderTableFor(["category_classifier", "category_classifier"]);

      expect(screen.getByText("category_classifier (1)")).toBeInTheDocument();
      expect(screen.getByText("category_classifier (2)")).toBeInTheDocument();
      expect(screen.queryByText("category_classifier")).not.toBeInTheDocument();
    });
  });
});

describe("given targets with names of their own", () => {
  describe("when the results table renders", () => {
    /** @scenario "A target column with a unique name keeps its plain name" */
    it("prints each name untouched", () => {
      renderTableFor(["classifier", "summarizer"]);

      expect(screen.getByText("classifier")).toBeInTheDocument();
      expect(screen.getByText("summarizer")).toBeInTheDocument();
    });
  });
});

describe("given two runs whose targets share one name", () => {
  describe("when the comparison table renders", () => {
    /** @scenario "Compare mode numbers same-named target columns too" */
    it("numbers each column the way single-run mode does", () => {
      renderComparisonFor(["category_classifier", "category_classifier"]);

      expect(screen.getByText("category_classifier (1)")).toBeInTheDocument();
      expect(screen.getByText("category_classifier (2)")).toBeInTheDocument();
      expect(screen.queryByText("category_classifier")).not.toBeInTheDocument();
    });
  });
});
