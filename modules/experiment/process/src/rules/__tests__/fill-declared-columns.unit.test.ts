/**
 * A column the dataset declares reaches every row, empty or not; a column it
 * does not declare is never added.
 * @see specs/experiments-v3/execution-inputs.feature
 */
import { describe, expect, it } from "vitest";

import { applyParametersToRows, fillDeclaredColumns } from "../experiment-execution-data.rules.ts";

const columns = [
  { id: "input", name: "input", type: "string" },
  { id: "environment", name: "environment", type: "string" },
];

describe("fillDeclaredColumns", () => {
  describe("given a column no row has a value in", () => {
    /** @scenario "A column empty in every row is sent as empty text" */
    it("gives every row that column as empty text", () => {
      const rows = fillDeclaredColumns({
        rows: [{ input: "hi" }, { input: "there", environment: undefined }],
        columns,
      });

      expect(rows).toEqual([
        { input: "hi", environment: "" },
        { input: "there", environment: "" },
      ]);
    });

    /** @scenario "A column empty in every row is sent as empty text" */
    it("keeps the empty text a row already holds", () => {
      const rows = fillDeclaredColumns({ rows: [{ input: "hi", environment: "" }], columns });

      expect(rows).toEqual([{ input: "hi", environment: "" }]);
    });
  });

  describe("given a dataset with only an input column", () => {
    /** @scenario "A column the dataset does not have is not added to the rows" */
    it("adds no other key to the rows", () => {
      const rows = fillDeclaredColumns({
        rows: [{ input: "hi" }],
        columns: [{ name: "input" }],
      });

      expect(rows[0]).not.toHaveProperty("environment");
    });
  });

  describe("given a run parameter naming a column that is empty in every row", () => {
    /** @scenario "A parameter overrides a column that is empty in every row" */
    it("sets that column to the parameter on every row", () => {
      const { rows } = applyParametersToRows({
        rows: fillDeclaredColumns({ rows: [{ input: "a" }, { input: "b" }], columns }),
        columns,
        parameters: { environment: "staging" },
      });

      expect(rows.map((row) => row.environment)).toEqual(["staging", "staging"]);
    });
  });
});
