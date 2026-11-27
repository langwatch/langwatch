import "@testing-library/jest-dom/vitest";
/**
 * The column header of a saved run says how much of the run's plan its score covers,
 * counted from the stored run rather than from totals handed to the header.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { transformBatchEvaluationData } from "../../batch-evaluation-results.types.ts";
import { BatchEvaluationResultsTable } from "../batch-evaluation-results-table.tsx";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: {}, pathname: "", push: vi.fn(), replace: vi.fn() }),
}));

const runOf = ({ answered, total }: { answered: number[]; total: number }) =>
  ({
    experimentId: "experiment_1",
    runId: "run_1",
    projectId: "project_1",
    repeat: null,
    total,
    progress: answered.length,
    targets: [{ id: "target_a", name: "support-prompt", type: "prompt" }],
    dataset: answered.map((index) => ({
      index,
      targetId: "target_a",
      entry: { question: `question ${index + 1}` },
      predicted: { output: `answer ${index + 1}` },
    })),
    evaluations: answered.map((index) => ({
      evaluator: "exact",
      name: "Exact",
      targetId: "target_a",
      index,
      status: "processed" as const,
      passed: true,
    })),
    timestamps: { createdAt: 1_000, updatedAt: 2_000, stoppedAt: 2_000 },
    completeness: {
      complete: true,
      dataset: { received: answered.length, expected: null },
      evaluations: { received: answered.length, expected: null },
    },
  }) satisfies ExperimentRunWithItems;

const renderRun = (run: ExperimentRunWithItems) =>
  renderWithDesignSystem(
    <BatchEvaluationResultsTable
      data={transformBatchEvaluationData(run)}
      isLoading={false}
      disableVirtualization
    />,
  );

afterEach(cleanup);

describe("the column header of a saved run", () => {
  describe("given a run of 10 rows stopped after 5 of them answered, out of order", () => {
    /** @scenario "A column header says how much of the dataset its score covers" */
    it("shows the score together with 5/10", () => {
      renderRun(runOf({ answered: [0, 1, 2, 4, 6], total: 10 }));

      expect(screen.getByText("100%")).toBeInTheDocument();
      expect(screen.getByText("5/10")).toBeInTheDocument();
    });
  });

  describe("given a run of rows 1 to 5 that answered all five", () => {
    it("shows the score on its own, with no row count", () => {
      renderRun(runOf({ answered: [1, 2, 3, 4, 5], total: 5 }));

      expect(screen.getByText("100%")).toBeInTheDocument();
      expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
    });
  });
});
