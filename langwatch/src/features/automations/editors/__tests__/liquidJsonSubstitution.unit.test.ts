import { describe, expect, it } from "vitest";
import { substituteLiquidForJsonValidation } from "../liquidJsonSubstitution";

describe("substituteLiquidForJsonValidation", () => {
  describe("given Liquid output inside a string", () => {
    it("fills the span with underscores, preserving length and newlines", () => {
      const source = '{"text": "Hello {{ user.name }}!"}';
      const { substituted } = substituteLiquidForJsonValidation(source);
      expect(substituted).toBe('{"text": "Hello _______________!"}');
      expect(substituted.length).toBe(source.length);
      expect(JSON.parse(substituted)).toEqual({
        text: "Hello _______________!",
      });
    });
  });

  describe("given Liquid output at a JSON value position", () => {
    it("wraps the placeholder in quotes so the slot parses as a string", () => {
      const source = '{"text": {{ user.name }} }';
      const { substituted } = substituteLiquidForJsonValidation(source);
      expect(substituted).toBe('{"text": "_____________" }');
      expect(JSON.parse(substituted)).toEqual({ text: "_____________" });
    });
  });

  describe("given a Liquid tag", () => {
    it("fills the span with spaces, which JSON ignores", () => {
      const source = '{"a": 1 {% if x %} ,"b": 2 {% endif %} }';
      const { substituted } = substituteLiquidForJsonValidation(source);
      expect(substituted.length).toBe(source.length);
      // Both tag spans collapse to whitespace — the surrounding JSON is still
      // structurally valid here (no comma stranding).
      expect(JSON.parse(substituted)).toEqual({ a: 1, b: 2 });
    });
  });

  describe("given a Liquid expression spanning multiple lines", () => {
    it("preserves newline positions inside the fill", () => {
      const source = '{"text": "x{{ a |\n  filter }}y"}';
      const { substituted } = substituteLiquidForJsonValidation(source);
      expect(substituted.length).toBe(source.length);
      expect(substituted.split("\n").length).toBe(source.split("\n").length);
      // Newlines stay in place; everything else inside the span becomes `_`.
      expect(substituted).toBe('{"text": "x______\n___________y"}');
    });
  });

  describe("given an unterminated Liquid expression", () => {
    it("does not throw and returns same-length output up to the failure", () => {
      const source = '{"text": "Hello {{ unclosed"}';
      const { substituted } = substituteLiquidForJsonValidation(source);
      expect(substituted.length).toBe(source.length);
    });
  });

  describe("given multiple expressions in one source", () => {
    it("records each replaced range with its kind", () => {
      const source = '{"a": "{{ x }}", "b": "{% if y %}z{% endif %}"}';
      const { liquidRanges } = substituteLiquidForJsonValidation(source);
      expect(liquidRanges.map((r) => r.kind)).toEqual([
        "output",
        "tag",
        "tag",
      ]);
      expect(liquidRanges).toHaveLength(3);
    });
  });

  describe("given a string with an escaped quote before Liquid", () => {
    it("does not mistake the escaped quote for a string boundary", () => {
      const source = '{"text": "a\\" {{ x }}"}';
      const { substituted } = substituteLiquidForJsonValidation(source);
      // The Liquid expression is inside the string, so underscore-fill applies.
      expect(substituted).toBe('{"text": "a\\" _______"}');
      expect(JSON.parse(substituted)).toEqual({ text: 'a" _______' });
    });
  });
});
