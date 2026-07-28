import { describe, expect, it } from "vitest";

import { codeEvaluatorDisabledReason } from "../codeEvaluatorValidation";

describe("codeEvaluatorDisabledReason", () => {
  describe("given every requirement is met", () => {
    it("returns null so the button is enabled with no explanation", () => {
      expect(
        codeEvaluatorDisabledReason({
          hasName: true,
          hasCode: true,
          hasInput: true,
          isEditing: false,
        }),
      ).toBeNull();
    });
  });

  describe("given a single missing requirement", () => {
    it("names just that requirement in create mode", () => {
      expect(
        codeEvaluatorDisabledReason({
          hasName: false,
          hasCode: true,
          hasInput: true,
          isEditing: false,
        }),
      ).toBe("Add a name to create the evaluator.");
    });

    it("uses the save wording in edit mode", () => {
      expect(
        codeEvaluatorDisabledReason({
          hasName: false,
          hasCode: true,
          hasInput: true,
          isEditing: true,
        }),
      ).toBe("Add a name to save your changes.");
    });
  });

  describe("given two missing requirements", () => {
    it("joins them with and, without a comma", () => {
      expect(
        codeEvaluatorDisabledReason({
          hasName: false,
          hasCode: false,
          hasInput: true,
          isEditing: false,
        }),
      ).toBe("Add a name and some code to create the evaluator.");
    });
  });

  describe("given all three are missing", () => {
    it("joins them with an Oxford comma", () => {
      expect(
        codeEvaluatorDisabledReason({
          hasName: false,
          hasCode: false,
          hasInput: false,
          isEditing: false,
        }),
      ).toBe(
        "Add a name, some code, and at least one input to create the evaluator.",
      );
    });
  });
});
