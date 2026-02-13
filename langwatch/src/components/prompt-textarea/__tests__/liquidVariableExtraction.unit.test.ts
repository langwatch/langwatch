import { describe, expect, it } from "vitest";
import {
  extractLiquidVariables,
  type LiquidVariableExtractionResult,
} from "../liquidTokenizer";

describe("extractLiquidVariables()", () => {
  describe("when text contains variables inside Liquid tags", () => {
    it("finds variables in both tag conditions and variable expressions", () => {
      const result = extractLiquidVariables(
        "{% if tone %}{{ name }}{% endif %}"
      );

      expect(result.inputVariables).toContain("tone");
      expect(result.inputVariables).toContain("name");
    });
  });

  describe("when text contains for loops", () => {
    it("extracts the collection as an input variable", () => {
      const result = extractLiquidVariables(
        "{% for item in items %}{{ item }}{% endfor %}"
      );

      expect(result.inputVariables).toContain("items");
    });

    it("identifies loop iterators as loop variables, not input variables", () => {
      const result = extractLiquidVariables(
        "{% for item in items %}{{ item }}{% endfor %}"
      );

      expect(result.loopVariables).toContain("item");
      expect(result.inputVariables).not.toContain("item");
    });

    it("does not extract Liquid keywords as variables", () => {
      const result = extractLiquidVariables(
        "{% for item in items %}{{ item }}{% endfor %}"
      );

      expect(result.inputVariables).not.toContain("for");
      expect(result.inputVariables).not.toContain("in");
      expect(result.inputVariables).not.toContain("endfor");
      expect(result.loopVariables).not.toContain("for");
      expect(result.loopVariables).not.toContain("in");
      expect(result.loopVariables).not.toContain("endfor");
    });
  });

  describe("when text contains filters", () => {
    it("extracts only the variable name, not filter names", () => {
      const result = extractLiquidVariables(
        "{{ name | upcase | truncate: 20 }}"
      );

      expect(result.inputVariables).toContain("name");
      expect(result.inputVariables).not.toContain("upcase");
      expect(result.inputVariables).not.toContain("truncate");
    });
  });

  describe("when text contains assign tags", () => {
    it("extracts non-assigned variables as input variables", () => {
      const result = extractLiquidVariables(
        "{% assign greeting = 'Hello' %}{{ greeting }}, {{ name }}"
      );

      expect(result.inputVariables).toContain("name");
    });

    it("recognizes assigned names as locally assigned, not input variables", () => {
      const result = extractLiquidVariables(
        "{% assign greeting = 'Hello' %}{{ greeting }}, {{ name }}"
      );

      expect(result.assignedVariables).toContain("greeting");
      expect(result.inputVariables).not.toContain("greeting");
    });
  });

  describe("when text contains for loops with range literals", () => {
    it("does not treat range literals like (1..5) as variables", () => {
      const result = extractLiquidVariables(
        "{% for i in (1..5) %}{{ i }}{% endfor %}"
      );

      expect(result.loopVariables).toContain("i");
      expect(result.inputVariables).not.toContain("(1");
      expect(result.inputVariables).not.toContain("1");
      expect(result.inputVariables).not.toContain("(1..5)");
      expect(result.inputVariables).toHaveLength(0);
    });
  });

  describe("when text contains nested Liquid structures", () => {
    it("extracts the collection as input variable and loop iterator as loop variable", () => {
      const result = extractLiquidVariables(
        "{% for item in items %}{% if item.active %}{{ item.name }}{% endif %}{% endfor %}"
      );

      expect(result.inputVariables).toContain("items");
      expect(result.loopVariables).toContain("item");
      expect(result.inputVariables).not.toContain("item");
    });
  });

  describe("when text contains simple mustache variables only", () => {
    it("extracts them as input variables (backward compatible)", () => {
      const result = extractLiquidVariables(
        "Hello {{ question }}, context: {{ context }}"
      );

      expect(result.inputVariables).toContain("question");
      expect(result.inputVariables).toContain("context");
    });
  });

  describe("when text contains if/elsif/else conditions", () => {
    it("extracts condition variables as input variables", () => {
      const result = extractLiquidVariables(
        "{% if x %}A{% elsif y %}B{% else %}C{% endif %}"
      );

      expect(result.inputVariables).toContain("x");
      expect(result.inputVariables).toContain("y");
    });

    it("does not extract if/elsif/else/endif as variables", () => {
      const result = extractLiquidVariables(
        "{% if x %}A{% elsif y %}B{% else %}C{% endif %}"
      );

      expect(result.inputVariables).not.toContain("if");
      expect(result.inputVariables).not.toContain("elsif");
      expect(result.inputVariables).not.toContain("else");
      expect(result.inputVariables).not.toContain("endif");
    });
  });
});
