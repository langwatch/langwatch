import { describe, expect, it } from "vitest";
import { validateLiquid } from "../validate";

describe("validateLiquid", () => {
  describe("when the template is well-formed", () => {
    it("passes", () => {
      const result = validateLiquid(
        "Hi {{ project.name }}{% for m in matches %}{{ m.trace.url }}{% endfor %}",
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("when the template has unbalanced tags", () => {
    it("fails with an error message", () => {
      const result = validateLiquid("{% for m in matches %}{{ m }}");
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("when the template has malformed output syntax", () => {
    it("fails", () => {
      expect(validateLiquid("{{ unclosed").valid).toBe(false);
    });
  });
});
