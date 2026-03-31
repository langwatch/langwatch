import { describe, it, expect } from "vitest";
import {
  validateLabelName,
  PromptLabelValidationError,
  BUILT_IN_LABELS,
} from "../prompt-label.repository";

describe("validateLabelName()", () => {
  describe("when name is a valid custom label", () => {
    it("does not throw for 'canary'", () => {
      expect(() => validateLabelName("canary")).not.toThrow();
    });

    it("does not throw for 'ab-test'", () => {
      expect(() => validateLabelName("ab-test")).not.toThrow();
    });

    it("does not throw for 'my_label'", () => {
      expect(() => validateLabelName("my_label")).not.toThrow();
    });

    it("does not throw for 'v2'", () => {
      expect(() => validateLabelName("v2")).not.toThrow();
    });

    it("does not throw for 'a1b2c3'", () => {
      expect(() => validateLabelName("a1b2c3")).not.toThrow();
    });
  });

  describe("when name is empty", () => {
    it("throws PromptLabelValidationError", () => {
      expect(() => validateLabelName("")).toThrow(PromptLabelValidationError);
    });
  });

  describe("when name is purely numeric", () => {
    it("throws with message mentioning numeric", () => {
      expect(() => validateLabelName("42")).toThrow(
        expect.objectContaining({
          name: "PromptLabelValidationError",
          message: expect.stringMatching(/numeric/i),
        }),
      );
    });

    it("throws for '0'", () => {
      expect(() => validateLabelName("0")).toThrow(PromptLabelValidationError);
    });
  });

  describe("when name contains invalid characters", () => {
    it("throws for names with spaces", () => {
      expect(() => validateLabelName("my label")).toThrow(
        PromptLabelValidationError,
      );
    });

    it("throws for names with slashes", () => {
      expect(() => validateLabelName("can/ary")).toThrow(
        PromptLabelValidationError,
      );
    });

    it("throws for uppercase names", () => {
      expect(() => validateLabelName("CANARY")).toThrow(
        PromptLabelValidationError,
      );
    });

    it("throws for names starting with a digit", () => {
      expect(() => validateLabelName("1abc")).toThrow(
        PromptLabelValidationError,
      );
    });

    it("throws for names with special chars", () => {
      expect(() => validateLabelName("foo@bar")).toThrow(
        PromptLabelValidationError,
      );
    });
  });

  describe("when name is a built-in label", () => {
    for (const builtin of BUILT_IN_LABELS) {
      it(`throws for '${builtin}' with message mentioning built-in`, () => {
        expect(() => validateLabelName(builtin)).toThrow(
          expect.objectContaining({
            name: "PromptLabelValidationError",
            message: expect.stringMatching(/built-in/i),
          }),
        );
      });
    }
  });
});
