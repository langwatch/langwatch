import { describe, expect, it } from "vitest";
import { TEMPLATE_VARIABLES } from "~/shared/templating/exampleContext";
import { detectUnknownVariables, positionInsideLiquid } from "../liquidMonaco";

const VARS = TEMPLATE_VARIABLES;

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

describe("positionInsideLiquid", () => {
  describe("when the cursor is before any Liquid expression", () => {
    it("returns false", () => {
      const text = '{"a": "{{ x }}"}';
      expect(positionInsideLiquid(text, 3)).toBe(false);
    });
  });

  describe("when the cursor is inside a {{ ... }} expression", () => {
    it("returns true", () => {
      const text = '{"a": "{{ x }}"}';
      const inside = text.indexOf("x");
      expect(positionInsideLiquid(text, inside)).toBe(true);
    });
  });

  describe("when the cursor is inside a {% ... %} tag", () => {
    it("returns true", () => {
      const text = '{"a": 1 {% if y %} ,"b": 2{% endif %}}';
      const inside = text.indexOf("if y");
      expect(positionInsideLiquid(text, inside + 1)).toBe(true);
    });
  });

  describe("when the cursor is after a closed Liquid span", () => {
    it("returns false", () => {
      const text = '{"a": "{{ x }}"}';
      const after = text.indexOf("}}") + 2;
      expect(positionInsideLiquid(text, after + 1)).toBe(false);
    });
  });

  describe("when the cursor sits inside an unterminated Liquid output", () => {
    it("returns true so the Liquid completion provider keeps the surface", () => {
      const text = '{"a": "Hello {{ user.n';
      expect(positionInsideLiquid(text, text.length)).toBe(true);
    });
  });
});
