import { describe, expect, it } from "vitest";
import {
  tokenizeLiquidTemplate,
  type LiquidToken,
} from "../liquidTokenizer";

describe("tokenizeLiquidTemplate()", () => {
  describe("when text contains if/endif tags", () => {
    it("identifies if and endif as liquid-tag tokens with plain-text between", () => {
      const tokens = tokenizeLiquidTemplate(
        "{% if tone == 'formal' %}Dear user{% endif %}"
      );

      expect(tokens).toEqual([
        { type: "liquid-tag", value: "{% if tone == 'formal' %}" },
        { type: "plain-text", value: "Dear user" },
        { type: "liquid-tag", value: "{% endif %}" },
      ]);
    });
  });

  describe("when text contains for/endfor tags and variable expressions", () => {
    it("identifies for/endfor as liquid-tag and variable expressions as variable", () => {
      const tokens = tokenizeLiquidTemplate(
        "{% for item in items %}{{ item }}{% endfor %}"
      );

      expect(tokens).toEqual([
        { type: "liquid-tag", value: "{% for item in items %}" },
        { type: "variable", value: "{{ item }}" },
        { type: "liquid-tag", value: "{% endfor %}" },
      ]);
    });
  });

  describe("when text contains assign tags", () => {
    it("identifies assign as liquid-tag", () => {
      const tokens = tokenizeLiquidTemplate(
        "{% assign greeting = 'Hello' %}{{ greeting }}"
      );

      expect(tokens).toEqual([
        { type: "liquid-tag", value: "{% assign greeting = 'Hello' %}" },
        { type: "variable", value: "{{ greeting }}" },
      ]);
    });
  });

  describe("when text contains filters in variable expressions", () => {
    it("identifies the entire expression including filters as a variable token", () => {
      const tokens = tokenizeLiquidTemplate("{{ name | upcase }}");

      expect(tokens).toEqual([
        { type: "variable", value: "{{ name | upcase }}" },
      ]);
    });
  });

  describe("when text contains elsif and else tags", () => {
    it("identifies elsif and else as liquid-tag tokens", () => {
      const tokens = tokenizeLiquidTemplate(
        "{% if x %}A{% elsif y %}B{% else %}C{% endif %}"
      );

      expect(tokens).toEqual([
        { type: "liquid-tag", value: "{% if x %}" },
        { type: "plain-text", value: "A" },
        { type: "liquid-tag", value: "{% elsif y %}" },
        { type: "plain-text", value: "B" },
        { type: "liquid-tag", value: "{% else %}" },
        { type: "plain-text", value: "C" },
        { type: "liquid-tag", value: "{% endif %}" },
      ]);
    });
  });

  describe("when text contains mixed content", () => {
    it("tokenizes plain text, liquid tags, and variables correctly", () => {
      const tokens = tokenizeLiquidTemplate(
        "Hello {% if formal %}Sir{% endif %}, {{ name | capitalize }}"
      );

      expect(tokens).toEqual([
        { type: "plain-text", value: "Hello " },
        { type: "liquid-tag", value: "{% if formal %}" },
        { type: "plain-text", value: "Sir" },
        { type: "liquid-tag", value: "{% endif %}" },
        { type: "plain-text", value: ", " },
        { type: "variable", value: "{{ name | capitalize }}" },
      ]);
    });
  });

  describe("when text contains unclosed tags", () => {
    it("treats unclosed tags as plain text", () => {
      const tokens = tokenizeLiquidTemplate("{% if x");

      expect(tokens).toEqual([
        { type: "plain-text", value: "{% if x" },
      ]);
    });
  });

  describe("when text is empty", () => {
    it("returns an empty array", () => {
      const tokens = tokenizeLiquidTemplate("");
      expect(tokens).toEqual([]);
    });
  });

  describe("when text has no liquid syntax", () => {
    it("returns a single plain-text token", () => {
      const tokens = tokenizeLiquidTemplate("Hello world");
      expect(tokens).toEqual([
        { type: "plain-text", value: "Hello world" },
      ]);
    });
  });

  describe("when text has unclosed variable expression", () => {
    it("treats unclosed variable expression as plain text", () => {
      const tokens = tokenizeLiquidTemplate("{{ name");
      expect(tokens).toEqual([
        { type: "plain-text", value: "{{ name" },
      ]);
    });
  });
});
