import { describe, it, expect } from "vitest";
import {
  parseJsonStringValues,
  sanitizeInvalidJsonEscapes,
} from "../traceRequest.utils";

describe("parseJsonStringValues", () => {
  describe("when given JSON object strings", () => {
    it("parses valid JSON objects", () => {
      const result = parseJsonStringValues({
        data: '{"key": "value"}',
      });
      expect(result.data).toEqual({ key: "value" });
    });
  });

  describe("when given JSON array strings", () => {
    it("parses valid JSON arrays", () => {
      const result = parseJsonStringValues({
        items: '[1, 2, 3]',
      });
      expect(result.items).toEqual([1, 2, 3]);
    });
  });

  describe("when given non-JSON strings", () => {
    it("passes plain strings through unchanged", () => {
      const result = parseJsonStringValues({
        text: "hello world",
      });
      expect(result.text).toBe("hello world");
    });

    it("passes strings that do not start with { or [", () => {
      const result = parseJsonStringValues({
        num: "42",
        bool: "true",
      });
      expect(result.num).toBe("42");
      expect(result.bool).toBe("true");
    });
  });

  describe("when given malformed JSON", () => {
    it("returns the original string", () => {
      const result = parseJsonStringValues({
        broken: '{"key": value}',
      });
      expect(result.broken).toBe('{"key": value}');
    });
  });

  describe("when given non-string values", () => {
    it("passes objects through unchanged", () => {
      const obj = { nested: true };
      const result = parseJsonStringValues({ data: obj });
      expect(result.data).toBe(obj);
    });

    it("passes numbers through unchanged", () => {
      const result = parseJsonStringValues({ count: 42 });
      expect(result.count).toBe(42);
    });
  });

  describe("when given oversized strings", () => {
    it("skips parsing strings exceeding the size limit", () => {
      const huge = "{" + "a".repeat(2_000_001) + "}";
      const result = parseJsonStringValues({ big: huge });
      expect(result.big).toBe(huge);
    });
  });

  describe("when given very short strings", () => {
    it("skips strings shorter than 2 characters", () => {
      const result = parseJsonStringValues({ tiny: "{" });
      expect(result.tiny).toBe("{");
    });
  });

  describe("when JSON has PII-redaction broken escapes", () => {
    it("parses JSON with \\< invalid escape from PII redaction", () => {
      const brokenJson =
        '[{"role":"user","content":"SSN: \\<US_DRIVER_LICENSE>"}]';
      const result = parseJsonStringValues({ messages: brokenJson });
      expect(result.messages).toEqual([
        { role: "user", content: "SSN: <US_DRIVER_LICENSE>" },
      ]);
    });

    it("parses JSON with multiple PII tokens", () => {
      const brokenJson =
        '{"input":"Name: \\<PERSON>, SSN: \\<US_SSN>"}';
      const result = parseJsonStringValues({ data: brokenJson });
      expect(result.data).toEqual({
        input: "Name: <PERSON>, SSN: <US_SSN>",
      });
    });

    it("preserves valid JSON escapes while fixing invalid ones", () => {
      const brokenJson =
        '{"content":"line1\\nline2 \\<US_DRIVER_LICENSE> end"}';
      const result = parseJsonStringValues({ data: brokenJson });
      expect(result.data).toEqual({
        content: "line1\nline2 <US_DRIVER_LICENSE> end",
      });
    });
  });
});

describe("sanitizeInvalidJsonEscapes()", () => {
  describe("when given strings with PII-redaction escapes", () => {
    it("removes backslash before <", () => {
      expect(sanitizeInvalidJsonEscapes('\\<US_DRIVER_LICENSE>')).toBe(
        "<US_DRIVER_LICENSE>",
      );
    });

    it("removes backslash before >", () => {
      expect(sanitizeInvalidJsonEscapes('\\>tag')).toBe(">tag");
    });

    it("handles multiple PII tokens", () => {
      expect(
        sanitizeInvalidJsonEscapes('\\<PERSON> and \\<US_SSN>'),
      ).toBe("<PERSON> and <US_SSN>");
    });
  });

  describe("when given strings with valid JSON escapes", () => {
    it("preserves \\n", () => {
      expect(sanitizeInvalidJsonEscapes('\\n')).toBe("\\n");
    });

    it("preserves \\\\ (escaped backslash)", () => {
      expect(sanitizeInvalidJsonEscapes('\\\\')).toBe("\\\\");
    });

    it('preserves \\"', () => {
      expect(sanitizeInvalidJsonEscapes('\\"')).toBe('\\"');
    });

    it("preserves \\uXXXX unicode escapes", () => {
      expect(sanitizeInvalidJsonEscapes('\\u003C')).toBe("\\u003C");
    });
  });

  describe("when given mixed valid and invalid escapes", () => {
    it("fixes only PII angle-bracket escapes", () => {
      const input = '"line1\\nSSN: \\<US_SSN>\\ttab"';
      expect(sanitizeInvalidJsonEscapes(input)).toBe(
        '"line1\\nSSN: <US_SSN>\\ttab"',
      );
    });
  });

  describe("when given a string with no escapes", () => {
    it("returns the string unchanged", () => {
      expect(sanitizeInvalidJsonEscapes("plain text")).toBe("plain text");
    });
  });
});
