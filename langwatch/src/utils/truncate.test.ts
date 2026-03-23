import { describe, expect, it } from "vitest";
import { safeTruncate, truncateLeafStrings } from "./truncate";

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
});

describe("truncateLeafStrings", () => {
  const encoder = new TextEncoder();
  const byteLen = (s: string) => encoder.encode(s).length;

  describe("when values are within the limit", () => {
    it("leaves small strings untouched", () => {
      expect(truncateLeafStrings("hello")).toBe("hello");
    });

    it("leaves small objects untouched", () => {
      const input = { name: "test", value: 123, nested: { foo: "bar" } };
      expect(truncateLeafStrings(input)).toEqual(input);
    });

    it("passes through null, undefined, numbers, booleans", () => {
      expect(truncateLeafStrings(null)).toBe(null);
      expect(truncateLeafStrings(undefined)).toBe(undefined);
      expect(truncateLeafStrings(42)).toBe(42);
      expect(truncateLeafStrings(true)).toBe(true);
    });
  });

  describe("when a leaf string exceeds the byte limit", () => {
    it("clips a top-level string at 32,766 bytes", () => {
      const big = "a".repeat(33_000);
      const result = truncateLeafStrings(big) as string;

      expect(result.endsWith("...[truncated]")).toBe(true);
      // Top-level string has no key path overhead
      expect(byteLen(result)).toBeLessThanOrEqual(32_766);
    });

    it("respects a custom term limit", () => {
      const big = "a".repeat(500);
      const result = truncateLeafStrings(big, 200) as string;

      expect(result.endsWith("...[truncated]")).toBe(true);
      expect(byteLen(result)).toBeLessThanOrEqual(200);
    });
  });

  describe("when objects have mixed large and small values", () => {
    it("preserves ALL keys — never drops any", () => {
      const input: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        input[`key${i}`] = "x".repeat(33_000);
      }

      const result = truncateLeafStrings(input) as Record<string, unknown>;

      // Every key must survive
      expect(Object.keys(result)).toEqual(Object.keys(input));
      // No "..." truncation key
      expect(result["..."]).toBeUndefined();
    });

    it("only clips oversized values, leaves small ones intact", () => {
      const input = {
        small: "hello",
        big: "b".repeat(33_000),
        num: 42,
      };

      const result = truncateLeafStrings(input) as typeof input;

      expect(result.small).toBe("hello");
      expect(result.num).toBe(42);
      expect((result.big as string).endsWith("...[truncated]")).toBe(true);
    });
  });

  describe("when handling nested structures", () => {
    it("truncates deeply nested strings", () => {
      const input = {
        level1: {
          level2: {
            level3: { text: "a".repeat(33_000) },
          },
        },
      };

      const result = truncateLeafStrings(input) as typeof input;

      expect(
        result.level1.level2.level3.text.endsWith("...[truncated]"),
      ).toBe(true);
      // key path "level1.level2.level3.text" = 24 bytes + 1 \0 = 25 overhead
      // so value budget = 32766 - 25 = 32741
      const keyPath = "level1.level2.level3.text";
      const overhead = byteLen(keyPath) + 1;
      expect(byteLen(result.level1.level2.level3.text)).toBeLessThanOrEqual(
        32_766 - overhead,
      );
    });

    it("truncates strings inside arrays", () => {
      const input = ["a".repeat(33_000), "short", "b".repeat(33_000)];

      const result = truncateLeafStrings(input) as string[];

      expect(result[0]!.endsWith("...[truncated]")).toBe(true);
      expect(result[1]).toBe("short");
      expect(result[2]!.endsWith("...[truncated]")).toBe(true);
    });
  });

  describe("when handling multi-byte UTF-8 characters", () => {
    it("does not split multi-byte characters", () => {
      // Each emoji is 4 bytes in UTF-8
      const emojis = "🚀".repeat(9000); // 36,000 bytes
      const result = truncateLeafStrings(emojis) as string;

      expect(result.endsWith("...[truncated]")).toBe(true);
      // Should be valid UTF-8 — no replacement characters
      expect(result).not.toContain("\uFFFD");
      expect(byteLen(result)).toBeLessThanOrEqual(32_766);
    });

    it("handles Japanese characters correctly", () => {
      // Each Japanese char is 3 bytes in UTF-8
      const japanese = "日本語テスト".repeat(2000); // ~36,000 bytes
      const result = truncateLeafStrings(japanese) as string;

      expect(result.endsWith("...[truncated]")).toBe(true);
      expect(result).not.toContain("\uFFFD");
      expect(byteLen(result)).toBeLessThanOrEqual(32_766);
    });
  });

  describe("when preserving the beginning of the string", () => {
    it("keeps the start of the string, only clips the end", () => {
      const prefix = "IMPORTANT_START_";
      const big = prefix + "x".repeat(33_000);
      const result = truncateLeafStrings(big) as string;

      expect(result.startsWith(prefix)).toBe(true);
      expect(result.endsWith("...[truncated]")).toBe(true);
    });
  });

  describe("when accounting for ES keyed encoding overhead", () => {
    it("stays under 32,766 bytes even with a long key path", () => {
      // ES flattened fields store terms as: key_path + \0 + value
      // With a deeply nested key, the combined term must be <= 32,766
      const input = {
        integrations: {
          salesforce: {
            pipeline: {
              stage_1: {
                output: {
                  reasoning_chain: {
                    step_3: {
                      intermediate_result: "x".repeat(31_000),
                    },
                  },
                },
              },
            },
          },
        },
      };

      const result = truncateLeafStrings(input) as any;
      const value =
        result.integrations.salesforce.pipeline.stage_1.output
          .reasoning_chain.step_3.intermediate_result as string;

      // The key path is:
      // "integrations.salesforce.pipeline.stage_1.output.reasoning_chain.step_3.intermediate_result"
      // which is 89 bytes + 1 byte for \0 separator = 90 bytes overhead
      const keyPath =
        "integrations.salesforce.pipeline.stage_1.output.reasoning_chain.step_3.intermediate_result";
      const keyPathBytes = new TextEncoder().encode(keyPath).length;
      const valueBytes = new TextEncoder().encode(value).length;
      const combinedBytes = keyPathBytes + 1 + valueBytes; // +1 for \0

      expect(combinedBytes).toBeLessThanOrEqual(32_766);
    });
  });

  describe("when the string is exactly at the boundary", () => {
    it("does not truncate a top-level string exactly at 32,766 bytes", () => {
      const exact = "a".repeat(32_766);
      expect(truncateLeafStrings(exact)).toBe(exact);
    });

    it("truncates a top-level string one byte over the limit", () => {
      const overByOne = "a".repeat(32_767);
      const result = truncateLeafStrings(overByOne) as string;
      expect(result.endsWith("...[truncated]")).toBe(true);
      expect(byteLen(result)).toBeLessThanOrEqual(32_766);
    });
  });

  describe("when the marker itself is included in the byte budget", () => {
    it("the truncated value including ...[truncated] marker fits the limit", () => {
      const big = "a".repeat(33_000);
      const result = truncateLeafStrings(big) as string;

      // The result includes the marker and must still be <= 32,766 bytes
      expect(result.endsWith("...[truncated]")).toBe(true);
      expect(byteLen(result)).toBeLessThanOrEqual(32_766);

      // Same for a nested value — key path + \0 + value (with marker) <= 32,766
      const nested = { deep: { key: big } };
      const nestedResult = truncateLeafStrings(nested) as any;
      const value = nestedResult.deep.key as string;
      const keyPath = "deep.key";

      expect(value.endsWith("...[truncated]")).toBe(true);
      expect(byteLen(keyPath) + 1 + byteLen(value)).toBeLessThanOrEqual(
        32_766,
      );
    });
  });

  describe("when key path depth reduces the value budget", () => {
    it("gives less budget to deeply nested values", () => {
      const bigValue = "x".repeat(33_000);
      const shallow = { a: bigValue };
      const deep = { a: { b: { c: { d: { e: bigValue } } } } };

      const shallowResult = truncateLeafStrings(shallow) as any;
      const deepResult = truncateLeafStrings(deep) as any;

      const shallowValueLen = byteLen(shallowResult.a);
      const deepValueLen = byteLen(deepResult.a.b.c.d.e);

      // Deep value should be shorter because key path "a.b.c.d.e" eats more budget
      expect(deepValueLen).toBeLessThan(shallowValueLen);

      // Both combined terms must fit within the ES limit
      expect(byteLen("a") + 1 + shallowValueLen).toBeLessThanOrEqual(32_766);
      expect(byteLen("a.b.c.d.e") + 1 + deepValueLen).toBeLessThanOrEqual(
        32_766,
      );
    });
  });
});
