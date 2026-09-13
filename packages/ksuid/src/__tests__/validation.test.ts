import { describe, it, expect } from "vitest";
import {
  checkPrefix,
  checkUint,
  checkUint8Array,
  checkClass,
  checkString,
  checkNonEmptyString,
  ValidationError,
} from "../validation.ts";
import { Instance } from "../instance.ts";

describe("Validation", () => {
  describe("checkPrefix", () => {
    it("should accept valid prefixes", () => {
      const validPrefixes = ["prod", "dev", "staging", "test", "env1", "env2"];

      validPrefixes.forEach((prefix) => {
        expect(() => checkPrefix("test", prefix)).not.toThrow();
      });
    });

    it("should throw for invalid prefixes", () => {
      const invalidPrefixes = ["invalid!", "test-env", "ENV", "env@test", "env test"];

      invalidPrefixes.forEach((prefix) => {
        expect(() => checkPrefix("test", prefix)).toThrow(ValidationError);
      });
    });

    it("should throw for non-string values", () => {
      expect(() => checkPrefix("test", 123 as never)).toThrow(ValidationError);
      expect(() => checkPrefix("test", null as never)).toThrow(ValidationError);
      expect(() => checkPrefix("test", undefined as never)).toThrow(ValidationError);
    });
  });

  describe("checkUint", () => {
    it("should accept valid unsigned integers", () => {
      expect(() => checkUint("test", 0, 1)).not.toThrow();
      expect(() => checkUint("test", 255, 1)).not.toThrow();
      expect(() => checkUint("test", 65535, 2)).not.toThrow();
    });

    it("should throw for negative values", () => {
      expect(() => checkUint("test", -1, 1)).toThrow(ValidationError);
      expect(() => checkUint("test", -100, 2)).toThrow(ValidationError);
    });

    it("should throw for non-integers", () => {
      expect(() => checkUint("test", 1.5, 1)).toThrow(ValidationError);
      expect(() => checkUint("test", "123" as unknown, 1)).toThrow(ValidationError);
    });

    it("should throw for values too large", () => {
      expect(() => checkUint("test", 256, 1)).toThrow(ValidationError);
      expect(() => checkUint("test", 65536, 2)).toThrow(ValidationError);
    });
  });

  describe("checkUint8Array", () => {
    it("should accept valid Uint8Arrays", () => {
      expect(() => checkUint8Array("test", new Uint8Array(8), 8)).not.toThrow();
      expect(() => checkUint8Array("test", new Uint8Array(16), 16)).not.toThrow();
    });

    it("should throw for wrong length", () => {
      expect(() => checkUint8Array("test", new Uint8Array(4), 8)).toThrow(ValidationError);
      expect(() => checkUint8Array("test", new Uint8Array(16), 8)).toThrow(ValidationError);
    });

    it("should throw for non-Uint8Array values", () => {
      expect(() => checkUint8Array("test", [1, 2, 3] as unknown, 3)).toThrow(ValidationError);
      expect(() => checkUint8Array("test", "test" as unknown, 4)).toThrow(ValidationError);
    });
  });

  describe("checkClass", () => {
    it("should accept valid class instances", () => {
      const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(8));
      expect(() => checkClass("test", instance, Instance)).not.toThrow();
    });

    it("should throw for wrong class instances", () => {
      const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(8));
      expect(() => checkClass("test", instance, Array)).toThrow(ValidationError);
    });

    it("should throw for non-objects", () => {
      expect(() => checkClass("test", "string" as unknown, String)).toThrow(ValidationError);
      expect(() => checkClass("test", 123 as unknown, Number)).toThrow(ValidationError);
    });
  });

  describe("checkString", () => {
    it("should accept valid strings", () => {
      expect(() => checkString("test", "valid string")).not.toThrow();
      expect(() => checkString("test", "")).not.toThrow();
    });

    it("should throw for non-strings", () => {
      expect(() => checkString("test", 123 as never)).toThrow(ValidationError);
      expect(() => checkString("test", null as never)).toThrow(ValidationError);
      expect(() => checkString("test", undefined as never)).toThrow(ValidationError);
    });
  });

  describe("checkNonEmptyString", () => {
    it("should accept non-empty strings", () => {
      expect(() => checkNonEmptyString("test", "valid string")).not.toThrow();
      expect(() => checkNonEmptyString("test", "a")).not.toThrow();
    });

    it("should throw for empty strings", () => {
      expect(() => checkNonEmptyString("test", "")).toThrow(ValidationError);
    });

    it("should throw for non-strings", () => {
      expect(() => checkNonEmptyString("test", 123 as never)).toThrow(ValidationError);
    });
  });

  describe("ValidationError", () => {
    it("should have correct name and message", () => {
      const error = new ValidationError("test error");
      expect(error.name).toBe("ValidationError");
      expect(error.message).toBe("test error");
    });

    it("should be instance of Error", () => {
      const error = new ValidationError("test error");
      expect(error).toBeInstanceOf(Error);
    });
  });
});
