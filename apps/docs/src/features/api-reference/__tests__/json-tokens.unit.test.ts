import { describe, expect, it } from "vitest";

import { jsonTokens } from "../model/json-tokens.ts";

const kinds = (text: string) =>
  jsonTokens({ text })
    .filter(({ kind }) => kind !== "plain")
    .map(({ text: run, kind }) => [run, kind]);

describe("the request body's colours", () => {
  describe("when the body is valid JSON", () => {
    /** @scenario "Colour the request body like the docs' code blocks" */
    it("colours keys, strings and other values, and keeps every character", () => {
      const body = '{\n  "name": "string",\n  "limit": -1.5e3,\n  "on": true, "x": null\n}';
      expect(kinds(body)).toEqual([
        ['"name"', "key"],
        ['"string"', "string"],
        ['"limit"', "key"],
        ["-1.5e3", "value"],
        ['"on"', "key"],
        ["true", "value"],
        ['"x"', "key"],
        ["null", "value"],
      ]);
      expect(
        jsonTokens({ text: body })
          .map(({ text }) => text)
          .join(""),
      ).toBe(body);
    });
  });

  describe("when the reader is midway through typing", () => {
    /** @scenario "Colour the request body like the docs' code blocks" */
    it("shows an unclosed string and stray text without losing any of it", () => {
      const body = '{ "na\\"me": "unfinished\n  oops';
      expect(kinds(body)).toEqual([
        ['"na\\"me"', "key"],
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
