import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { experimentConfig } from "../experiment.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "experiment", config: experimentConfig }], environment })
    .experiment;

describe("experiment server configuration", () => {
  describe("given a deployment that names EVAL_V3_CONCURRENCY", () => {
    /** @scenario "A run's cell window defaults to main's concurrency knob" */
    it("reads that many cells at once", () => {
      expect(read({ EVAL_V3_CONCURRENCY: "4" }).runConcurrency).toBe(4);
    });
  });

  describe("given a deployment that names none", () => {
    /** @scenario "A run's cell window defaults to main's concurrency knob" */
    it("reads ten, main's default", () => {
      expect(read({}).runConcurrency).toBe(10);
    });
  });

  describe("given a concurrency that is not a positive whole number", () => {
    it("refuses the boot", () => {
      expect(() => read({ EVAL_V3_CONCURRENCY: "0" })).toThrow(ConfigParseError);
    });
  });

  describe("given a deployment that names the cell budgets", () => {
    it("reads both budgets", () => {
      const config = read({ EVAL_V3_PROJECT_CELL_BUDGET: "40", EVAL_V3_GLOBAL_CELL_BUDGET: "200" });
      expect(config.projectCellBudget).toBe(40);
      expect(config.globalCellBudget).toBe(200);
    });
  });

  describe("given a deployment that names no cell budget", () => {
    /** @scenario "A deployment that names no project budget shares a budget of 24" */
    it("shares a project budget of 24 and sets no global budget", () => {
      expect(read({}).projectCellBudget).toBe(24);
      const blank = read({ EVAL_V3_PROJECT_CELL_BUDGET: "" });
      expect(blank.projectCellBudget).toBe(24);
      expect(blank.globalCellBudget).toBeUndefined();
    });
  });

  describe("given a cell budget that is not a positive whole number", () => {
    it("refuses the boot", () => {
      expect(() => read({ EVAL_V3_PROJECT_CELL_BUDGET: "0" })).toThrow(ConfigParseError);
    });
  });
});
