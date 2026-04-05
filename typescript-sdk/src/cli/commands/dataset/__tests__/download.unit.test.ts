import { describe, it, expect } from "vitest";
import { toCsv, toJsonl, escapeCsvField } from "../download";

describe("escapeCsvField", () => {
  it("returns plain string as-is", () => {
    expect(escapeCsvField("hello")).toBe("hello");
  });

  it("wraps value with commas in quotes", () => {
    expect(escapeCsvField("hello, world")).toBe('"hello, world"');
  });

  it("escapes double quotes by doubling them", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps value with newlines in quotes", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps value with carriage returns in quotes", () => {
    expect(escapeCsvField("line1\rline2")).toBe('"line1\rline2"');
  });

  it("returns empty string for null", () => {
    expect(escapeCsvField(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("JSON-stringifies non-string types", () => {
    expect(escapeCsvField(42)).toBe("42");
    expect(escapeCsvField([1, 2])).toBe('"[1,2]"');
  });
});

describe("toCsv", () => {
  describe("when records are empty", () => {
    it("returns empty string", () => {
      expect(toCsv([])).toBe("");
    });
  });

  describe("when records have simple string values", () => {
    it("produces header and data rows", () => {
      const records = [
        { entry: { input: "hello", output: "world" } },
        { entry: { input: "foo", output: "bar" } },
      ];
      expect(toCsv(records)).toBe(
        "input,output\nhello,world\nfoo,bar",
      );
    });
  });

  describe("when records have different keys", () => {
    it("includes union of all keys as columns", () => {
      const records = [
        { entry: { input: "hello" } },
        { entry: { input: "foo", extra: "bar" } },
      ];
      const result = toCsv(records);
      const lines = result.split("\n");
      expect(lines[0]).toBe("input,extra");
      expect(lines[1]).toBe("hello,");
      expect(lines[2]).toBe("foo,bar");
    });
  });

  describe("when header names need escaping", () => {
    it("escapes header fields with commas", () => {
      const records = [{ entry: { "col,a": "value" } }];
      const result = toCsv(records);
      expect(result.split("\n")[0]).toBe('"col,a"');
    });
  });

  describe("when values are null or undefined", () => {
    it("outputs empty string", () => {
      const records = [{ entry: { a: null, b: undefined } }];
      expect(toCsv(records)).toBe("a,b\n,");
    });
  });

  describe("when values are non-string types", () => {
    it("JSON-stringifies them", () => {
      const records = [{ entry: { num: 42, arr: [1, 2] } }];
      expect(toCsv(records)).toBe('num,arr\n42,"[1,2]"');
    });
  });
});

describe("toJsonl", () => {
  describe("when records are empty", () => {
    it("returns empty string", () => {
      expect(toJsonl([])).toBe("");
    });
  });

  describe("when records have entries", () => {
    it("produces one JSON object per line", () => {
      const records = [
        { entry: { input: "hello" } },
        { entry: { input: "world" } },
      ];
      expect(toJsonl(records)).toBe(
        '{"input":"hello"}\n{"input":"world"}',
      );
    });
  });
});
