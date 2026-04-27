import { describe, it, expect } from "vitest";
import { escapeCsvField, toCsv, toJsonl } from "../download";
import type { DatasetRecordResponse } from "@/client-sdk/services/datasets/types";

describe("escapeCsvField()", () => {
  describe("when given a plain string", () => {
    it("returns the string as-is", () => {
      expect(escapeCsvField("hello")).toBe("hello");
    });
  });

  describe("when given a string with a comma", () => {
    it("wraps in double quotes", () => {
      expect(escapeCsvField("hello, world")).toBe('"hello, world"');
    });
  });

  describe("when given a string with double quotes", () => {
    it("wraps in double quotes and escapes inner quotes", () => {
      expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""');
    });
  });

  describe("when given null or undefined", () => {
    it("returns empty string for null", () => {
      expect(escapeCsvField(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(escapeCsvField(undefined)).toBe("");
    });
  });

  describe("when given a non-string value", () => {
    it("converts numbers to string", () => {
      expect(escapeCsvField(42)).toBe("42");
    });

    it("converts objects to JSON", () => {
      expect(escapeCsvField({ a: 1 })).toBe('"{""a"":1}"');
    });
  });
});

describe("toCsv()", () => {
  const makeRecord = (entry: Record<string, unknown>): DatasetRecordResponse => ({
    id: "rec-1",
    datasetId: "ds-1",
    projectId: "proj-1",
    entry,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  });

  describe("when given records", () => {
    it("produces CSV with header and data rows", () => {
      const records = [
        makeRecord({ input: "hello", output: "world" }),
        makeRecord({ input: "foo", output: "bar" }),
      ];

      const result = toCsv(records);
      const lines = result.split("\n");

      expect(lines[0]).toBe("input,output");
      expect(lines[1]).toBe("hello,world");
      expect(lines[2]).toBe("foo,bar");
    });
  });

  describe("when given an empty array", () => {
    it("returns empty string", () => {
      expect(toCsv([])).toBe("");
    });
  });

  describe("when records have different keys", () => {
    it("produces union of all keys as headers", () => {
      const records = [
        makeRecord({ input: "a" }),
        makeRecord({ input: "b", extra: "c" }),
      ];

      const result = toCsv(records);
      const lines = result.split("\n");

      expect(lines[0]).toBe("input,extra");
      // First record has no "extra" key
      expect(lines[1]).toBe("a,");
      expect(lines[2]).toBe("b,c");
    });
  });
});

describe("toJsonl()", () => {
  const makeRecord = (entry: Record<string, unknown>): DatasetRecordResponse => ({
    id: "rec-1",
    datasetId: "ds-1",
    projectId: "proj-1",
    entry,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  });

  describe("when given records", () => {
    it("produces one JSON object per line", () => {
      const records = [
        makeRecord({ input: "hello", output: "world" }),
        makeRecord({ input: "foo", output: "bar" }),
      ];

      const result = toJsonl(records);
      const lines = result.split("\n");

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual({ input: "hello", output: "world" });
      expect(JSON.parse(lines[1]!)).toEqual({ input: "foo", output: "bar" });
    });
  });

  describe("when given an empty array", () => {
    it("returns empty string", () => {
      expect(toJsonl([])).toBe("");
    });
  });
});
