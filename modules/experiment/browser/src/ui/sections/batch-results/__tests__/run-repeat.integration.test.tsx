import "@testing-library/jest-dom/vitest";
/**
 * The results page shows a repeated run's rows by dataset row and repetition, with a pass rate.
 * @see specs/experiments-v3/run-repeat.feature
 *
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExperimentRow } from "../../../../model/experiment-api-map.ts";
import { transformBatchEvaluationData } from "../../batch-evaluation-results.types.ts";
import { BatchEvaluationResultsHeader } from "../../batch-evaluation-results/batch-evaluation-results-header.tsx";
import { BatchEvaluationResultsTable } from "../batch-evaluation-results-table.tsx";
import { BatchRunsSidebar } from "../batch-runs-sidebar.tsx";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: {}, pathname: "", push: vi.fn(), replace: vi.fn() }),
}));

/** Dataset row 1 passes 2 of its 3 runs, dataset row 2 passes all 3. */
const verdicts = [true, false, true, true, true, true];

const run = ({ repeat }: { repeat: number | null }): ExperimentRunWithItems => {
  const rows = repeat ? verdicts : verdicts.slice(0, 3);
  return {
    experimentId: "experiment_1",
    runId: "run_1",
    projectId: "project_1",
    repeat,
    targets: [{ id: "target_a", name: "support-prompt", type: "prompt" }],
    dataset: rows.map((_, index) => ({
      index,
      targetId: "target_a",
      entry: { question: `question ${repeat ? Math.floor(index / repeat) + 1 : index + 1}` },
      predicted: { output: "answer" },
    })),
    evaluations: rows.map((passed, index) => ({
      evaluator: "exact",
      name: "Exact match",
      targetId: "target_a",
      status: "processed" as const,
      index,
      passed,
    })),
    timestamps: { createdAt: 1_000, updatedAt: 2_000, finishedAt: 2_000 },
    completeness: {
      complete: true,
      dataset: { received: rows.length, expected: rows.length },
      evaluations: { received: rows.length, expected: rows.length },
    },
  };
};

afterEach(cleanup);

describe("a repeated run's results", () => {
  describe("given a run with a repeat of 3 over 2 dataset rows", () => {
    /** @scenario "The results page shows a repeated run's pass rate per dataset row" */
    it("numbers every run row by its dataset row and repetition", () => {
      renderWithDesignSystem(
        <BatchEvaluationResultsTable
          data={transformBatchEvaluationData(run({ repeat: 3 }))}
          isLoading={false}
          disableVirtualization
        />,
      );

      expect(screen.getByTestId("run-row-repetition-0")).toHaveTextContent("1 · 1/3");
      expect(screen.getByTestId("run-row-repetition-1")).toHaveTextContent("1 · 2/3");
      expect(screen.getByTestId("run-row-repetition-5")).toHaveTextContent("2 · 3/3");
    });

    /** @scenario "The results page shows a repeated run's pass rate per dataset row" */
    it("shows each dataset row's pass rate in a Pass rate column", () => {
      renderWithDesignSystem(
        <BatchEvaluationResultsTable
          data={transformBatchEvaluationData(run({ repeat: 3 }))}
          isLoading={false}
          disableVirtualization
        />,
      );

      expect(screen.getByText("Pass rate")).toBeInTheDocument();
      expect(screen.getAllByTestId("row-pass-rate-0")[0]).toHaveTextContent("2/3");
      expect(screen.getAllByTestId("row-pass-rate-1")[0]).toHaveTextContent("3/3");
    });

    /** @scenario "The results page shows a repeated run's pass rate per dataset row" */
    it("reads Repeat 3 in the run list entry and the title", () => {
      renderWithDesignSystem(
        <>
          <BatchRunsSidebar
            runs={[
              {
                runId: "run_1",
                workflowVersion: null,
                timestamps: { createdAt: 1_000, finishedAt: 2_000 },
                repeat: 3,
                summary: { evaluations: {} },
              },
            ]}
            onSelectRun={() => {}}
          />
          <BatchEvaluationResultsHeader
            experiment={
              { id: "experiment_1", slug: "refund-eval", name: "Refund eval" } as ExperimentRow
            }
            shownRunId="run_1"
            shownRunRepeat={3}
            data={null}
            charts={{ available: false, visible: false, onChange: () => {} }}
            displayControls={null}
            columnControls={null}
            onDownloadCsv={() => {}}
          />
        </>,
      );

      expect(screen.getByTestId("run-repeat-run_1")).toHaveTextContent(/^Repeat 3$/);
      expect(screen.getByTestId("shown-run-repeat")).toHaveTextContent(/^Repeat 3$/);
    });
  });

  describe("given a run with no repeat", () => {
    /** @scenario "The results page shows an unrepeated run as before" */
    it("shows no Pass rate column and numbers rows 1, 2, 3", () => {
      renderWithDesignSystem(
        <BatchEvaluationResultsTable
          data={transformBatchEvaluationData(run({ repeat: null }))}
          isLoading={false}
          disableVirtualization
        />,
      );

      expect(screen.queryByText("Pass rate")).toBeNull();
      expect(screen.queryByTestId("run-row-repetition-0")).toBeNull();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });
});
