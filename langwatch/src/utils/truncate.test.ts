import { describe, expect, it } from "vitest";
import { safeTruncate } from "./truncate";

describe("safeTruncate", () => {
  it("should not modify small objects", () => {
    const input = {
      name: "test",
      value: 123,
      nested: { foo: "bar" },
    };
    expect(safeTruncate(input)).toEqual(input);
  });

  it("should not modify strings", () => {
    const input = "test";
    expect(safeTruncate(input)).toEqual(input);
  });

  it("should truncate long strings", () => {
    const longString = "a".repeat(40 * 1024); // 40KB string
    const result = safeTruncate({ text: longString }, 16 * 1024); // Truncate to 16kb

    expect(result.text.length).toBeLessThan(17 * 1024); // 16KB + "..."
    expect(result.text.endsWith("...")).toBe(true);
  });

  it("should handle nested objects with long strings", () => {
    const input = {
      level1: {
        level2: {
          text: "a".repeat(40 * 1024),
        },
      },
    };

    const result = safeTruncate(input, 16 * 1024);
    expect(result.level1.level2.text.length).toBeLessThan(17 * 1024);
    expect(result.level1.level2.text.endsWith("...")).toBe(true);
  });

  it("should handle arrays", () => {
    const input = {
      items: ["a".repeat(20 * 1024), "b".repeat(20 * 1024)],
    };

    const result = safeTruncate(input) as any;
    expect(result.items[0].length).toBeLessThan(17 * 1024);
    expect(result.items[1].length).toBeLessThan(17 * 1024);
    expect(result.items[0].endsWith("...")).toBe(true);
    expect(result.items[1].endsWith("...")).toBe(true);
  });

  it("should progressively reduce string sizes for large objects", () => {
    const input = {
      text1: "a".repeat(20 * 1024),
      text2: "b".repeat(20 * 1024),
      text3: "c".repeat(20 * 1024),
    };

    const result = safeTruncate(input) as any;
    const totalSize = JSON.stringify(result).length;
    expect(totalSize).toBeLessThanOrEqual(32 * 1024);
  });

  it("should drop keys and add truncation marker when necessary", () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      input[`key${i}`] = "a".repeat(1024);
    }

    const result = safeTruncate(input) as Record<string, unknown>;

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(32 * 1024);
    expect(result["..."]).toBe("[truncated]");
    expect(Object.keys(result).length).toBeLessThan(
      Object.keys(input).length + 1,
    );
  });

  it("should handle null and undefined", () => {
    expect(safeTruncate(null)).toBe(null);
    expect(safeTruncate(undefined)).toBe(undefined);
  });

  it("should handle primitive types", () => {
    expect(safeTruncate(123)).toBe(123);
    expect(safeTruncate(true)).toBe(true);
    expect(safeTruncate("short string")).toBe("short string");
  });

  it("should handle circular references errors by just returning the original object and reporting the error", () => {
    const circular: any = { foo: "bar" };
    circular.self = circular;

    const result = safeTruncate(circular) as Record<string, unknown>;
    expect(result).toEqual(circular);
  });

  it("measures a key-sensitive toJSON in its real property-key context, not standalone", () => {
    // JSON.stringify(value) alone always calls value.toJSON("") — a toJSON
    // that returns something small for key "" but large for its real key
    // would be under-measured if the drop-keys pass serialized it standalone,
    // letting an oversized entry slip past maxTotalLength. An own-property
    // toJSON (rather than a prototype method) survives truncateRecursive's
    // plain-object rebuild, so this is reachable with real input shapes.
    function makeKeySensitive(): Record<string, unknown> {
      return {
        toJSON: (key: string) => (key === "" ? "x" : "y".repeat(2 * 1024)),
      };
    }

    const input = { evil: makeKeySensitive(), other: "small" };
    const result = safeTruncate(input, 512) as Record<string, unknown>;

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
    expect(result.evil).toBeUndefined();
  });
});
