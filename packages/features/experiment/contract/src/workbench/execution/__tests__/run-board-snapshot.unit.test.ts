/**
 * @see specs/experiments-v3/run-board-snapshot.feature
 *
 * A run holds a snapshot of the board it was started from: every cell outside
 * the execution scope is copied in as it stood, and the cells inside it fill in
 * as they execute. Before this, a run scoped to one column declared every
 * column in its target metadata but held rows for one of them, and the results
 * page drew a column with no data in it.
 */
import { describe, expect, it } from "vitest";
import type { TargetConfig } from "../../../experiment-workbench";
import type { BoardResults } from "../build-execution-request";
import { planBoardCarryOver } from "../build-execution-request";
import type { CarriedOverCell, ExecutionScope } from "../types";

const TARGETS = [
  { id: "target-A", type: "prompt" },
  { id: "target-B", type: "prompt" },
] as unknown as TargetConfig[];

const ROWS = [{ question: "one" }, { question: "two" }];

/** A board where both columns answered both rows and both were scored. */
const fullBoard = (): Partial<BoardResults> => ({
  targetOutputs: {
    "target-A": ["A one", "A two"],
    "target-B": ["B one", "B two"],
  },
  targetMetadata: {
    "target-A": [
      { cost: 0.1, duration: 100, traceId: "trace-a0" },
      { cost: 0.2, duration: 200 },
    ],
    "target-B": [
      { cost: 0.3, duration: 300 },
      { cost: 0.4, duration: 400 },
    ],
  },
  evaluatorResults: {
    "target-A": {
      exact: [
        { status: "processed", passed: true, score: 1 },
        { status: "processed", passed: false, score: 0 },
      ],
    },
    "target-B": {
      exact: [
        { status: "processed", passed: true, score: 1 },
        { status: "processed", passed: true, score: 1 },
      ],
    },
  },
  errors: {},
});

const carryOver = ({
  scope,
  results,
}: {
  scope: ExecutionScope;
  results?: Partial<BoardResults>;
}) =>
  planBoardCarryOver({
    targets: TARGETS,
    scope,
    datasetRows: ROWS,
    results,
  });

/** The carried cell for one board position, if it was carried at all. */
const cellAt = (
  cells: CarriedOverCell[],
  { rowIndex, targetId }: { rowIndex: number; targetId: string },
) => cells.find((cell) => cell.rowIndex === rowIndex && cell.targetId === targetId);

describe("given a board with two columns that both have results", () => {
  describe("when one column is run", () => {
    /** @scenario "A run of one column carries the other columns from the board" */
    it("carries the other column's cells as they stood on the board", () => {
      const carried = carryOver({
        scope: { type: "target", targetId: "target-A" },
        results: fullBoard(),
      });

      expect(cellAt(carried, { rowIndex: 0, targetId: "target-B" })).toMatchObject({
        output: "B one",
        cost: 0.3,
        duration: 300,
      });
      expect(cellAt(carried, { rowIndex: 1, targetId: "target-B" })).toMatchObject({
        output: "B two",
        cost: 0.4,
        duration: 400,
      });
    });

    /** @scenario "A run of one column carries the other columns from the board" */
    it("does not carry the cells of the column being run", () => {
      const carried = carryOver({
        scope: { type: "target", targetId: "target-A" },
        results: fullBoard(),
      });

      expect(carried.filter((cell) => cell.targetId === "target-A")).toHaveLength(0);
    });

    /** @scenario "A run of one column carries the other columns' verdicts too" */
    it("carries the other column's verdicts", () => {
      const carried = carryOver({
        scope: { type: "target", targetId: "target-A" },
        results: fullBoard(),
      });

      expect(cellAt(carried, { rowIndex: 0, targetId: "target-B" })?.evaluatorResults).toEqual([
        {
          evaluatorId: "exact",
          result: { status: "processed", passed: true, score: 1 },
        },
      ]);
    });
  });

  describe("when every column is run", () => {
    /** @scenario "A full run carries nothing" */
    it("carries nothing, because the run covers every cell itself", () => {
      expect(carryOver({ scope: { type: "full" }, results: fullBoard() })).toEqual([]);
    });
  });

  describe("when one row is run", () => {
    /** @scenario "A run of one row carries the other rows" */
    it("carries the rows the run leaves alone", () => {
      const carried = carryOver({
        scope: { type: "rows", rowIndices: [0] },
        results: fullBoard(),
      });

      // One carried cell per column, for the row the run left alone.
      expect(carried.map((cell) => cell.rowIndex)).toEqual([1, 1]);
      expect(cellAt(carried, { rowIndex: 1, targetId: "target-A" })?.output).toBe("A two");
      expect(cellAt(carried, { rowIndex: 1, targetId: "target-B" })?.output).toBe("B two");
    });
  });
});

describe("given a board with a column that answered only its first row", () => {
  describe("when a different column is run", () => {
    /** @scenario "A cell with nothing on the board is not carried" */
    it("carries only the row that has something on it", () => {
      const carried = carryOver({
        scope: { type: "target", targetId: "target-A" },
        results: {
          targetOutputs: { "target-B": ["B one"] },
          // A row holding cost but neither an output nor a failure is a
          // leftover, not a result. Carrying it would draw an empty cell with
          // a price on it.
          targetMetadata: { "target-B": [{ cost: 0.3 }, { cost: 0.9 }] },
          evaluatorResults: {},
          errors: {},
        },
      });

      expect(carried).toHaveLength(1);
      expect(carried[0]).toMatchObject({
        rowIndex: 0,
        targetId: "target-B",
        output: "B one",
      });
    });
  });
});

describe("given a board with a column whose first row failed", () => {
  describe("when a different column is run", () => {
    /** @scenario "A run of one column carries the other columns' failures too" */
    it("carries the failure as it stood on the board", () => {
      const carried = carryOver({
        scope: { type: "target", targetId: "target-A" },
        results: {
          targetOutputs: {},
          targetMetadata: {
            "target-B": [{ domainError: { code: "http_error" } as never }],
          },
          evaluatorResults: {},
          errors: { "target-B": ["http_error"] },
        },
      });

      expect(carried).toHaveLength(1);
      expect(carried[0]).toMatchObject({
        rowIndex: 0,
        targetId: "target-B",
        error: "http_error",
      });
    });
  });
});

describe("given a board with no results at all", () => {
  describe("when one column is run", () => {
    /** @scenario "A run with no board behind it carries nothing" */
    it("carries nothing", () => {
      expect(carryOver({ scope: { type: "target", targetId: "target-A" } })).toEqual([]);
    });
  });
});
