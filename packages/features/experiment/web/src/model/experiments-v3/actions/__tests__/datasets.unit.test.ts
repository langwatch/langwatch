/**
 * @see specs/experiments-v3/workbench-actions.feature
 */
import { describe, expect, it } from "vitest";
import {
  addColumn,
  addRows,
  setCellValue,
  TransformError,
} from "../transforms";
import { baseState, refusalCode, savedDataset } from "./workbench-fixtures";

describe("setCellValue", () => {
  it("writes the cell", () => {
    const { state } = setCellValue({
      state: baseState(),
      payload: {
        datasetId: "ds-1",
        rowIndex: 1,
        columnId: "input",
        value: "edited",
      },
    });

    expect(state.datasets[0]!.inline!.records.input).toEqual([
      "first question",
      "edited",
    ]);
  });

  it("pads a short column up to the row being written", () => {
    const { state } = setCellValue({
      state: baseState(),
      payload: {
        datasetId: "ds-1",
        rowIndex: 3,
        columnId: "input",
        value: "fourth",
      },
    });

    expect(state.datasets[0]!.inline!.records.input).toEqual([
      "first question",
      "second question",
      "",
      "fourth",
    ]);
  });

  describe("when the dataset is saved", () => {
    /** @scenario "Rows and columns of a saved dataset are not edited through the workbench" */
    it("refuses with dataset_not_editable", () => {
      const state = baseState();
      state.datasets.push(savedDataset());

      expect(
        refusalCode(() =>
          setCellValue({
            state,
            payload: {
              datasetId: "ds-saved",
              rowIndex: 0,
              columnId: "input",
              value: "edited",
            },
          }),
        ),
      ).toBe("dataset_not_editable");
    });
  });

  describe("when the dataset does not exist", () => {
    it("refuses with dataset_not_found", () => {
      expect(
        refusalCode(() =>
          setCellValue({
            state: baseState(),
            payload: {
              datasetId: "nope",
              rowIndex: 0,
              columnId: "input",
              value: "edited",
            },
          }),
        ),
      ).toBe("dataset_not_found");
    });

    it("throws TransformError, carrying the ids the caller named", () => {
      try {
        setCellValue({
          state: baseState(),
          payload: {
            datasetId: "nope",
            rowIndex: 0,
            columnId: "input",
            value: "",
          },
        });
        expect.unreachable("the unknown dataset must refuse");
      } catch (error) {
        expect(error).toBeInstanceOf(TransformError);
        expect((error as TransformError).code).toBe("dataset_not_found");
        expect((error as TransformError).meta).toEqual({ datasetId: "nope" });
      }
    });
  });

  describe("when the column does not exist", () => {
    /** @scenario "A cell is only written to a column the table shows" */
    it("refuses with column_not_found", () => {
      expect(
        refusalCode(() =>
          setCellValue({
            state: baseState(),
            payload: {
              datasetId: "ds-1",
              rowIndex: 0,
              columnId: "nope",
              value: "edited",
            },
          }),
        ),
      ).toBe("column_not_found");
    });

    /** @scenario "A cell is only written to a column the table shows" */
    it("leaves the records untouched", () => {
      const state = baseState();

      refusalCode(() =>
        setCellValue({
          state,
          payload: {
            datasetId: "ds-1",
            rowIndex: 0,
            columnId: "nope",
            value: "edited",
          },
        }),
      );

      expect(Object.keys(state.datasets[0]!.inline!.records)).toEqual([
        "input",
        "expected_output",
      ]);
    });
  });
});

describe("addColumn", () => {
  it("adds the column to the reference and the inline block, filled with empty cells", () => {
    const { state, result } = addColumn({
      state: baseState(),
      payload: { datasetId: "ds-1", column: { name: "context" } },
    });

    expect(result?.columnId).toBe("context");
    expect(state.datasets[0]!.columns.map((c) => c.id)).toContain("context");
    expect(state.datasets[0]!.inline!.columns.map((c) => c.id)).toContain(
      "context",
    );
    expect(state.datasets[0]!.inline!.records.context).toEqual(["", ""]);
  });

  it("refuses a column that already exists", () => {
    expect(
      refusalCode(() =>
        addColumn({
          state: baseState(),
          payload: { datasetId: "ds-1", column: { name: "input" } },
        }),
      ),
    ).toBe("column_already_exists");
  });

  it("refuses a saved dataset", () => {
    const state = baseState();
    state.datasets.push(savedDataset());

    expect(
      refusalCode(() =>
        addColumn({
          state,
          payload: { datasetId: "ds-saved", column: { name: "context" } },
        }),
      ),
    ).toBe("dataset_not_editable");
  });
});

describe("addRows", () => {
  /** @scenario "New rows land in every column" */
  it("appends rows column-first, by column id or column name", () => {
    const { state, result } = addRows({
      state: baseState(),
      payload: {
        datasetId: "ds-1",
        rows: [
          { input: "third question", expected_output: "third answer" },
          { input: "fourth question" },
        ],
      },
    });

    expect(state.datasets[0]!.inline!.records).toEqual({
      input: [
        "first question",
        "second question",
        "third question",
        "fourth question",
      ],
      expected_output: ["first answer", "second answer", "third answer", ""],
    });
    expect(result).toEqual({ datasetId: "ds-1", addedRows: 2, rowCount: 4 });
  });

  it("aligns a ragged column before appending", () => {
    const state = baseState();
    state.datasets[0]!.inline!.records.expected_output = ["first answer"];

    const { state: next } = addRows({
      state,
      payload: { datasetId: "ds-1", rows: [{ input: "third question" }] },
    });

    expect(next.datasets[0]!.inline!.records.expected_output).toEqual([
      "first answer",
      "",
      "",
    ]);
  });

  describe("given a column that only exists in the records", () => {
    /** @scenario "New rows land in every column" */
    it("extends it with the rest so the records stay aligned", () => {
      const state = baseState();
      state.datasets[0]!.inline!.records.hidden = ["kept", "also kept"];

      const { state: next } = addRows({
        state,
        payload: {
          datasetId: "ds-1",
          rows: [{ input: "third question" }, { input: "fourth question" }],
        },
      });

      expect(next.datasets[0]!.inline!.records.hidden).toEqual([
        "kept",
        "also kept",
        "",
        "",
      ]);
      const lengths = Object.values(next.datasets[0]!.inline!.records).map(
        (values) => values.length,
      );
      expect(new Set(lengths)).toEqual(new Set([4]));
    });
  });

  it("refuses a saved dataset", () => {
    const state = baseState();
    state.datasets.push(savedDataset());

    expect(
      refusalCode(() =>
        addRows({
          state,
          payload: { datasetId: "ds-saved", rows: [{ input: "x" }] },
        }),
      ),
    ).toBe("dataset_not_editable");
  });
});
