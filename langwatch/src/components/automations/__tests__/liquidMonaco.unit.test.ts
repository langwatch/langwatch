import { describe, expect, it } from "vitest";
import { TEMPLATE_VARIABLE_PATHS } from "~/server/event-sourcing/outbox/templating/exampleContext";
import { detectUnknownVariables } from "../liquidMonaco";

const VARS = TEMPLATE_VARIABLE_PATHS;

describe("detectUnknownVariables", () => {
  describe("when a referenced variable root is known", () => {
    it("reports nothing", () => {
      expect(detectUnknownVariables("{{ trigger.name }}", VARS)).toEqual([]);
    });
  });

  describe("when a referenced variable root is a typo", () => {
    it("reports the unknown root and its position", () => {
      const found = detectUnknownVariables("Hello {{ tigger.name }}", VARS);
      expect(found).toHaveLength(1);
      expect(found[0]!.root).toBe("tigger");
      const text = "Hello {{ tigger.name }}";
      expect(text.slice(found[0]!.index, found[0]!.index + found[0]!.token.length)).toBe(
        "tigger.name",
      );
    });
  });

  describe("when the variable is a for-loop local", () => {
    it("treats the loop variable as known", () => {
      const template =
        "{% for m in matches %}{{ m.trace.url }}{% endfor %}";
      expect(detectUnknownVariables(template, VARS)).toEqual([]);
    });
  });

  describe("when an assign declares a local", () => {
    it("treats the assigned name as known", () => {
      const template = "{% assign foo = trigger.name %}{{ foo }}";
      expect(detectUnknownVariables(template, VARS)).toEqual([]);
    });
  });

  describe("when a known variable is piped through a filter", () => {
    it("ignores the filter name", () => {
      expect(detectUnknownVariables("{{ matches | size }}", VARS)).toEqual([]);
    });
  });

  describe("when the expression is a literal", () => {
    it("reports nothing", () => {
      expect(detectUnknownVariables("{{ 'hello' }} {{ 42 }}", VARS)).toEqual([]);
    });
  });
});
