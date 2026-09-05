import { TraceContentArrayService } from "../trace-content-array.service";
import { describe, expect, it } from "vitest";

describe("TraceContentArrayService.tryCoerceContentToArray", () => {
  describe("when content is already an array", () => {
    it("returns the array verbatim", () => {
      const arr = [{ type: "text", text: "hi" }];
      expect(TraceContentArrayService.tryCoerceContentToArray(arr)).toBe(arr);
    });
  });

  describe("when content is a JSON-encoded array string", () => {
    it("parses and returns the array", () => {
      const json = '[{"type":"text","text":"hi"}]';
      expect(TraceContentArrayService.tryCoerceContentToArray(json)).toEqual([
        { type: "text", text: "hi" },
      ]);
    });
  });

  describe("when content is a Python-repr array string", () => {
    it("converts single quotes and parses", () => {
      const repr = "[{'type': 'text', 'text': 'hi'}]";
      expect(TraceContentArrayService.tryCoerceContentToArray(repr)).toEqual([
        { type: "text", text: "hi" },
      ]);
    });

    it("handles None, True, False", () => {
      const repr = "[{'type': 'flag', 'a': None, 'b': True, 'c': False}]";
      expect(TraceContentArrayService.tryCoerceContentToArray(repr)).toEqual([
        { type: "flag", a: null, b: true, c: false },
      ]);
    });

    it("handles input_audio shape from openai-realtime sdk", () => {
      const repr =
        "[{'type': 'input_audio', 'input_audio': {'data': 'UklGRg==', 'format': 'wav'}}]";
      expect(TraceContentArrayService.tryCoerceContentToArray(repr)).toEqual([
        {
          type: "input_audio",
          input_audio: { data: "UklGRg==", format: "wav" },
        },
      ]);
    });
  });

  describe("when content is a non-array string", () => {
    it("returns null for plain text", () => {
      expect(TraceContentArrayService.tryCoerceContentToArray("hello world")).toBeNull();
    });

    it("returns null for an empty string", () => {
      expect(TraceContentArrayService.tryCoerceContentToArray("")).toBeNull();
    });

    it("returns null for a JSON object string (not array)", () => {
      expect(TraceContentArrayService.tryCoerceContentToArray('{"a":1}')).toBeNull();
    });
  });

  describe("when content is not a string or array", () => {
    it("returns null for objects", () => {
      expect(TraceContentArrayService.tryCoerceContentToArray({ a: 1 })).toBeNull();
    });

    it("returns null for null", () => {
      expect(TraceContentArrayService.tryCoerceContentToArray(null)).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(TraceContentArrayService.tryCoerceContentToArray(undefined)).toBeNull();
    });

    it("returns null for numbers", () => {
      expect(TraceContentArrayService.tryCoerceContentToArray(42)).toBeNull();
    });
  });

  describe("when content is malformed", () => {
    it("returns null for an array-shaped string that fails both parses", () => {
      expect(TraceContentArrayService.tryCoerceContentToArray("[not parseable at all")).toBeNull();
    });
  });

  describe("when Python repr contains apostrophes inside string literals", () => {
    // Real bug from prod (scenariorun_3Dzjm2lT7Rcc4oj9r390XO8bdoL). Python's
    // repr switches the outer string delimiter to double quotes whenever a
    // text contains an apostrophe — but the rest of the structure still
    // uses single quotes for dict keys and string values. A naive
    // single-to-double sweep flips `i'm` into `i"m` and breaks JSON.parse.
    it("preserves apostrophes when text part is wrapped in double quotes", () => {
      const repr =
        "[{'type': 'text', 'text': \"[shouting] you charged me [angry] i'm at a noisy cafe\"}]";
      expect(TraceContentArrayService.tryCoerceContentToArray(repr)).toEqual([
        {
          type: "text",
          text: "[shouting] you charged me [angry] i'm at a noisy cafe",
        },
      ]);
    });

    it("handles mixed parts: text with apostrophe + input_audio with base64", () => {
      const repr =
        "[{'type': 'text', 'text': \"i'm at a cafe\"}, {'type': 'input_audio', 'input_audio': {'data': 'UklGRg==', 'format': 'wav'}}]";
      expect(TraceContentArrayService.tryCoerceContentToArray(repr)).toEqual([
        { type: "text", text: "i'm at a cafe" },
        {
          type: "input_audio",
          input_audio: { data: "UklGRg==", format: "wav" },
        },
      ]);
    });

    it("handles double quotes nested inside python single-quoted strings", () => {
      // Python repr will escape: 'he said "hi"' stays single-quoted with
      // escaped doubles. JSON needs the inner quotes escaped under double
      // quotes as well.
      const repr = "[{'type': 'text', 'text': 'he said \"hi\" loudly'}]";
      expect(TraceContentArrayService.tryCoerceContentToArray(repr)).toEqual([
        { type: "text", text: 'he said "hi" loudly' },
      ]);
    });

    it("translates Python \\xHH byte escapes to JSON \\u00HH", () => {
      // Python repr produces \xHH for non-printable bytes; JSON only
      // accepts \uHHHH (4 hex digits). Without translation, JSON.parse
      // rejects the otherwise-valid recovery output.
      const repr = "[{'type': 'text', 'text': 'pre\\x00mid\\x1fpost'}]";
      expect(TraceContentArrayService.tryCoerceContentToArray(repr)).toEqual([
        { type: "text", text: "pre\u0000midpost" },
      ]);
    });

    it("translates \\xHH inside a python double-quoted string", () => {
      const repr = "[{'type': 'text', 'text': \"i'm\\x07ok\"}]";
      expect(TraceContentArrayService.tryCoerceContentToArray(repr)).toEqual([
        { type: "text", text: "i'mok" },
      ]);
    });
  });
});
