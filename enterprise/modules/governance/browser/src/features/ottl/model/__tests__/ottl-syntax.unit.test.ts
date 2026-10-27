import { describe, expect, it } from "vitest";

import { ottlSegments } from "../ottl-syntax.ts";

function kinds(text: string) {
  return ottlSegments({ text, error: null })
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment) => [segment.text, segment.kind]);
}

describe("ottlSegments", () => {
  it("colours functions, paths, strings, numbers, operators, keywords and literals", () => {
    expect(kinds('set(resource.attributes["k"], 1.5) where span.name != nil and not true')).toEqual(
      [
        ["set", "function"],
        ["(", "punctuation"],
        ["resource", "path"],
        [".", "punctuation"],
        ["attributes", "path"],
        ["[", "punctuation"],
        ['"k"', "string"],
        ["]", "punctuation"],
        [",", "punctuation"],
        ["1.5", "number"],
        [")", "punctuation"],
        ["where", "keyword"],
        ["span", "path"],
        [".", "punctuation"],
        ["name", "path"],
        ["!=", "operator"],
        ["nil", "literal"],
        ["and", "keyword"],
        ["not", "keyword"],
        ["true", "literal"],
      ],
    );
  });

  it("marks only the unexpected token, and the last character for an early end", () => {
    const error = {
      statementIndex: 0,
      line: 1,
      col: 15,
      message: 'unexpected token "[" (expected ")")',
    };
    const text = "set(attributes[ x";
    expect(
      ottlSegments({ text, error })
        .filter((s) => s.isError)
        .map((s) => s.text),
    ).toEqual(["["]);

    const eof = { ...error, col: 20, message: 'unexpected token "<EOF>" (expected ")")' };
    expect(
      ottlSegments({ text: 'set(attributes["a"]', error: eof })
        .filter((s) => s.isError)
        .map((s) => s.text),
    ).toEqual(["]"]);
  });

  it("keeps every character, so the highlight lines up with the textarea", () => {
    const text = 'set(attributes["a\\"b"], 1)\n  where x == 2 ~';
    expect(
      ottlSegments({ text, error: null })
        .map((s) => s.text)
        .join(""),
    ).toBe(text);
  });
});
