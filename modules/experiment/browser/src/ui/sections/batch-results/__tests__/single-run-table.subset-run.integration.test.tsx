import "@testing-library/jest-dom/vitest";
/**
 * The results table of a run of some rows draws only the rows the run holds, under their
 * dataset numbers.
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

const HELD_ROWS = [0, 2, 5];

const subsetRun = (): ExperimentRunWithItems => ({
  experimentId: "experiment_1",
  runId: "run_1",
  projectId: "project_1",
  repeat: null,
  targets: [{ id: "target_a", name: "support-prompt", type: "prompt" }],
  dataset: HELD_ROWS.map((index) => ({
    index,
    targetId: "target_a",
    entry: { question: `question ${index + 1}` },
    predicted: { output: `answer ${index + 1}` },
  })),
  evaluations: [],
  timestamps: { createdAt: 1_000, updatedAt: 2_000, finishedAt: 2_000 },
  completeness: {
    complete: true,
    dataset: { received: HELD_ROWS.length, expected: HELD_ROWS.length },
    evaluations: { received: 0, expected: 0 },
  },
});

afterEach(cleanup);

describe("the results table of a run of some rows", () => {
  describe("given a run that holds dataset rows 0, 2 and 5", () => {
    /** @scenario "The results table shows only the rows a run holds, under their dataset numbers" */
    it("draws three rows numbered by their dataset position", () => {
      const { container } = renderWithDesignSystem(
        <BatchEvaluationResultsTable
          data={transformBatchEvaluationData(subsetRun())}
          isLoading={false}
          disableVirtualization
        />,
      );

      const rows = Array.from(container.querySelectorAll("tbody tr"));
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.querySelector("td")?.textContent?.trim())).toEqual([
        "1",
        "3",
        "6",
      ]);
      expect(screen.getByText("question 3")).toBeInTheDocument();
      expect(screen.queryByText("question 2")).not.toBeInTheDocument();
    });
  });
});
