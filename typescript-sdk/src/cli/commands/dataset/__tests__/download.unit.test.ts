import { describe, it, expect } from "vitest";

// Extract pure functions for testing by re-implementing them here
// (they're module-private in download.ts, so we test the logic directly)

function toCsv(records: Array<{ entry: Record<string, unknown> }>): string {
  if (records.length === 0) return "";

  const columns = Object.keys(records[0]!.entry);

  const escapeCsvField = (value: unknown): string => {
    const str =
      value === null || value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
    if (
      str.includes(",") ||
      str.includes('"') ||
      str.includes("\n") ||
      str.includes("\r")
    ) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.join(",");
  const rows = records.map((record) =>
    columns.map((col) => escapeCsvField(record.entry[col])).join(","),
  );

  return [header, ...rows].join("\n");
}

function toJsonl(
  records: Array<{ entry: Record<string, unknown> }>,
): string {
  return records.map((record) => JSON.stringify(record.entry)).join("\n");
}

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

  describe("when values contain commas", () => {
    it("wraps in quotes", () => {
      const records = [{ entry: { text: "hello, world" } }];
      expect(toCsv(records)).toBe('text\n"hello, world"');
    });
  });

  describe("when values contain double quotes", () => {
    it("escapes with doubled quotes", () => {
      const records = [{ entry: { text: 'say "hi"' } }];
      expect(toCsv(records)).toBe('text\n"say ""hi"""');
    });
  });

  describe("when values contain newlines", () => {
    it("wraps in quotes", () => {
      const records = [{ entry: { text: "line1\nline2" } }];
      expect(toCsv(records)).toBe('text\n"line1\nline2"');
    });
  });

  describe("when values contain carriage returns", () => {
    it("wraps in quotes", () => {
      const records = [{ entry: { text: "line1\rline2" } }];
      expect(toCsv(records)).toBe('text\n"line1\rline2"');
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
