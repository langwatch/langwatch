import { describe, it, expect } from "vitest";

import { Instance } from "../instance.ts";
import {
  checkPrefix,
  checkUint,
  checkUint8Array,
  checkClass,
  checkString,
  checkNonEmptyString,
  ValidationError,
} from "../validation.ts";

describe("Validation", () => {
  describe("checkPrefix()", () => {
    it("accepts valid prefixes", () => {
      const validPrefixes = ["prod", "dev", "staging", "test", "env1", "env2"];

      validPrefixes.forEach((prefix) => {
        expect(() => checkPrefix("test", prefix)).not.toThrow();
      });
    });

    it("throws for invalid prefixes", () => {
      const invalidPrefixes = ["invalid!", "test-env", "ENV", "env@test", "env test"];

      invalidPrefixes.forEach((prefix) => {
        expect(() => checkPrefix("test", prefix)).toThrow(ValidationError);
      });
    });

    it("throws for non-string values", () => {
      expect(() => checkPrefix("test", 123 as never)).toThrow(ValidationError);
      expect(() => checkPrefix("test", null as never)).toThrow(ValidationError);
      expect(() => checkPrefix("test", undefined as never)).toThrow(ValidationError);
    });
  });

  describe("checkUint()", () => {
    it("accepts valid unsigned integers", () => {
      expect(() => checkUint("test", 0, 1)).not.toThrow();
      expect(() => checkUint("test", 255, 1)).not.toThrow();
      expect(() => checkUint("test", 65535, 2)).not.toThrow();
    });

    it("throws for negative values", () => {
      expect(() => checkUint("test", -1, 1)).toThrow(ValidationError);
      expect(() => checkUint("test", -100, 2)).toThrow(ValidationError);
    });

    it("throws for non-integers", () => {
      expect(() => checkUint("test", 1.5, 1)).toThrow(ValidationError);
      expect(() => checkUint("test", "123" as unknown, 1)).toThrow(ValidationError);
    });

    it("throws for values too large", () => {
      expect(() => checkUint("test", 256, 1)).toThrow(ValidationError);
      expect(() => checkUint("test", 65536, 2)).toThrow(ValidationError);
    });
  });

  describe("checkUint8Array()", () => {
    it("accepts valid Uint8Arrays", () => {
      expect(() => checkUint8Array("test", new Uint8Array(8), 8)).not.toThrow();
      expect(() => checkUint8Array("test", new Uint8Array(16), 16)).not.toThrow();
    });

    it("throws for wrong length", () => {
      expect(() => checkUint8Array("test", new Uint8Array(4), 8)).toThrow(ValidationError);
      expect(() => checkUint8Array("test", new Uint8Array(16), 8)).toThrow(ValidationError);
    });

    it("throws for non-Uint8Array values", () => {
      expect(() => checkUint8Array("test", [1, 2, 3] as unknown, 3)).toThrow(ValidationError);
      expect(() => checkUint8Array("test", "test" as unknown, 4)).toThrow(ValidationError);
    });
  });

  describe("checkClass()", () => {
    it("accepts valid class instances", () => {
      const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(8));
      expect(() => checkClass("test", instance, Instance)).not.toThrow();
    });

    it("throws for wrong class instances", () => {
      const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(8));
      expect(() => checkClass("test", instance, Array)).toThrow(ValidationError);
    });

    it("throws for non-objects", () => {
      expect(() => checkClass("test", "string" as unknown, String)).toThrow(ValidationError);
      expect(() => checkClass("test", 123 as unknown, Number)).toThrow(ValidationError);
    });
  });

  describe("checkString()", () => {
    it("accepts valid strings", () => {
      expect(() => checkString("test", "valid string")).not.toThrow();
      expect(() => checkString("test", "")).not.toThrow();
    });

    it("throws for non-strings", () => {
      expect(() => checkString("test", 123 as never)).toThrow(ValidationError);
      expect(() => checkString("test", null as never)).toThrow(ValidationError);
      expect(() => checkString("test", undefined as never)).toThrow(ValidationError);
    });
  });

  describe("checkNonEmptyString()", () => {
    it("accepts non-empty strings", () => {
      expect(() => checkNonEmptyString("test", "valid string")).not.toThrow();
      expect(() => checkNonEmptyString("test", "a")).not.toThrow();
    });

    it("throws for empty strings", () => {
      expect(() => checkNonEmptyString("test", "")).toThrow(ValidationError);
    });

    it("throws for non-strings", () => {
      expect(() => checkNonEmptyString("test", 123 as never)).toThrow(ValidationError);
    });
  });

  describe("ValidationError", () => {
    it("has the correct name and message", () => {
      const error = new ValidationError("test error");
      expect(error.name).toBe("ValidationError");
      expect(error.message).toBe("test error");
    });

    it("is an instance of Error", () => {
      const error = new ValidationError("test error");
      expect(error).toBeInstanceOf(Error);
    });
  });
});
