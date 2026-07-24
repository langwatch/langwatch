import { describe, it, expect } from "vitest";
import {
  formatTargetOutput,
  unwrapSingleOutputKey,
} from "../formatTargetOutput";

describe("formatTargetOutput", () => {
  describe("null/undefined handling", () => {
    it("returns empty string for null", () => {
      expect(formatTargetOutput(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(formatTargetOutput(undefined)).toBe("");
    });
  });

  describe("primitive handling", () => {
    it("returns string for string primitives", () => {
      expect(formatTargetOutput("hello world")).toBe("hello world");
    });

    it("returns string for number primitives", () => {
      expect(formatTargetOutput(42)).toBe("42");
    });

    it("returns string for boolean true", () => {
      expect(formatTargetOutput(true)).toBe("true");
    });

    it("returns string for boolean false", () => {
      expect(formatTargetOutput(false)).toBe("false");
    });
  });

  describe("single output key unwrap", () => {
    it("unwraps object with single 'output' key", () => {
      expect(formatTargetOutput({ output: "hello world" })).toBe("hello world");
    });

    it("unwraps to empty string when output value is null", () => {
      expect(formatTargetOutput({ output: null })).toBe("");
    });

    it("unwraps to empty string when output value is undefined", () => {
      expect(formatTargetOutput({ output: undefined })).toBe("");
    });

    it("unwraps and stringifies nested object in output field", () => {
      const nested = { result: "title", reason: "because" };
      expect(formatTargetOutput({ output: nested })).toBe(
        JSON.stringify(nested, null, 2),
      );
    });

    it("unwraps boolean false from output key", () => {
      expect(formatTargetOutput({ output: false })).toBe("false");
    });

    it("unwraps number from output key", () => {
      expect(formatTargetOutput({ output: 123 })).toBe("123");
    });
  });

  describe("non-output key objects", () => {
    it("returns formatted JSON for single non-output key (pizza example)", () => {
      const output = { pizza: false };
      expect(formatTargetOutput(output)).toBe(JSON.stringify(output, null, 2));
    });

    it("returns formatted JSON for single non-output key (result example)", () => {
      const output = { result: "my title" };
      expect(formatTargetOutput(output)).toBe(JSON.stringify(output, null, 2));
    });

    it("returns formatted JSON for multiple keys including output", () => {
      const output = { output: "main", extra: "ignored" };
      expect(formatTargetOutput(output)).toBe(JSON.stringify(output, null, 2));
    });

    it("returns formatted JSON for multiple custom fields", () => {
      const output = { result: "title", reason: "because it fits" };
      expect(formatTargetOutput(output)).toBe(JSON.stringify(output, null, 2));
    });
  });

  describe("array handling", () => {
    it("returns formatted JSON for arrays", () => {
      const arr = [1, 2, 3];
      expect(formatTargetOutput(arr)).toBe(JSON.stringify(arr, null, 2));
    });

    it("returns formatted JSON for array of objects", () => {
      const arr = [{ a: 1 }, { b: 2 }];
      expect(formatTargetOutput(arr)).toBe(JSON.stringify(arr, null, 2));
    });
  });

  describe("empty object", () => {
    it("returns formatted JSON for empty object", () => {
      expect(formatTargetOutput({})).toBe("{}");
    });
  });
});

describe("unwrapSingleOutputKey", () => {
  it("unwraps single output key", () => {
    expect(unwrapSingleOutputKey({ output: "hello" })).toBe("hello");
  });

  it("returns original for non-output single key", () => {
    const obj = { pizza: false };
    expect(unwrapSingleOutputKey(obj)).toEqual(obj);
  });

  it("returns original for multiple keys", () => {
    const obj = { output: "main", extra: "value" };
    expect(unwrapSingleOutputKey(obj)).toEqual(obj);
  });

  it("returns original for primitives", () => {
    expect(unwrapSingleOutputKey("hello")).toBe("hello");
    expect(unwrapSingleOutputKey(42)).toBe(42);
    expect(unwrapSingleOutputKey(false)).toBe(false);
  });

  it("returns null/undefined as-is", () => {
    expect(unwrapSingleOutputKey(null)).toBeNull();
    expect(unwrapSingleOutputKey(undefined)).toBeUndefined();
  });

  it("returns arrays as-is", () => {
    const arr = [1, 2, 3];
    expect(unwrapSingleOutputKey(arr)).toEqual(arr);
  });
});
