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
});
