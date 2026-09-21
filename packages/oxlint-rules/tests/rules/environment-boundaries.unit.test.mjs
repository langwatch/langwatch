import { afterAll, describe, expect, it } from "vitest";
import { environmentBoundariesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(environmentBoundariesRule, { code, cwd: workspace.cwd, filename });
}

describe("given a reusable package", () => {
  describe("when it reads process.env", () => {
    /** @scenario "Reading process.env outside a composition root is reported" */
    it("reports environment with the fix", () => {
      const found = report(
        "export const url = process.env.DATABASE_URL;",
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("environment");
      expect(found[0].message).toBe(
        "Do not read `process.env` here." +
          " If the app already has a `platform/config/` module, add this key there and pass the" +
          " typed value in; otherwise parse it directly in this file's own `*.composition.ts` and" +
          " pass the typed value in.",
      );
    });
  });

  describe("when the file is the application's composition root", () => {
    /** @scenario "A composition root may read process.env" */
    it("reports nothing", () => {
      expect(
        report(
          "export const url = process.env.DATABASE_URL;",
          "apps/api/src/platform/config/env.composition.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is a test", () => {
    /** @scenario "A test file may read process.env" */
    it("reports nothing", () => {
      expect(
        report(
          "export const url = process.env.DATABASE_URL;",
          "modules/agent/process/src/services/agent.service.test.ts",
        ),
      ).toEqual([]);
    });
  });
});
