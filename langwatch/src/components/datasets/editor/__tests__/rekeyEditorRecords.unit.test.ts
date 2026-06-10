import { describe, expect, it } from "vitest";

import {
  rekeyEditorRecords,
  type EditorColumn,
} from "../useDatasetEditorStore";

const columns = (...names: string[]): EditorColumn[] =>
  names.map((name, index) => ({ id: `${name}_${index}`, name, type: "string" }));

describe("rekeyEditorRecords", () => {
  describe("given records keyed by the current column names", () => {
    const records = [
      { id: "r1", input: "hello", expected_output: "world" },
      { id: "r2", input: "foo", expected_output: "bar" },
    ];

    describe("when a column is renamed in place", () => {
      it("carries the values over to the new name", () => {
        const result = rekeyEditorRecords(
          records,
          columns("input", "expected_output"),
          [{ name: "question" }, { name: "expected_output" }],
        );

        expect(result).toEqual([
          { id: "r1", question: "hello", expected_output: "world" },
          { id: "r2", question: "foo", expected_output: "bar" },
        ]);
      });
    });

    describe("when a column is added", () => {
      it("keeps existing values and leaves the new column unset", () => {
        const result = rekeyEditorRecords(
          records,
          columns("input", "expected_output"),
          [{ name: "input" }, { name: "expected_output" }, { name: "context" }],
        );

        expect(result[0]).toEqual({
          id: "r1",
          input: "hello",
          expected_output: "world",
        });
      });
    });

    describe("when a column is removed", () => {
      it("drops its values and keeps the rest", () => {
        const result = rekeyEditorRecords(
          records,
          columns("input", "expected_output"),
          [{ name: "input" }],
        );

        expect(result).toEqual([
          { id: "r1", input: "hello" },
          { id: "r2", input: "foo" },
        ]);
      });
    });

    describe("when two columns swap names", () => {
      it("follows the names, never the positions", () => {
        const result = rekeyEditorRecords(
          records,
          columns("input", "expected_output"),
          [{ name: "expected_output" }, { name: "input" }],
        );

        expect(result[0]).toEqual({
          id: "r1",
          input: "hello",
          expected_output: "world",
        });
      });
    });

    describe("when a rename happens alongside a count change", () => {
      it("does not guess by position and starts the new column empty", () => {
        const result = rekeyEditorRecords(
          records,
          columns("input", "expected_output"),
          [{ name: "question" }],
        );

        expect(result).toEqual([{ id: "r1" }, { id: "r2" }]);
      });
    });
  });
});
