// @vitest-environment jsdom
/**
 * The studio's batch-results tables render on the design system's ListTable,
 * keeping their header row, their rows and the grouped sections' test ids.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  BatchEvaluationData,
  ComparisonRunData,
} from "../../batch-evaluation-results.types.ts";
import { ComparisonTable } from "../comparison-table.tsx";
import { SingleRunTable } from "../single-run-table.tsx";

const CITIES = ["Berlin", "Berlin", "Lisbon"];

function runData({ runId, targetId }: { runId: string; targetId: string }): BatchEvaluationData {
  return {
    runId,
    experimentId: "exp-1",
    projectId: "p-1",
    createdAt: 0,
    datasetColumns: [
      { name: "input", hasImages: false },
      { name: "city", hasImages: false },
    ],
    targetColumns: [{ id: targetId, name: "Target", type: "prompt", outputFields: ["output"] }],
    evaluatorIds: [],
    evaluatorNames: {},
    rows: CITIES.map((city, index) => ({
      index,
      datasetEntry: { input: `question ${index}`, city },
      targets: {
        [targetId]: {
          targetId,
          output: { output: `answer ${index}` },
          cost: null,
          duration: null,
          error: null,
          traceId: null,
          evaluatorResults: [],
        },
      },
    })),
  };
}

const COMPARISON: ComparisonRunData[] = [1, 2].map((n) => ({
  runId: `run-${n}`,
  runName: `Run ${n}`,
  color: "#3182ce",
  isLoading: false,
  data: runData({ runId: `run-${n}`, targetId: `target-${n}` }),
}));

describe("batch-results tables", () => {
  afterEach(cleanup);

  describe("given one run", () => {
    it("renders a header row and one table row per dataset row", () => {
      renderWithDesignSystem(
        <SingleRunTable
          data={runData({ runId: "run-1", targetId: "t-1" })}
          disableVirtualization
        />,
      );

      const [header, body] = screen.getAllByRole("rowgroup");
      expect(within(header!).getByText("input")).toBeTruthy();
      expect(within(body!).getAllByRole("row")).toHaveLength(CITIES.length);
    });
  });

  describe("given a comparison grouped by a dataset field", () => {
    it("keeps one section per group, each with its header test ids", () => {
      renderWithDesignSystem(
        <ComparisonTable comparisonData={COMPARISON} groupBy="city" disableVirtualization />,
      );

      const berlin = screen.getByTestId("group-section-Berlin");
      expect(within(berlin).getByTestId("group-header-Berlin")).toBeTruthy();
      expect(within(berlin).getByTestId("group-count-Berlin").textContent).toBe("2 rows");
      expect(screen.getByTestId("group-section-Lisbon")).toBeTruthy();
    });
  });
});
