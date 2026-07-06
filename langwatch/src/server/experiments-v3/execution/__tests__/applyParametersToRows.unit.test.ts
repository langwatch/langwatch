/**
 * Unit tests for applyParametersToRows: binding caller-provided parameters as
 * constant columns across rows, including the no-dataset synthetic-row case.
 */
import { describe, expect, it } from "vitest";
import { applyParametersToRows } from "../dataLoader";

describe("applyParametersToRows", () => {
  describe("given rows and a parameter for a new field", () => {
    describe("when the parameters are applied", () => {
      /** @scenario "Parameters bind as constant columns overriding entry fields on every row" */
      it("sets the parameter on every row and preserves the original values", () => {
        const { rows, columns } = applyParametersToRows({
          rows: [{ question: "a" }, { question: "b" }, { question: "c" }],
          columns: [{ id: "question", name: "question", type: "string" }],
          parameters: { feature_flag: "variant-b" },
        });

        expect(rows).toEqual([
          { question: "a", feature_flag: "variant-b" },
          { question: "b", feature_flag: "variant-b" },
          { question: "c", feature_flag: "variant-b" },
        ]);
        expect(columns.map((c) => c.name)).toContain("feature_flag");
      });
    });
  });

  describe("given a parameter that names an existing column", () => {
    describe("when the parameters are applied", () => {
      /** @scenario "A parameter that names a dataset column overrides it for every row" */
      it("overrides that column on every row without duplicating it", () => {
        const { rows, columns } = applyParametersToRows({
          rows: [{ model: "gpt-5-nano" }, { model: "gpt-5" }],
          columns: [{ id: "model", name: "model", type: "string" }],
          parameters: { model: "gpt-5-mini" },
        });

        expect(rows.every((r) => r.model === "gpt-5-mini")).toBe(true);
        expect(columns.filter((c) => c.name === "model")).toHaveLength(1);
      });
    });
  });

  describe("given no rows and parameters only", () => {
    describe("when the parameters are applied", () => {
      /** @scenario "Parameters with no dataset evaluate a single synthetic row" */
      it("synthesizes a single row containing the parameters", () => {
        const { rows } = applyParametersToRows({
          rows: [],
          columns: [],
          parameters: { feature_flag: "on", threshold: 5, enabled: true },
        });

        expect(rows).toEqual([
          { feature_flag: "on", threshold: 5, enabled: true },
        ]);
      });
    });
  });

  describe("given no parameters", () => {
    describe("when the function is called", () => {
      it("returns the rows and columns unchanged", () => {
        const input = {
          rows: [{ a: 1 }],
          columns: [{ id: "a", name: "a", type: "string" }],
        };

        const result = applyParametersToRows(input);

        expect(result.rows).toEqual(input.rows);
        expect(result.columns).toEqual(input.columns);
      });
    });
  });
});
