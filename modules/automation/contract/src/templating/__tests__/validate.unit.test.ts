import { describe, expect, it } from "vitest";

import { validateLiquid } from "../validate.ts";

describe("validateLiquid", () => {
  describe("when the template is well-formed", () => {
    /** @scenario "A syntactically valid template passes validation" */
    it("passes", () => {
      const result = validateLiquid(
        "Hi {{ project.name }}{% for m in matches %}{{ m.trace.url }}{% endfor %}",
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("when the template has unbalanced tags", () => {
    /** @scenario "A syntactically invalid template is rejected" */
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
