/**
 * The export renderers, where an export goes quietly wrong: a JSON column
 * written as a string, an unescaped quote, a carriage return splitting a row.
 * @see specs/analytics/lwql-cli-query.feature
 */
import { describe, expect, it } from "vitest";

import { csvCell, renderCsv, renderJsonl } from "../rows";

const TEXT_COLUMN = { name: "TraceId", type: "String" };
const JSON_COLUMN = { name: "messages", type: "Nullable(JSON)" };

describe("renderJsonl", () => {
  describe("when a column is plain text", () => {
    /** @scenario "The jsonl format prints one object per row" */
    it("writes one JSON object per line", () => {
      const out = renderJsonl({
        columns: [TEXT_COLUMN],
        rows: [{ TraceId: "a" }, { TraceId: "b" }],
      });
      expect(out.split("\n")).toEqual(['{"TraceId":"a"}', '{"TraceId":"b"}']);
    });
  });

  describe("when a column is declared as JSON", () => {
    /** @scenario "A JSON-typed column arrives as a value, not as a string" */
    it("parses its value back into a real array", () => {
      const out = renderJsonl({
        columns: [JSON_COLUMN],
        rows: [{ messages: '[{"role":"user"}]' }],
      });
      expect(JSON.parse(out)).toEqual({ messages: [{ role: "user" }] });
    });

    it("writes a value that does not parse through unchanged", () => {
      const out = renderJsonl({
        columns: [JSON_COLUMN],
        rows: [{ messages: "not json" }],
      });
      expect(JSON.parse(out)).toEqual({ messages: "not json" });
    });
  });

  describe("when a text column's value merely looks like JSON", () => {
    /**
     * A model's own output of `[1, 2]` is text. Parsing it because it parses
     * would change what the export says the model produced.
     */
    it("leaves it as the string it is", () => {
      const out = renderJsonl({
        columns: [{ name: "CapturedOutput", type: "Nullable(String)" }],
        rows: [{ CapturedOutput: "[1, 2]" }],
      });
      expect(JSON.parse(out)).toEqual({ CapturedOutput: "[1, 2]" });
    });
  });
});

describe("csvCell", () => {
  describe("when the value is ordinary", () => {
    it("writes it bare", () => {
      expect(csvCell("gpt-5-mini")).toBe("gpt-5-mini");
    });
  });

  describe("when the value carries a separator or a quote", () => {
    /** @scenario "The csv format writes a header row and escapes the values" */
    it.each([
      ["a,b", '"a,b"'],
      ['say "hi"', '"say ""hi"""'],
      ["line\nbreak", '"line\nbreak"'],
      ["line\rbreak", '"line\rbreak"'],
    ])("quotes and escapes %j", (input, expected) => {
      expect(csvCell(input)).toBe(expected);
    });
  });

  describe("when the value is absent", () => {
    it("writes an empty cell rather than the word null", () => {
      expect(csvCell(null)).toBe("");
      expect(csvCell(undefined)).toBe("");
    });
  });
});

describe("renderCsv", () => {
  /** @scenario "The csv format writes a header row and escapes the values" */
  it("writes the column names as the first line", () => {
    const out = renderCsv({
      columns: [TEXT_COLUMN, { name: "TotalCost", type: "Nullable(Float64)" }],
      rows: [{ TraceId: "a", TotalCost: 0.5 }],
    });
    expect(out.split("\n")).toEqual(["TraceId,TotalCost", "a,0.5"]);
  });
});
