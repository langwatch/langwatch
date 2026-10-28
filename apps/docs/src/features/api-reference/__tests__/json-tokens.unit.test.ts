import { describe, expect, it } from "vitest";

import { JSON_TOKEN_COLOURS, jsonTokens } from "../model/json-tokens.ts";

const kinds = (text: string) =>
  jsonTokens({ text })
    .filter(({ kind }) => kind !== "plain")
    .map(({ text: run, kind }) => [run, kind]);

describe("the request body's colours", () => {
  describe("when the body is valid JSON", () => {
    /** @scenario "Colour the request body like the docs' code blocks" */
    it("colours keys, strings, numbers and literals, and keeps every character", () => {
      const body = '{\n  "name": "string",\n  "limit": -1.5e3,\n  "on": true, "x": null\n}';
      expect(kinds(body)).toEqual([
        ["{", "punctuation"],
        ['"name"', "key"],
        [":", "punctuation"],
        ['"string"', "string"],
        [",", "punctuation"],
        ['"limit"', "key"],
        [":", "punctuation"],
        ["-1.5e3", "number"],
        [",", "punctuation"],
        ['"on"', "key"],
        [":", "punctuation"],
        ["true", "literal"],
        [",", "punctuation"],
        ['"x"', "key"],
        [":", "punctuation"],
        ["null", "literal"],
        ["}", "punctuation"],
      ]);
      expect(
        jsonTokens({ text: body })
          .map(({ text }) => text)
          .join(""),
      ).toBe(body);
    });

    /** @scenario "Colour the request body like the docs' code blocks" */
    it("uses the code blocks' light and dark colours", () => {
      expect(JSON_TOKEN_COLOURS.key).toEqual({ light: "#005CC5", dark: "#79B8FF" });
      expect(JSON_TOKEN_COLOURS.string).toEqual({ light: "#032F62", dark: "#9ECBFF" });
    });
  });

  describe("when the reader is midway through typing", () => {
    /** @scenario "Colour the request body like the docs' code blocks" */
    it("shows an unclosed string and stray text without losing any of it", () => {
      const body = '{ "na\\"me": "unfinished\n  oops';
      expect(kinds(body)).toEqual([
        ["{", "punctuation"],
        ['"na\\"me"', "key"],
        [":", "punctuation"],
        ['"unfinished', "string"],
      ]);
      expect(
        jsonTokens({ text: body })
          .map(({ text }) => text)
          .join(""),
      ).toBe(body);
    });
  });
});
