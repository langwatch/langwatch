import { describe, it, expect, beforeEach } from "vitest";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { createExecutionCellSet, isCellInExecution } from "../utils/executionScope";

describe("Execution Skeleton State", () => {
  beforeEach(() => {
    useEvaluationsV3Store.setState({
      results: {
        status: "idle",
        targetOutputs: {},
        targetMetadata: {},
        evaluatorResults: {},
        errors: {},
      },
    });
  });

  describe("executingCells determines skeleton state", () => {
    it("only cells in executingCells set show as loading", () => {
      // Simulate running a single cell (row 0, target-1)
      const executingCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
      ]);

      useEvaluationsV3Store.setState({
        results: {
          status: "running",
          executingCells,
          targetOutputs: {},
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      });

      const results = useEvaluationsV3Store.getState().results;

      // The cell in execution should be tracked
      expect(results.executingCells?.has("0:target-1")).toBe(true);
      // Other cells should NOT be in the set
      expect(results.executingCells?.has("0:target-2")).toBe(false);
      expect(results.executingCells?.has("1:target-1")).toBe(false);
    });

    it("partial execution preserves existing results for non-executing cells", () => {
      // Set up existing results from a previous run
      useEvaluationsV3Store.setState({
        results: {
          status: "idle",
          targetOutputs: {
            "target-1": ["output row 0", "output row 1"],
            "target-2": ["output row 0", "output row 1"],
          },
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      });

      // Now simulate running just cell (row 0, target-1)
      const executingCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
      ]);

      // Partial execution should preserve existing results
      const currentResults = useEvaluationsV3Store.getState().results;
      useEvaluationsV3Store.setState({
        results: {
          ...currentResults,
          status: "running",
          executingCells,
        },
      });

      const results = useEvaluationsV3Store.getState().results;

      // Existing outputs should still be there
      expect(results.targetOutputs["target-1"]?.[1]).toBe("output row 1");
      expect(results.targetOutputs["target-2"]?.[0]).toBe("output row 0");
      expect(results.targetOutputs["target-2"]?.[1]).toBe("output row 1");
    });

    it("executingCells is cleared when execution completes", () => {
      const executingCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
      ]);

      useEvaluationsV3Store.setState({
        results: {
          status: "running",
          executingCells,
          targetOutputs: {},
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      });

      // Simulate completion
      useEvaluationsV3Store.getState().setResults({
        status: "success",
        executingCells: undefined,
      });

      const results = useEvaluationsV3Store.getState().results;
      expect(results.executingCells).toBeUndefined();
      expect(results.status).toBe("success");
    });

    it("cell with existing content shows loading when being re-executed", () => {
      // Set up existing results
      useEvaluationsV3Store.setState({
        results: {
          status: "idle",
          targetOutputs: {
            "target-1": ["existing output"],
          },
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      });

      // Re-run the same cell
      const executingCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
      ]);

      const currentResults = useEvaluationsV3Store.getState().results;
      useEvaluationsV3Store.setState({
        results: {
          ...currentResults,
          status: "running",
          executingCells,
        },
      });

      const results = useEvaluationsV3Store.getState().results;

      // Cell should be marked as executing even though it has content
      expect(isCellInExecution(results.executingCells!, 0, "target-1")).toBe(true);
      // The existing output is still in the store (will be replaced when new result arrives)
      expect(results.targetOutputs["target-1"]?.[0]).toBe("existing output");
    });

    it("running single target does not affect other targets", () => {
      // Set up existing results for both targets
      useEvaluationsV3Store.setState({
        results: {
          status: "idle",
          targetOutputs: {
            "target-1": ["output 1 row 0", "output 1 row 1"],
            "target-2": ["output 2 row 0", "output 2 row 1"],
          },
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      });

      // Run only target-1
      const executingCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
        { rowIndex: 1, targetId: "target-1" },
      ]);

      const currentResults = useEvaluationsV3Store.getState().results;
      useEvaluationsV3Store.setState({
        results: {
          ...currentResults,
          status: "running",
          executingCells,
        },
      });

      const results = useEvaluationsV3Store.getState().results;

      // target-1 cells should be executing
      expect(isCellInExecution(results.executingCells!, 0, "target-1")).toBe(true);
      expect(isCellInExecution(results.executingCells!, 1, "target-1")).toBe(true);

      // target-2 cells should NOT be executing
      expect(isCellInExecution(results.executingCells!, 0, "target-2")).toBe(false);
      expect(isCellInExecution(results.executingCells!, 1, "target-2")).toBe(false);

      // target-2 outputs should be untouched
      expect(results.targetOutputs["target-2"]?.[0]).toBe("output 2 row 0");
      expect(results.targetOutputs["target-2"]?.[1]).toBe("output 2 row 1");
    });

    it("concurrent executions merge executingCells", () => {
      // Start with no executing cells
      useEvaluationsV3Store.setState({
        results: {
          status: "idle",
          targetOutputs: {},
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      });

      // First execution starts for target-1
      const target1Cells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
        { rowIndex: 1, targetId: "target-1" },
      ]);

      useEvaluationsV3Store.setState((state) => ({
        results: {
          ...state.results,
          status: "running",
          executingCells: target1Cells,
        },
      }));

      // Second execution starts for target-2 (should merge, not replace)
      const target2Cells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-2" },
        { rowIndex: 1, targetId: "target-2" },
      ]);

      useEvaluationsV3Store.setState((state) => {
        const existingCells = state.results.executingCells;
        const mergedCells = existingCells
          ? new Set([...existingCells, ...target2Cells])
          : target2Cells;

        return {
          results: {
            ...state.results,
            status: "running",
            executingCells: mergedCells,
          },
        };
      });

      const results = useEvaluationsV3Store.getState().results;

      // Both targets should have executing cells
      expect(isCellInExecution(results.executingCells!, 0, "target-1")).toBe(true);
      expect(isCellInExecution(results.executingCells!, 1, "target-1")).toBe(true);
      expect(isCellInExecution(results.executingCells!, 0, "target-2")).toBe(true);
      expect(isCellInExecution(results.executingCells!, 1, "target-2")).toBe(true);

      // Total should be 4 cells
      expect(results.executingCells?.size).toBe(4);
    });

    it("completing one execution only removes its cells", () => {
      // Set up two concurrent executions
      const allCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
        { rowIndex: 1, targetId: "target-1" },
        { rowIndex: 0, targetId: "target-2" },
        { rowIndex: 1, targetId: "target-2" },
      ]);

      useEvaluationsV3Store.setState({
        results: {
          status: "running",
          executingCells: allCells,
          targetOutputs: {},
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      });

      // target-1 execution completes - remove only target-1 cells
      const target1CellsToRemove = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
        { rowIndex: 1, targetId: "target-1" },
      ]);

      useEvaluationsV3Store.setState((state) => {
        if (!state.results.executingCells) return state;

        const remainingCells = new Set(
          [...state.results.executingCells].filter(
            (cellKey) => !target1CellsToRemove.has(cellKey)
          )
        );

        return {
          results: {
            ...state.results,
            executingCells: remainingCells.size > 0 ? remainingCells : undefined,
          },
        };
      });

      const results = useEvaluationsV3Store.getState().results;

      // target-1 cells should be gone
      expect(isCellInExecution(results.executingCells!, 0, "target-1")).toBe(false);
      expect(isCellInExecution(results.executingCells!, 1, "target-1")).toBe(false);

      // target-2 cells should still be executing
      expect(isCellInExecution(results.executingCells!, 0, "target-2")).toBe(true);
      expect(isCellInExecution(results.executingCells!, 1, "target-2")).toBe(true);

      // Only 2 cells should remain
      expect(results.executingCells?.size).toBe(2);
    });
  });
});
