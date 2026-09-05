import { Liquid } from "liquidjs";
import { describe, expect, it } from "vitest";
import { getLiquidEngine, renderLiquid } from "../engine";
import { createSandboxedLiquid } from "../sandboxed-liquid";

/**
 * Spec: specs/security/template-file-inclusion.feature
 */

const A_FILE_IN_THE_WORKING_DIRECTORY = "package.json";

describe("the sandboxed Liquid factory", () => {
  describe("given a stock engine, to establish the primitive exists", () => {
    it("reads a file from the working directory", async () => {
      const rendered = await new Liquid().parseAndRender(
        `{% render '${A_FILE_IN_THE_WORKING_DIRECTORY}' %}`,
        {},
      );

      expect(rendered).toContain("@langwatch/automation-contract");
    });
  });

  describe("given an engine from the factory", () => {
    /** @scenario "The sandboxed engine refuses a render tag" */
    it("refuses a render tag naming a file that exists", async () => {
      await expect(
        createSandboxedLiquid().parseAndRender(
          `{% render '${A_FILE_IN_THE_WORKING_DIRECTORY}' %}`,
          {},
        ),
      ).rejects.toThrow();
    });

    /** @scenario "The sandboxed engine refuses an include tag" */
    it("refuses an include tag naming a file that exists", async () => {
      await expect(
        createSandboxedLiquid().parseAndRender(
          `{% include '${A_FILE_IN_THE_WORKING_DIRECTORY}' %}`,
          {},
        ),
      ).rejects.toThrow();
    });

    /** @scenario "The sandboxed engine refuses a render tag" */
    it("refuses a relative path that climbs out of the working directory", async () => {
      await expect(
        createSandboxedLiquid().parseAndRender("{% render '../../../../package.json' %}", {}),
      ).rejects.toThrow();
    });

    /** @scenario "The sandboxed engine still renders ordinary templates" */
    it("still interpolates its context", async () => {
      await expect(
        createSandboxedLiquid().parseAndRender("Hello {{ name }}", { name: "Ada" }),
      ).resolves.toBe("Hello Ada");
    });
  });

  describe("given the notification engine the automations channel renders with", () => {
    /** @scenario "A notification template cannot inline a file" */
    it("refuses a render tag naming a file that exists", async () => {
      await expect(
        renderLiquid({
          template: `{% render '${A_FILE_IN_THE_WORKING_DIRECTORY}' %}`,
          context: {},
        }),
      ).rejects.toThrow();
    });

    /** @scenario "A notification template cannot inline a file" */
    it("is the engine the shared factory built", async () => {
      await expect(
        getLiquidEngine().parseAndRender(`{% include '${A_FILE_IN_THE_WORKING_DIRECTORY}' %}`, {}),
      ).rejects.toThrow();
    });
  });
});
