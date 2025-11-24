import { describe, it, expect } from "vitest";
import { extractErrorMessages } from "../FormErrorDisplay";

describe("extractErrorMessages", () => {
  describe("when input is not an object or is null/undefined", () => {
    it("returns empty array for null", () => {
      expect(extractErrorMessages(null)).toEqual([]);
    });

    it("returns empty array for undefined", () => {
      expect(extractErrorMessages(undefined)).toEqual([]);
    });

    it("returns empty array for string", () => {
      expect(extractErrorMessages("error")).toEqual([]);
    });

    it("returns empty array for number", () => {
      expect(extractErrorMessages(42)).toEqual([]);
    });
  });

  describe("when input has a valid message property", () => {
    it("extracts message from simple error object", () => {
      const error = { message: "Validation failed" };
      expect(extractErrorMessages(error)).toEqual(["Validation failed"]);
    });

    it("ignores non-string message values", () => {
      const error = { message: 123 };
      expect(extractErrorMessages(error)).toEqual([]);
    });

    it("ignores null message values", () => {
      const error = { message: null };
      expect(extractErrorMessages(error)).toEqual([]);
    });
  });

  describe("when input is an array", () => {
    it("processes multiple error objects in array", () => {
      const errors = [
        { message: "First error" },
        { message: "Second error" }
      ];
      expect(extractErrorMessages(errors)).toEqual(["First error", "Second error"]);
    });

    it("handles mixed array with valid and invalid items", () => {
      const errors = [
        { message: "Valid error" },
        "invalid string",
        { message: null },
        { message: "Another valid error" }
      ];
      expect(extractErrorMessages(errors)).toEqual(["Valid error", "Another valid error"]);
    });

    it("handles empty array", () => {
      expect(extractErrorMessages([])).toEqual([]);
    });
  });

  describe("when input is a plain object without message", () => {
    it("processes nested error objects", () => {
      const error = {
        field1: { message: "Field 1 error" },
        field2: { message: "Field 2 error" }
      };
      expect(extractErrorMessages(error)).toEqual(["Field 1 error", "Field 2 error"]);
    });

    it("ignores non-error nested values", () => {
      const error = {
        field1: { message: "Valid error" },
        field2: "invalid string",
        field3: { message: null }
      };
      expect(extractErrorMessages(error)).toEqual(["Valid error"]);
    });

    it("handles deeply nested structures", () => {
      const error = {
        level1: {
          level2: {
            field: { message: "Deep error" }
          }
        }
      };
      expect(extractErrorMessages(error)).toEqual(["Deep error"]);
    });
  });

  describe("complex error structures", () => {
    it("handles react-hook-form style errors", () => {
      const error = {
        temperature: {
          message: "Must be between 0 and 2",
          type: "custom"
        },
        maxTokens: {
          message: "Cannot exceed 32,768",
          type: "max"
        }
      };
      expect(extractErrorMessages(error)).toEqual([
        "Must be between 0 and 2",
        "Cannot exceed 32,768"
      ]);
    });

    it("handles mixed error types", () => {
      const error = {
        validField: { message: "Valid message" },
        invalidField: { type: "required" }, // no message
        arrayField: [
          { message: "Array error 1" },
          { message: "Array error 2" }
        ]
      };
      expect(extractErrorMessages(error)).toEqual([
        "Valid message",
        "Array error 1",
        "Array error 2"
      ]);
    });
  });
});
