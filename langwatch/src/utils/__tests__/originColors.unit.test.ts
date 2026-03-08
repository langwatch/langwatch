import { describe, expect, it } from "vitest";
import { getOriginColor, getOriginLabel, originColors } from "../originColors";

describe("originColors", () => {
  describe("getOriginColor", () => {
    it("returns blue for application origin", () => {
      const result = getOriginColor("application");
      expect(result).toEqual({
        background: "blue.subtle",
        color: "blue.emphasized",
      });
    });

    it("returns green for evaluation origin", () => {
      const result = getOriginColor("evaluation");
      expect(result).toEqual({
        background: "green.subtle",
        color: "green.emphasized",
      });
    });

    it("returns pink for simulation origin", () => {
      const result = getOriginColor("simulation");
      expect(result).toEqual({
        background: "pink.subtle",
        color: "pink.emphasized",
      });
    });

    it("returns purple for playground origin", () => {
      const result = getOriginColor("playground");
      expect(result).toEqual({
        background: "purple.subtle",
        color: "purple.emphasized",
      });
    });

    it("returns teal for workflow origin", () => {
      const result = getOriginColor("workflow");
      expect(result).toEqual({
        background: "teal.subtle",
        color: "teal.emphasized",
      });
    });

    it("returns hash-based color for unknown origin", () => {
      const result = getOriginColor("custom-origin");
      expect(result).toHaveProperty("background");
      expect(result).toHaveProperty("color");
      // Should be a valid color pair from the rotating palette
      expect(result.background).toMatch(/\.\w+$/);
      expect(result.color).toMatch(/\.\w+$/);
    });

    it("returns consistent color for same unknown origin", () => {
      const result1 = getOriginColor("my-custom");
      const result2 = getOriginColor("my-custom");
      expect(result1).toEqual(result2);
    });
  });

  describe("getOriginLabel", () => {
    it("capitalizes first letter of origin", () => {
      expect(getOriginLabel("application")).toBe("Application");
      expect(getOriginLabel("evaluation")).toBe("Evaluation");
      expect(getOriginLabel("simulation")).toBe("Simulation");
      expect(getOriginLabel("playground")).toBe("Playground");
      expect(getOriginLabel("workflow")).toBe("Workflow");
    });

    it("handles single character origin", () => {
      expect(getOriginLabel("a")).toBe("A");
    });

    it("returns empty string for empty input", () => {
      expect(getOriginLabel("")).toBe("");
    });

    it("capitalizes custom origin values", () => {
      expect(getOriginLabel("my-custom-origin")).toBe("My-custom-origin");
    });
  });
});
