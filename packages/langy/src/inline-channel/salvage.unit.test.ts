import { describe, expect, it } from "vitest";

import { salvageJsonText, salvageLangyDerivedCard } from "./salvage";

describe("salvageJsonText", () => {
  describe("given an undamaged document", () => {
    it("parses it verbatim", () => {
      expect(salvageJsonText('{"a": 1, "b": [true, null]}')).toEqual({
        ok: true,
        value: { a: 1, b: [true, null] },
      });
    });

    it("tolerates surrounding whitespace", () => {
      expect(salvageJsonText('  \n {"a": 1} \n ')).toEqual({
        ok: true,
        value: { a: 1 },
      });
    });
  });

  describe("given mechanically damaged documents", () => {
    // The repair table: [name, damaged input, expected repaired value].
    const repairs: Array<[string, string, unknown]> = [
      ["unclosed object", '{"a": 1', { a: 1 }],
      ["unclosed array", '{"a": [1, 2', { a: [1, 2] }],
      ["deeply unclosed nesting", '{"a": {"b": [{"c": 1', { a: { b: [{ c: 1 }] } }],
      ["truncated mid-string value", '{"a": "hel', { a: "hel" }],
      ["truncated mid-string with escape dangling", '{"a": "hel\\', { a: "hel" }],
      ["truncated mid-unicode-escape", '{"a": "x\\u00', { a: "x" }],
      ["truncated mid-array element", '{"a": [1, 2, tr', { a: [1, 2] }],
      ["truncated mid-literal value", '{"a": fal', {}],
      ["truncated mid-number", '{"a": 12.', { a: 12 }],
      ["truncated exponent", '{"a": 1e', { a: 1 }],
      ["bare minus at end", '{"a": -', {}],
      ["dangling key", '{"a": 1, "b', { a: 1 }],
      ["key with colon but no value", '{"a": 1, "b": ', { a: 1 }],
      ["trailing comma in object", '{"a": 1,}', { a: 1 }],
      ["trailing comma in array", "[1, 2,]", [1, 2]],
      ["trailing comma then truncation", '{"a": [1, 2,', { a: [1, 2] }],
      ["unterminated top-level string", '"abc', "abc"],
      [
        "raw newline inside a string",
        '{"a": "line one\nline two"}',
        { a: "line one\nline two" },
      ],
      ["unknown escape kept literally", '{"a": "x\\qy"}', { a: "xqy" }],
    ];

    it.each(repairs)("repairs %s", (_name, input, expected) => {
      expect(salvageJsonText(input)).toEqual({ ok: true, value: expected });
    });
  });

  describe("given content that is not damaged JSON at all", () => {
    const garbage: Array<[string, string]> = [
      ["prose", "here is your chart"],
      ["unquoted object key", "{a: 1}"],
      ["unquoted word value mid-document", '{"a": yes}'],
      ["garbage element mid-array", "[1, xr, 3]"],
      ["trailing junk after the document", '{"a": 1} and then some'],
      ["two documents in one fence", '{"a": 1}{"b": 2}'],
      ["empty input", ""],
      ["whitespace only", "   \n  "],
      ["malformed unicode escape mid-document", '{"a": "x\\u00zq", "b": 1}'],
    ];

    it.each(garbage)("refuses %s as unsalvageable", (_name, input) => {
      expect(salvageJsonText(input)).toEqual({ ok: false });
    });
  });
});

describe("salvageLangyDerivedCard", () => {
  const statsBlock = (extra = ""): string =>
    `{"kind": "stats", "blockId": "b1", "items": [{"label": "p95", "value": 812, "unit": "ms"}]${extra}`;

  describe("given a well-formed block", () => {
    it("salvages and validates it", () => {
      const result = salvageLangyDerivedCard(`${statsBlock()}}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.card.kind).toBe("stats");
        expect(result.card.blockId).toBe("b1");
      }
    });
  });

  describe("when the block was cut off with unclosed brackets", () => {
    it("repairs it into a document that validates and still draws", () => {
      // The whole closing tail is missing — salvage closes it.
      const result = salvageLangyDerivedCard(statsBlock());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.card.kind).toBe("stats");
    });
  });

  describe("when the salvaged JSON fails its kind's schema", () => {
    it("reports invalid, never a guessed card", () => {
      // Parses fine; `items` is missing, so stats does not validate.
      const result = salvageLangyDerivedCard(
        '{"kind": "stats", "blockId": "b1"}',
      );
      expect(result).toEqual({ ok: false, reason: "invalid" });
    });

    it("reports invalid for a block without a blockId", () => {
      const result = salvageLangyDerivedCard(
        '{"kind": "stats", "items": [{"label": "a", "value": 1}]}',
      );
      expect(result).toEqual({ ok: false, reason: "invalid" });
    });
  });

  describe("when the block claims a kind outside the derived-safe allowlist", () => {
    it.each([["traces"], ["evalRun"], ["resourceCreated"], ["metrics"]])(
      "refuses a %s block as invalid",
      (kind) => {
        const result = salvageLangyDerivedCard(
          `{"kind": "${kind}", "blockId": "b1", "items": []}`,
        );
        expect(result).toEqual({ ok: false, reason: "invalid" });
      },
    );
  });

  describe("when the content cannot be salvaged at all", () => {
    it("reports unsalvageable", () => {
      expect(salvageLangyDerivedCard("not json, sorry")).toEqual({
        ok: false,
        reason: "unsalvageable",
      });
    });
  });
});
