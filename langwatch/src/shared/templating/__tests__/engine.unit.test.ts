import { describe, expect, it } from "vitest";
import { RenderTimeoutError, renderLiquid } from "../engine";

describe("renderLiquid", () => {
  describe("when the template references provided variables", () => {
    it("interpolates them", async () => {
      const { output } = await renderLiquid({
        template: "Hello {{ name }}",
        context: { name: "Acme" },
      });
      expect(output).toBe("Hello Acme");
    });
  });

  describe("when the template references a variable the context omits", () => {
    it("renders it as empty and reports it as missing", async () => {
      const { output, missingVariables } = await renderLiquid({
        template: "Hi {{ projct.name }}{{ project.name }}",
        context: { project: { name: "Acme" } },
      });
      expect(output).toBe("Hi Acme");
      expect(missingVariables).toContain("projct");
      expect(missingVariables).not.toContain("project");
    });
  });

  describe("when a referenced variable is a loop local", () => {
    it("does not report the local as missing", async () => {
      const { missingVariables } = await renderLiquid({
        template: "{% for m in matches %}{{ m.value }}{% endfor %}",
        context: { matches: [{ value: 1 }, { value: 2 }] },
      });
      expect(missingVariables).not.toContain("m");
      expect(missingVariables).not.toContain("matches");
    });
  });

  describe("when the render exceeds its time budget", () => {
    it("rejects with a RenderTimeoutError", async () => {
      const neverResolves = new Promise(() => {
        /* intentionally never settles */
      });
      await expect(
        renderLiquid({
          template: "{{ slow }}",
          context: { slow: neverResolves },
          timeoutMs: 20,
        }),
      ).rejects.toBeInstanceOf(RenderTimeoutError);
    });
  });

  describe("when the template has a syntax error", () => {
    it("rejects", async () => {
      await expect(
        renderLiquid({ template: "{% if %}", context: {} }),
      ).rejects.toBeDefined();
    });
  });
});
