import { describe, it, expect } from "vitest";
import {
  validateTagName,
  PromptTagValidationError,
  PROTECTED_TAGS,
} from "../prompt-tag.repository";

describe("validateTagName()", () => {
  describe("when name is a valid custom tag", () => {
    it("does not throw for 'canary'", () => {
      expect(() => validateTagName("canary")).not.toThrow();
    });

    it("does not throw for 'ab-test'", () => {
      expect(() => validateTagName("ab-test")).not.toThrow();
    });

    it("does not throw for 'my_tag'", () => {
      expect(() => validateTagName("my_tag")).not.toThrow();
    });

    it("does not throw for 'v2'", () => {
      expect(() => validateTagName("v2")).not.toThrow();
    });

    it("does not throw for 'a1b2c3'", () => {
      expect(() => validateTagName("a1b2c3")).not.toThrow();
    });

    it("does not throw for 'production'", () => {
      expect(() => validateTagName("production")).not.toThrow();
    });

    it("does not throw for 'staging'", () => {
      expect(() => validateTagName("staging")).not.toThrow();
    });
  });

  describe("when name is empty", () => {
    it("throws PromptTagValidationError", () => {
      expect(() => validateTagName("")).toThrow(PromptTagValidationError);
    });
  });

  describe("when name is purely numeric", () => {
    it("throws with message mentioning numeric", () => {
      expect(() => validateTagName("42")).toThrow(
        expect.objectContaining({
          name: "PromptTagValidationError",
          message: expect.stringMatching(/numeric/i),
        }),
      );
    });

    it("throws for '0'", () => {
      expect(() => validateTagName("0")).toThrow(PromptTagValidationError);
    });
  });

  describe("when name contains invalid characters", () => {
    it("throws for names with spaces", () => {
      expect(() => validateTagName("my tag")).toThrow(
        PromptTagValidationError,
      );
    });

    it("throws for names with slashes", () => {
      expect(() => validateTagName("can/ary")).toThrow(
        PromptTagValidationError,
      );
    });

    it("throws for uppercase names", () => {
      expect(() => validateTagName("CANARY")).toThrow(
        PromptTagValidationError,
      );
    });

    it("throws for names starting with a digit", () => {
      expect(() => validateTagName("1abc")).toThrow(
        PromptTagValidationError,
      );
    });

    it("throws for names with special chars", () => {
      expect(() => validateTagName("foo@bar")).toThrow(
        PromptTagValidationError,
      );
    });
  });

  describe("when name is a protected tag", () => {
    for (const protected_ of PROTECTED_TAGS) {
      it(`throws for '${protected_}' with message mentioning protected`, () => {
        expect(() => validateTagName(protected_)).toThrow(
          expect.objectContaining({
            name: "PromptTagValidationError",
            message: expect.stringMatching(/protected/i),
          }),
        );
      });
    }

    it("does not throw for 'production' (seeded tag, not protected)", () => {
      expect(() => validateTagName("production")).not.toThrow();
    });

    it("does not throw for 'staging' (seeded tag, not protected)", () => {
      expect(() => validateTagName("staging")).not.toThrow();
    });
  });
});
