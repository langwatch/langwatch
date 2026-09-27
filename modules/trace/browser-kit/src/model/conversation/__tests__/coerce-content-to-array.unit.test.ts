import { describe, expect, it } from "vitest";

import { coerceContentToArray } from "../coerce-content-to-array.ts";

describe("coerceContentToArray", () => {
  it("walks an array as given, and refuses anything that is not a list", () => {
    expect(coerceContentToArray([1, 2])).toEqual([1, 2]);
    expect(coerceContentToArray({ type: "text" })).toBeNull();
    expect(coerceContentToArray("plain text")).toBeNull();
    expect(coerceContentToArray("  [unparseable")).toBeNull();
  });

  it("parses a JSON list before trying a Python repr", () => {
    expect(coerceContentToArray(' [{"type": "text", "text": "None"}] ')).toEqual([
      { type: "text", text: "None" },
    ]);
  });

  it("reads Python literals only at token boundaries", () => {
    expect(coerceContentToArray("[None, True, False, 'NoneType', 'xTrue']")).toEqual([
      null,
      true,
      false,
      "NoneType",
      "xTrue",
    ]);
    expect(coerceContentToArray("[Nonex]")).toBeNull();
  });

  it("translates escapes inside single-quoted Python strings", () => {
    expect(
      coerceContentToArray(String.raw`['it\'s', 'say "hi"', 'q\"', 'caf\xe9', 'a\nb']`),
    ).toEqual(["it's", 'say "hi"', 'q"', "café", "a\nb"]);
    expect(coerceContentToArray(String.raw`['bad\xZZ']`)).toBeNull();
  });

  it("keeps apostrophes and escapes inside double-quoted Python strings", () => {
    expect(coerceContentToArray(String.raw`["it's", "caf\xe9", "tab\there", "end\""]`)).toEqual([
      "it's",
      "café",
      "tab\there",
      'end"',
    ]);
  });

  it("walks a Python repr of content parts", () => {
    expect(
      coerceContentToArray("[{'type': 'text', 'text': 'hello', 'cached': False, 'meta': None}]"),
    ).toEqual([{ type: "text", text: "hello", cached: false, meta: null }]);
  });
});
