import { describe, it, expect } from "vitest";
import {
  computeExecutionCells,
  createExecutionCellSet,
  isCellInExecution,
  getExecutionCellCount,
  getExecutionRowIndices,
  getExecutionTargetIds,
} from "../executionScope";
import type { ExecutionScope } from "~/server/evaluations-v3/execution/types";

describe("executionScope utilities", () => {
  // Sample data for tests
  const targetIds = ["target-1", "target-2"];
  const datasetRows = [
    { question: "Hello", expected: "Hi" },         // row 0 - non-empty
    { question: "World", expected: "Earth" },      // row 1 - non-empty
    { question: "", expected: "" },                // row 2 - empty (should be skipped)
    { question: "Foo", expected: "Bar" },          // row 3 - non-empty
  ];

  describe("computeExecutionCells", () => {
    describe("full scope", () => {
      it("returns all non-empty cells for full execution", () => {
        const scope: ExecutionScope = { type: "full" };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        // 3 non-empty rows * 2 targets = 6 cells
        expect(cells).toHaveLength(6);
        expect(cells).toContainEqual({ rowIndex: 0, targetId: "target-1" });
        expect(cells).toContainEqual({ rowIndex: 0, targetId: "target-2" });
        expect(cells).toContainEqual({ rowIndex: 1, targetId: "target-1" });
        expect(cells).toContainEqual({ rowIndex: 1, targetId: "target-2" });
        expect(cells).toContainEqual({ rowIndex: 3, targetId: "target-1" });
        expect(cells).toContainEqual({ rowIndex: 3, targetId: "target-2" });
      });

      it("excludes empty rows", () => {
        const scope: ExecutionScope = { type: "full" };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        // Row 2 is empty, should not be included
        const row2Cells = cells.filter((c) => c.rowIndex === 2);
        expect(row2Cells).toHaveLength(0);
      });
    });

    describe("rows scope", () => {
      it("returns cells for specified non-empty rows only", () => {
        const scope: ExecutionScope = { type: "rows", rowIndices: [0, 1] };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        // 2 rows * 2 targets = 4 cells
        expect(cells).toHaveLength(4);
        expect(cells).toContainEqual({ rowIndex: 0, targetId: "target-1" });
        expect(cells).toContainEqual({ rowIndex: 0, targetId: "target-2" });
        expect(cells).toContainEqual({ rowIndex: 1, targetId: "target-1" });
        expect(cells).toContainEqual({ rowIndex: 1, targetId: "target-2" });
      });

      it("skips empty rows even if explicitly requested", () => {
        const scope: ExecutionScope = { type: "rows", rowIndices: [0, 2] }; // row 2 is empty
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        // Only row 0, row 2 is empty and skipped
        expect(cells).toHaveLength(2);
        expect(cells).toContainEqual({ rowIndex: 0, targetId: "target-1" });
        expect(cells).toContainEqual({ rowIndex: 0, targetId: "target-2" });
      });

      it("filters out invalid row indices", () => {
        const scope: ExecutionScope = { type: "rows", rowIndices: [0, 100, -1] };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        // Only row 0 is valid
        expect(cells).toHaveLength(2);
      });

      it("returns cells for all targets when running specific rows", () => {
        const scope: ExecutionScope = { type: "rows", rowIndices: [3] };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        // Row 3 with both targets
        expect(cells).toHaveLength(2);
        expect(cells).toContainEqual({ rowIndex: 3, targetId: "target-1" });
        expect(cells).toContainEqual({ rowIndex: 3, targetId: "target-2" });
      });
    });

    describe("target scope", () => {
      it("returns cells for all non-empty rows for a single target", () => {
        const scope: ExecutionScope = { type: "target", targetId: "target-1" };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        // 3 non-empty rows * 1 target = 3 cells
        expect(cells).toHaveLength(3);
        expect(cells).toContainEqual({ rowIndex: 0, targetId: "target-1" });
        expect(cells).toContainEqual({ rowIndex: 1, targetId: "target-1" });
        expect(cells).toContainEqual({ rowIndex: 3, targetId: "target-1" });
      });

      it("only includes the specified target", () => {
        const scope: ExecutionScope = { type: "target", targetId: "target-2" };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        // All cells should be for target-2
        expect(cells.every((c) => c.targetId === "target-2")).toBe(true);
        expect(cells.some((c) => c.targetId === "target-1")).toBe(false);
      });

      it("returns empty array for non-existent target", () => {
        const scope: ExecutionScope = { type: "target", targetId: "target-999" };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        expect(cells).toHaveLength(0);
      });
    });

    describe("cell scope", () => {
      it("returns exactly one cell for a single cell execution", () => {
        const scope: ExecutionScope = { type: "cell", targetId: "target-1", rowIndex: 0 };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        expect(cells).toHaveLength(1);
        expect(cells[0]).toEqual({ rowIndex: 0, targetId: "target-1" });
      });

      it("returns empty array when cell row is empty", () => {
        const scope: ExecutionScope = { type: "cell", targetId: "target-1", rowIndex: 2 }; // row 2 is empty
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        expect(cells).toHaveLength(0);
      });

      it("returns empty array for non-existent target in cell scope", () => {
        const scope: ExecutionScope = { type: "cell", targetId: "target-999", rowIndex: 0 };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        expect(cells).toHaveLength(0);
      });

      it("returns empty array for out-of-bounds row index", () => {
        const scope: ExecutionScope = { type: "cell", targetId: "target-1", rowIndex: 100 };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows });

        expect(cells).toHaveLength(0);
      });
    });

    describe("edge cases", () => {
      it("handles empty dataset", () => {
        const scope: ExecutionScope = { type: "full" };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows: [] });

        expect(cells).toHaveLength(0);
      });

      it("handles empty targets list", () => {
        const scope: ExecutionScope = { type: "full" };
        const cells = computeExecutionCells({ scope, targetIds: [], datasetRows });

        expect(cells).toHaveLength(0);
      });

      it("handles dataset with all empty rows", () => {
        const allEmptyRows = [
          { question: "", expected: "" },
          { question: "   ", expected: null },
        ];
        const scope: ExecutionScope = { type: "full" };
        const cells = computeExecutionCells({ scope, targetIds, datasetRows: allEmptyRows });

        expect(cells).toHaveLength(0);
      });
    });
  });

  describe("createExecutionCellSet and isCellInExecution", () => {
    it("creates a set for fast lookup", () => {
      const cells = [
        { rowIndex: 0, targetId: "target-1" },
        { rowIndex: 1, targetId: "target-2" },
      ];
      const cellSet = createExecutionCellSet(cells);

      expect(isCellInExecution(cellSet, 0, "target-1")).toBe(true);
      expect(isCellInExecution(cellSet, 1, "target-2")).toBe(true);
      expect(isCellInExecution(cellSet, 0, "target-2")).toBe(false);
      expect(isCellInExecution(cellSet, 2, "target-1")).toBe(false);
    });
  });

  describe("getExecutionCellCount", () => {
    it("returns correct count for full scope", () => {
      const scope: ExecutionScope = { type: "full" };
      const count = getExecutionCellCount({ scope, targetIds, datasetRows });

      // 3 non-empty rows * 2 targets = 6
      expect(count).toBe(6);
    });

    it("returns correct count for single cell", () => {
      const scope: ExecutionScope = { type: "cell", targetId: "target-1", rowIndex: 0 };
      const count = getExecutionCellCount({ scope, targetIds, datasetRows });

      expect(count).toBe(1);
    });

    it("returns correct count for single target", () => {
      const scope: ExecutionScope = { type: "target", targetId: "target-1" };
      const count = getExecutionCellCount({ scope, targetIds, datasetRows });

      // 3 non-empty rows * 1 target = 3
      expect(count).toBe(3);
    });
  });

  describe("getExecutionRowIndices", () => {
    it("returns unique row indices being executed", () => {
      const cells = [
        { rowIndex: 0, targetId: "target-1" },
        { rowIndex: 0, targetId: "target-2" },
        { rowIndex: 3, targetId: "target-1" },
      ];
      const rowIndices = getExecutionRowIndices(cells);

      expect(rowIndices.size).toBe(2);
      expect(rowIndices.has(0)).toBe(true);
      expect(rowIndices.has(3)).toBe(true);
    });
  });

  describe("getExecutionTargetIds", () => {
    it("returns unique target IDs being executed", () => {
      const cells = [
        { rowIndex: 0, targetId: "target-1" },
        { rowIndex: 1, targetId: "target-1" },
        { rowIndex: 0, targetId: "target-2" },
      ];
      const targetIds = getExecutionTargetIds(cells);

      expect(targetIds.size).toBe(2);
      expect(targetIds.has("target-1")).toBe(true);
      expect(targetIds.has("target-2")).toBe(true);
    });
  });

  describe("real-world scenarios", () => {
    it("scenario: user runs single cell on row that already has results", () => {
      // Row 0 already has results, user clicks to re-run just target-1
      const scope: ExecutionScope = { type: "cell", targetId: "target-1", rowIndex: 0 };
      const cells = computeExecutionCells({ scope, targetIds, datasetRows });
      const cellSet = createExecutionCellSet(cells);

      // Only this specific cell should be in execution
      expect(cells).toHaveLength(1);
      expect(isCellInExecution(cellSet, 0, "target-1")).toBe(true);
      expect(isCellInExecution(cellSet, 0, "target-2")).toBe(false); // Same row, different target - NOT in execution
      expect(isCellInExecution(cellSet, 1, "target-1")).toBe(false); // Different row - NOT in execution
    });

    it("scenario: user selects 2 specific rows to run", () => {
      const scope: ExecutionScope = { type: "rows", rowIndices: [0, 3] };
      const cells = computeExecutionCells({ scope, targetIds, datasetRows });
      const cellSet = createExecutionCellSet(cells);

      // Only rows 0 and 3, all targets
      expect(cells).toHaveLength(4);
      expect(isCellInExecution(cellSet, 0, "target-1")).toBe(true);
      expect(isCellInExecution(cellSet, 0, "target-2")).toBe(true);
      expect(isCellInExecution(cellSet, 3, "target-1")).toBe(true);
      expect(isCellInExecution(cellSet, 3, "target-2")).toBe(true);
      expect(isCellInExecution(cellSet, 1, "target-1")).toBe(false); // Row 1 not selected
    });

    it("scenario: user runs single target column", () => {
      const scope: ExecutionScope = { type: "target", targetId: "target-2" };
      const cells = computeExecutionCells({ scope, targetIds, datasetRows });
      const cellSet = createExecutionCellSet(cells);

      // All non-empty rows, but only target-2
      expect(cells).toHaveLength(3);
      expect(isCellInExecution(cellSet, 0, "target-2")).toBe(true);
      expect(isCellInExecution(cellSet, 1, "target-2")).toBe(true);
      expect(isCellInExecution(cellSet, 3, "target-2")).toBe(true);
      expect(isCellInExecution(cellSet, 0, "target-1")).toBe(false); // Different target
    });

    it("scenario: progress shows correct count for partial execution", () => {
      // When running just target-1, progress should show 0/3, not 0/6
      const scope: ExecutionScope = { type: "target", targetId: "target-1" };
      const count = getExecutionCellCount({ scope, targetIds, datasetRows });

      expect(count).toBe(3); // 3 non-empty rows for 1 target
    });
  });
});
