import { describe, expect, it } from "vitest";
import { tryParseJson } from "../structuredOutput";

describe("tryParseJson", () => {
  describe("given a JSON object", () => {
    it.each([
      ['{"score": 10}', { score: 10 }],
      [
        '{"complete_name": "Sergio", "score": 10}',
        { complete_name: "Sergio", score: 10 },
      ],
      ['{"data": {"inner": "value"}}', { data: { inner: "value" } }],
      ['{"passed": true}', { passed: true }],
      ['{"value": null}', { value: null }],
      ['  {"score": 10}  ', { score: 10 }],
    ])("parses %s", (input, expected) => {
      expect(tryParseJson(input)).toEqual(expected);
    });
  });

  describe("given anything else", () => {
    it.each([
      [undefined, "undefined input"],
      ["", "empty string"],
      ["Hello World", "plain text"],
      ['{"score": }', "malformed JSON"],
      ["[1, 2, 3]", "array"],
      ["42", "number primitive"],
      ["not json {}", "non-JSON prefix"],
    ])("returns undefined for %s", (input, _description) => {
      expect(tryParseJson(input)).toBeUndefined();
    });
  });
});
