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
    it("renders it as empty and reports the full path as missing", async () => {
      const { output, missingVariables } = await renderLiquid({
        template: "Hi {{ projct.name }}{{ project.name }}",
        context: { project: { name: "Acme" } },
      });
      expect(output).toBe("Hi Acme");
      expect(missingVariables).toContain("projct.name");
      expect(missingVariables).not.toContain("project.name");
    });
  });

  describe("when the template references a property of an existing root that the context omits", () => {
    it("reports the full dotted path so authors see property-level typos", async () => {
      const { output, missingVariables } = await renderLiquid({
        template: "Hi {{ project.nmae }}",
        context: { project: { name: "Acme" } },
      });
      expect(output).toBe("Hi ");
      expect(missingVariables).toContain("project.nmae");
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

  describe("when the template contains a hostile CPU-bound loop", () => {
    it("rejects instead of running the loop to completion", async () => {
      await expect(
        renderLiquid({
          template: "{% for i in (1..100000000) %}x{% endfor %}",
          context: {},
          timeoutMs: 50,
        }),
      ).rejects.toBeDefined();
    }, 5_000);
  });

  describe("when the template accesses a prototype property of a variable", () => {
    it("renders empty because ownPropertyOnly hides the prototype chain", async () => {
      const { output } = await renderLiquid({
        template: "[{{ name.constructor }}]",
        context: { name: "Acme" },
      });
      expect(output).toBe("[]");
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
