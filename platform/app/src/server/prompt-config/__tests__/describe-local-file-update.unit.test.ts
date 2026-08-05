import { describe, expect, it } from "vitest";
import { describeLocalFileUpdate } from "../describe-local-file-update";

describe("describeLocalFileUpdate()", () => {
  describe("given no differences were computed", () => {
    it("falls back to the generic message", () => {
      expect(describeLocalFileUpdate(undefined)).toBe(
        "Updated from local file",
      );
      expect(describeLocalFileUpdate([])).toBe("Updated from local file");
    });
  });

  describe("given the sync changed a single field", () => {
    it("names that field in the commit message", () => {
      expect(describeLocalFileUpdate(["model: gpt-4 → gpt-4o-mini"])).toBe(
        "Updated from local file (model: gpt-4 → gpt-4o-mini)",
      );
    });
  });

  describe("given the sync changed multiple fields", () => {
    it("lists every changed field in the commit message", () => {
      expect(
        describeLocalFileUpdate([
          "model: gpt-4 → gpt-4o-mini",
          "temperature: 0.7 → 0.3",
          "prompt content differs",
        ]),
      ).toBe(
        "Updated from local file (model: gpt-4 → gpt-4o-mini; temperature: 0.7 → 0.3; prompt content differs)",
      );
    });
  });
});
