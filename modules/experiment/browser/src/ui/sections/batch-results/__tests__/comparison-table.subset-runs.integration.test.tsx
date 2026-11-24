import "@testing-library/jest-dom/vitest";
// @vitest-environment jsdom
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type ComparisonRunData } from "../../batch-evaluation-results.types.ts";
import { ComparisonTable } from "../comparison-table.tsx";

const buildRun = ({
  runIndex,
  heldRows,
  positions,
}: {
  runIndex: number;
  heldRows: number[];
  positions: number;
}): ComparisonRunData => {
  const runId = `run-${runIndex + 1}`;
  const targetId = `target-${runIndex + 1}`;
  return {
    runId,
    runName: `Run ${runIndex + 1}`,
    color: runIndex === 0 ? "#3182ce" : "#dd6b20",
    isLoading: false,
    data: {
      runId,
      experimentId: "exp-1",
      projectId: "p-1",
      createdAt: Date.now() - (2 - runIndex) * 60_000,
      datasetColumns: [{ name: "input", hasImages: false }],
      targetColumns: [
        { id: targetId, name: `Target ${runIndex + 1}`, type: "prompt", outputFields: ["output"] },
      ],
      evaluatorIds: [],
      evaluatorNames: {},
      rows: Array.from({ length: positions }, (_, index) =>
        heldRows.includes(index)
          ? {
              index,
              datasetEntry: { input: `q${index}` },
              targets: {
                [targetId]: {
                  targetId,
                  output: { output: `run ${runIndex + 1} answer ${index}` },
                  cost: null,
                  duration: null,
                  error: null,
                  traceId: null,
                  evaluatorResults: [],
                },
              },
            }
          : { index, datasetEntry: {}, targets: {}, notInRun: true as const },
      ),
    },
  };
};

describe("ComparisonTable over runs of some rows", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given two runs that hold only dataset rows 3 and 4 between them", () => {
    const comparisonData = [
      buildRun({ runIndex: 0, heldRows: [3, 4], positions: 5 }),
      buildRun({ runIndex: 1, heldRows: [3], positions: 4 }),
    ];

    /** @scenario "A comparison of runs of some rows shows only the rows some run holds" */
    it("shows one row per position some run holds, under its dataset number", () => {
      const { container } = renderWithDesignSystem(
        <ComparisonTable comparisonData={comparisonData} disableVirtualization />,
      );

      expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
      expect(screen.getAllByText("q3").length).toBeGreaterThan(0);
      expect(screen.getAllByText("q4").length).toBeGreaterThan(0);
      expect(screen.queryByText("q0")).not.toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
      expect(screen.getByText("run 1 answer 4")).toBeInTheDocument();
      expect(screen.getByText("run 2 answer 3")).toBeInTheDocument();
    });
  });
});
