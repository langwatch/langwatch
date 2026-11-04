import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";

import { parseDatasetVersionFlag } from "../datasetVersionFlag";

describe("parseDatasetVersionFlag()", () => {
  describe("when the value is a whole number from 1", () => {
    it("answers that number", () => {
      expect(parseDatasetVersionFlag("1")).toBe(1);
      expect(parseDatasetVersionFlag("42")).toBe(42);
    });
  });

  describe("when the value is not a whole number from 1", () => {
    it.each(["0", "-1", "1.5", "v2", "", "1e3"])("refuses %j as a usage error", (value) => {
      expect(() => parseDatasetVersionFlag(value)).toThrow(InvalidArgumentError);
    });
  });
});
