import { afterAll, describe, expect, it } from "vitest";
import { noInlineDynamicImportRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noInlineDynamicImportRule, { code, cwd: workspace.cwd, filename });
}

describe("given a governed file", () => {
  const filename = "modules/agent/server/src/services/agent.service.ts";

  describe("when it uses an inline import() expression", () => {
    /** @scenario "An inline dynamic import in governed source is a failure" */
    it("reports inlineDynamicImport", () => {
      const found = report('const mod = await import("./thing");', filename);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("inlineDynamicImport");
    });
  });

  describe("when it uses a top-level import statement", () => {
    /** @scenario "A top-level import statement is allowed" */
    it("reports nothing", () => {
      expect(report('import { thing } from "./thing";', filename)).toEqual([]);
    });
  });

  describe("when the file is under the CLI startup path", () => {
    /** @scenario "The CLI startup path is exempt" */
    it("reports nothing", () => {
      expect(
        report(
          'const mod = await import("./thing");',
          "sdks/typescript/src/cli/program.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is the CLI's tsup config", () => {
    /** @scenario "The CLI tsup config is exempt" */
    it("reports nothing", () => {
      expect(
        report('const mod = await import("./thing");', "sdks/typescript/tsup.config.ts"),
      ).toEqual([]);
    });
  });

  describe("when the file is a web package's top-level entry file", () => {
    /** @scenario "A web package top-level entry file is exempt" */
    it("reports nothing", () => {
      expect(
        report(
          'const mod = () => import("./ui/sections/agent-drawers");',
          "modules/agent/web/src/agent-management.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is nested inside a web package, not the entry file", () => {
    /** @scenario "A nested web package file is not exempt" */
    it("reports inlineDynamicImport", () => {
      const found = report(
        'const mod = () => import("./chart");',
        "modules/agent/web/src/ui/sections/lazy-chart.tsx",
      );

      expect(found).toHaveLength(1);
    });
  });

  describe("when the file is anywhere in the UI application", () => {
    /** @scenario "The UI application is exempt for route and drawer lazies" */
    it("reports nothing", () => {
      expect(
        report(
          'const mod = () => import("./ui/sections/agent-drawers");',
          "apps/ui/src/features/agent/index.ts",
        ),
      ).toEqual([]);
    });
  });
});
